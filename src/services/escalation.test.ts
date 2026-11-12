import { describe, expect, it } from 'vitest';
import fixtureFileJson from '../../fixtures/tickets.json';
import type {
  FixtureFile,
  FixtureTicketRecord,
  Ticket,
  TriageResult,
} from '../lib/types';
import { CountingAdapter, FailingAdapter, StaticAdapter } from './inference';
import { buildEscalationPayload, prepareEscalation, type BuiltEscalation } from './payload';
import { produceRedactedArtefact } from './redaction';
import { MemoryTicketRepository } from './repository';
import { RouteEventWriter, writerForRepository } from './routeEvents';
import type { RouteEvent } from '../lib/types';
import {
  buildEscalationPrompt,
  runEscalation,
  toEscalationDraftRecord,
  type EscalationDeps,
} from './escalation';

const fixtureFile = fixtureFileJson as FixtureFile;

function record(id: string): FixtureTicketRecord {
  const found = fixtureFile.tickets.find((t) => t.id === id);
  if (!found) throw new Error(`fixture ${id} missing`);
  return found;
}

function ticketFrom(rec: FixtureTicketRecord): Ticket {
  return {
    id: rec.id,
    ownerUid: 'user-test-1',
    source: 'fixture',
    subject: rec.subject,
    body: rec.body,
    receivedAt: '2026-11-12T04:30:00.000Z',
    status: 'triaged',
    language: rec.language,
    triage: null,
    fixture: {
      fixtureVersion: 1,
      category: rec.category,
      urgency: rec.urgency,
      sentiment: rec.sentiment,
      issueCount: rec.issueCount,
      language: rec.language,
      expectedRoute: rec.expectedRoute,
      escalationTrigger: rec.escalationTrigger,
      personalData: rec.personalData,
    },
    redactedSummary: null,
    redactionCount: 0,
    privacyMode: false,
  };
}

function triageFor(rec: FixtureTicketRecord, personalDataCount: number): TriageResult {
  return {
    category: rec.category,
    urgency: rec.urgency,
    sentiment: rec.sentiment,
    confidence: 0.9,
    issueCount: rec.issueCount,
    personalDataCount,
    actualSource: 'in_cloud',
    latencyMs: 100,
    completedAt: '2026-11-12T04:31:00.000Z',
  };
}

function deps(overrides: Partial<EscalationDeps>): EscalationDeps {
  const repo = new MemoryTicketRepository();
  return {
    adapter: new StaticAdapter('A careful escalation reply.', 'in_cloud'),
    writer: writerForRepository(repo, 'user-test-1'),
    isOnline: () => true,
    confirmedByOperator: true,
    privacyMode: false,
    ...overrides,
  };
}

