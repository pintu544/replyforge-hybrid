import { describe, expect, it } from 'vitest';
import type { RouteEvent, Ticket } from '../lib/types';
import { CountingAdapter, FailingAdapter, StaticAdapter } from './inference';
import { MemoryTicketRepository } from './repository';
import { produceRedactedArtefact } from './redaction';
import { RouteEventWriter, writerForRepository } from './routeEvents';
import {
  buildDraftPrompt,
  manualDraftRecord,
  runDraft,
  sendSimulated,
  toDraftRecord,
} from './drafts';

const ticket: Ticket = {
  id: 'RF-003',
  ownerUid: 'user-test-1',
  source: 'fixture',
  subject: 'Copy of last month\'s invoice',
  body: 'Please send a copy of last month\'s invoice for my records. My email is arjun.mehta@examplemail.com.',
  receivedAt: '2026-11-12T04:30:00.000Z',
  status: 'inbox',
  language: 'en',
  triage: null,
  fixture: null,
  redactedSummary: null,
  redactionCount: 0,
  privacyMode: false,
};

const artefact = produceRedactedArtefact(ticket);
const DRAFT_TEXT = 'Thank you for writing in. A copy of last month\'s invoice is attached for your records.';

describe('simple draft (T-2.5)', () => {
  it('the draft prompt is built from the redacted artefact only — no raw personal data', () => {
    const prompt = buildDraftPrompt(artefact, ticket);
    expect(prompt).not.toContain('arjun.mehta@examplemail.com');
    expect(prompt).toContain('[e-mail masked]');
    expect(artefact.redactionCount).toBe(1);
  });

  it('produces a draft with the actual route and latency, and writes a matching route event', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runDraft(
      { adapter: new StaticAdapter(DRAFT_TEXT, 'on_device'), writer, isOnline: () => true },
      ticket,
      artefact,
    );
    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.draft.text).toBe(DRAFT_TEXT);
      expect(outcome.draft.actualSource).toBe('on_device');
      expect(outcome.draft.requestedMode).toBe('prefer_on_device');
      expect(outcome.draft.latencyMs).toBeGreaterThanOrEqual(0);
    }
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ticketId: 'RF-003',
      taskType: 'simple-draft',
      actualSource: 'on_device',
      outcome: 'success',
      redactionCount: 1,
    });
    // NFR-3: the event contains no draft text.
    expect(JSON.stringify(events[0])).not.toContain('invoice is attached');
  });

  it('labels a cloud draft as fallback, never as the requested mode', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runDraft(
      { adapter: new StaticAdapter(DRAFT_TEXT, 'in_cloud'), writer, isOnline: () => true },
      ticket,
      artefact,
    );
    expect(outcome.status).toBe('success');
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0].outcome).toBe('fallback');
  });

  it('an empty model result is a visible failure the operator can regenerate or replace', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runDraft(
      { adapter: new StaticAdapter('   ', 'in_cloud'), writer, isOnline: () => true },
      ticket,
      artefact,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/empty draft/);
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0].outcome).toBe('failed');
  });

  it('a failed generation ends in a failed outcome with a failed route event', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runDraft(
      { adapter: new FailingAdapter('Model unavailable.'), writer, isOnline: () => false },
      ticket,
      artefact,
    );
    expect(outcome.status).toBe('failed');
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0]).toMatchObject({ taskType: 'simple-draft', outcome: 'failed', online: false });
  });

  it('strict rule: a draft success does not resolve while its route-event write is pending; onLocalSuccess fires first', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved: RouteEvent[] = [];
    const writer = new RouteEventWriter((event) => {
      saved.push(event);
      return gate;
    });
    let localSeen: string | null = null;
    let settled = false;
    const pending = runDraft(
      {
        adapter: new StaticAdapter(DRAFT_TEXT, 'in_cloud'),
        writer,
        isOnline: () => false,
        onLocalSuccess: (draft) => {
          localSeen = draft.text;
        },
      },
      ticket,
      artefact,
    ).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The work is complete locally (awaiting-sync may be shown, with no
    // route chip), but the proven success has NOT resolved.
    expect(localSeen).toBe(DRAFT_TEXT);
    expect(settled).toBe(false);
    release();
    const outcome = await pending;
    expect(outcome.status).toBe('success');
    expect(saved[0].taskType).toBe('simple-draft');
  });

  it('strict rule: a draft whose route-event write rejects is surfaced as failed', async () => {
    const attempts: RouteEvent[] = [];
    const writer = new RouteEventWriter((event) => {
      attempts.push(event);
      return attempts.length === 1
        ? Promise.reject(new Error('Firestore write failed.'))
        : Promise.resolve();
    });
    const outcome = await runDraft(
      { adapter: new StaticAdapter(DRAFT_TEXT, 'in_cloud'), writer, isOnline: () => true },
      ticket,
      artefact,
    );
    expect(outcome.status).toBe('failed');
    expect(attempts).toHaveLength(2);
    expect(attempts[1].outcome).toBe('failed');
  });

  it('blocks generation before any model call when a labelled pattern survives in the artefact (T-2.8)', async () => {
    // A stale or hand-built artefact whose redacted body still carries a
    // detectable pattern must never reach a prompt: runDraft re-scans the
    // artefact and fails visibly instead of generating.
    const tampered = {
      ...artefact,
      redactedBody: 'Also reach me on 98200/11223 for updates.',
    };
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const counting = new CountingAdapter(new StaticAdapter(DRAFT_TEXT, 'in_cloud'));
    const outcome = await runDraft(
      { adapter: counting, writer, isOnline: () => true },
      ticket,
      tampered,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toMatch(/survived redaction/);
      expect(outcome.error).toContain('phone');
      // The error names the type only — never the surviving value.
      expect(outcome.error).not.toContain('98200/11223');
    }
    expect(counting.counts.text).toBe(0);
    expect(counting.counts.structured).toBe(0);
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('failed');
  });

  it('draft records: AI drafts carry their route; manual drafts honestly carry none', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runDraft(
      { adapter: new StaticAdapter(DRAFT_TEXT, 'on_device'), writer, isOnline: () => true },
      ticket,
      artefact,
    );
    if (outcome.status !== 'success') throw new Error('draft failed');
    const record = toDraftRecord(ticket, outcome.draft);
    expect(record).toMatchObject({ state: 'draft', actualSource: 'on_device', requestedMode: 'prefer_on_device' });

    const manual = manualDraftRecord(ticket, 'Written by hand.');
    expect(manual.actualSource).toBeNull();
    expect(manual.requestedMode).toBeNull();
    expect(manual.latencyMs).toBeNull();
  });
});