describe('escalation drafting (T-3.3)', () => {
  it('the payload object has exactly the contract fields — no raw-body field exists', () => {
    const ticket = ticketFrom(record('RF-021'));
    const { payload } = prepareEscalation(ticket, triageFor(record('RF-021'), 5), 'multiple-issues');
    expect(Object.keys(payload).sort()).toEqual([
      'bodyCharacterCount',
      'category',
      'escalationTrigger',
      'issueCount',
      'redactedSummary',
      'redactionCount',
      'sentiment',
      'urgency',
    ]);
  });

  it('the escalation prompt is built from the payload only and contains no raw personal data', () => {
    const rec = record('RF-005'); // name, order id, postal address in the raw body
    const ticket = ticketFrom(rec);
    const { payload } = prepareEscalation(ticket, triageFor(rec, 3), null);
    const prompt = buildEscalationPrompt(payload);
    expect(prompt).toContain(payload.redactedSummary);
    for (const raw of ['Priya Nair', 'ORD-78451', 'Rosewood Lane', 'Pune 411001']) {
      expect(prompt).not.toContain(raw);
    }
  });

  it('a blocked payload cannot escalate: no model call, blocked event recorded', async () => {
    const rec = record('RF-002');
    const ticket = ticketFrom(rec);
    const artefact = produceRedactedArtefact(ticket);
    const tampered = { ...artefact, redactedSummary: 'Reach me at sara.lee@examplemail.com please' };
    const built: BuiltEscalation = buildEscalationPayload(tampered, {
      category: 'delivery',
      urgency: 'normal',
      sentiment: 'neutral',
      escalationTrigger: 'multiple-issues',
      issueCount: 2,
      triagePersonalDataCount: 0,
    });
    expect(built.gate.status).toBe('blocked');
    const repo = new MemoryTicketRepository();
    const counting = new CountingAdapter(new StaticAdapter('reply', 'in_cloud'));
    const outcome = await runEscalation(
      { ...deps({}), adapter: counting, writer: writerForRepository(repo, 'user-test-1') },
      ticket.id,
      built,
    );
    expect(outcome.status).toBe('blocked');
    expect(counting.counts.text).toBe(0);
    const events = await repo.listRouteEvents('user-test-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      taskType: 'escalation-draft',
      outcome: 'blocked',
      actualSource: null,
      escalationTrigger: 'multiple-issues',
    });
  });

  it('held-for-review requires the operator confirmation, which is the preview confirmation', async () => {
    const rec = record('RF-002');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 3), 'multiple-issues');
    expect(built.gate.status).toBe('held-for-review');
    const counting = new CountingAdapter(new StaticAdapter('reply', 'in_cloud'));
    const unconfirmed = await runEscalation(
      { ...deps({}), adapter: counting, confirmedByOperator: false },
      ticket.id,
      built,
    );
    expect(unconfirmed.status).toBe('needs-confirmation');
    expect(counting.counts.text).toBe(0);
    const confirmed = await runEscalation({ ...deps({}), adapter: counting }, ticket.id, built);
    expect(confirmed.status).toBe('success');
    expect(counting.counts.text).toBe(1);
  });

  it('even a minimised payload requires confirmation before drafting', async () => {
    const rec = record('RF-002');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 0), 'negative-sentiment');
    expect(built.gate.status).toBe('minimised');
    const outcome = await runEscalation(
      { ...deps({}), confirmedByOperator: false },
      ticket.id,
      built,
    );
    expect(outcome.status).toBe('needs-confirmation');
  });

  it('success records an escalation-draft event with trigger, route and latency, and builds the draft record', async () => {
    const rec = record('RF-021');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 5), 'multiple-issues');
    const repo = new MemoryTicketRepository();
    const outcome = await runEscalation(
      { ...deps({}), writer: writerForRepository(repo, 'user-test-1') },
      ticket.id,
      built,
    );
    expect(outcome.status).toBe('success');
    if (outcome.status !== 'success') return;
    expect(outcome.result.actualSource).toBe('in_cloud');
    expect(outcome.result.escalationTrigger).toBe('multiple-issues');
    const events = await repo.listRouteEvents('user-test-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ticketId: 'RF-021',
      taskType: 'escalation-draft',
      requestedMode: 'prefer_in_cloud',
      actualSource: 'in_cloud',
      outcome: 'success',
      escalationTrigger: 'multiple-issues',
      redactionCount: 5,
    });
    const draft = toEscalationDraftRecord(ticket, built.payload, outcome.result);
    expect(draft).toMatchObject({
      ticketId: 'RF-021',
      requestedMode: 'prefer_in_cloud',
      actualSource: 'in_cloud',
      escalationReason: 'Multiple issues',
      state: 'draft',
    });
  });

  it('Privacy Mode refuses the escalation before any handle call and records the refusal', async () => {
    const rec = record('RF-021');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 5), 'multiple-issues');
    const repo = new MemoryTicketRepository();
    const counting = new CountingAdapter(new StaticAdapter('reply', 'in_cloud'));
    const outcome = await runEscalation(
      {
        ...deps({}),
        adapter: counting,
        writer: writerForRepository(repo, 'user-test-1'),
        privacyMode: true,
      },
      ticket.id,
      built,
    );
    expect(outcome.status).toBe('refused');
    expect(counting.counts).toEqual({ structured: 0, text: 0, initialise: 0 });
    const events = await repo.listRouteEvents('user-test-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      taskType: 'escalation-draft',
      requestedMode: 'only_on_device',
      outcome: 'blocked',
      actualSource: null,
    });
  });

  it('does not resolve success while its route-event write is still pending (strict rule)', async () => {
    const rec = record('RF-002');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 0), 'negative-sentiment');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved: RouteEvent[] = [];
    const writer = new RouteEventWriter((event) => {
      saved.push(event);
      return gate;
    });
    let settled = false;
    const pending = runEscalation({ ...deps({}), writer }, ticket.id, built).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saved).toHaveLength(1);
    expect(settled).toBe(false);
    release();
    const outcome = await pending;
    expect(outcome.status).toBe('success');
  });

  it('a failing or route-less escalation ends in a failed state with a failed event', async () => {
    const rec = record('RF-002');
    const ticket = ticketFrom(rec);
    const built = prepareEscalation(ticket, triageFor(rec, 0), 'negative-sentiment');
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, 'user-test-1');
    const failed = await runEscalation(
      { ...deps({}), adapter: new FailingAdapter('cloud down'), writer },
      ticket.id,
      built,
    );
    expect(failed.status).toBe('failed');
    const routeless = await runEscalation(
      { ...deps({}), adapter: new StaticAdapter('reply', null), writer },
      ticket.id,
      built,
    );
    expect(routeless.status).toBe('failed');
    const events = await repo.listRouteEvents('user-test-1');
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.outcome === 'failed' && e.actualSource === null)).toBe(true);
  });
});