describe('simulated send and offline queue (T-2.7)', () => {
  it('a settled save marks the draft sent-simulated and the ticket sent-simulated', async () => {
    const repo = new MemoryTicketRepository();
    await repo.saveTicket(ticket);
    const draft = { ...manualDraftRecord(ticket, 'Ready.'), state: 'edited' as const };
    await repo.saveDraft(ticket.ownerUid, draft);

    const outcome = await sendSimulated(async () => {
      await repo.saveDraft(ticket.ownerUid, { ...draft, state: 'sent-simulated' });
      await repo.saveTicket({ ...ticket, status: 'sent-simulated' });
    });
    expect(outcome.status).toBe('sent');
    const drafts = await repo.listDrafts(ticket.ownerUid);
    expect(drafts[0].state).toBe('sent-simulated');
    const tickets = await repo.listTickets(ticket.ownerUid);
    expect(tickets[0].status).toBe('sent-simulated');
  });

  it('a save that never settles (offline) leaves the send visibly queued, ticket preserved', async () => {
    const outcome = await sendSimulated(() => new Promise<void>(() => {}), 25);
    expect(outcome.status).toBe('queued');
    if (outcome.status === 'queued') expect(outcome.note).toMatch(/queued/);
  });

  it('a rejected save fails with a next action, and nothing is marked sent', async () => {
    const outcome = await sendSimulated(() => Promise.reject(new Error('Firestore unavailable.')), 25);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('Firestore unavailable.');
      expect(outcome.nextAction).toMatch(/send again/);
    }
  });
});
