import { describe, expect, it } from 'vitest';
import type { RouteEvent, Ticket } from '../lib/types';
import { MemoryTicketRepository } from './repository';
import { RouteEventWriter, writerForRepository } from './routeEvents';
import { FailingAdapter, StaticAdapter } from './inference';
import { parseTriageResponse, runTriage } from './triage';

const ticket: Ticket = {
  id: 'RF-001',
  ownerUid: 'user-test-1',
  source: 'fixture',
  subject: 'Where is my order?',
  body: 'Hello, I placed an order four days ago and the tracking page still says "label created".',
  receivedAt: '2026-11-12T04:25:00.000Z',
  status: 'inbox',
  language: 'en',
  triage: null,
  fixture: null,
};

const GOOD_JSON = JSON.stringify({
  category: 'delivery',
  urgency: 'normal',
  sentiment: 'neutral',
  confidence: 0.92,
  issueCount: 1,
  personalDataCount: 0,
});

describe('triage (T-1.8)', () => {
  it('parses a valid structured response and rejects invalid ones', () => {
    const parsed = parseTriageResponse(GOOD_JSON);
    expect(parsed.category).toBe('delivery');
    expect(parsed.confidence).toBeCloseTo(0.92);
    expect(() => parseTriageResponse('not json')).toThrow(/valid JSON/);
    expect(() =>
      parseTriageResponse(JSON.stringify({ ...JSON.parse(GOOD_JSON), category: 'space' })),
    ).toThrow(/category/);
  });

  it('returns the actual on-device route and writes a matching route event', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runTriage(
      { adapter: new StaticAdapter(GOOD_JSON, 'on_device'), writer, isOnline: () => true },
      ticket,
    );
    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.triage.actualSource).toBe('on_device');
      expect(outcome.triage.category).toBe('delivery');
      expect(outcome.triage.personalDataCount).toBe(0);
      expect(outcome.triage.latencyMs).toBeGreaterThanOrEqual(0);
    }
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ticketId: 'RF-001',
      taskType: 'triage',
      requestedMode: 'prefer_on_device',
      actualSource: 'on_device',
      outcome: 'success',
    });
  });

  it('labels a cloud result as fallback, never as the requested mode', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runTriage(
      { adapter: new StaticAdapter(GOOD_JSON, 'in_cloud'), writer, isOnline: () => true },
      ticket,
    );
    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.triage.actualSource).toBe('in_cloud');
    }
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0].outcome).toBe('fallback');
    expect(events[0].actualSource).toBe('in_cloud');
  });

  it('treats a result with no reported route as failed rather than guessing (NFR-2)', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runTriage(
      { adapter: new StaticAdapter(GOOD_JSON, null), writer, isOnline: () => true },
      ticket,
    );
    expect(outcome.status).toBe('failed');
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0].outcome).toBe('failed');
    expect(events[0].actualSource).toBeNull();
  });

  it('failure settles promptly even when its route-event write never settles (NFR-7, T-1.9 QA)', async () => {
    // While offline, a Firestore write stays pending until reconnect; a
    // FAILED task's visible outcome must not wait for it. (The success path
    // deliberately behaves the other way since Pintu's T-1.10 gate
    // decision — see the strict-rule tests below. This test previously also
    // asserted the old proceed-anyway success behaviour; that half was
    // replaced when the strict rule landed.)
    const hangingWriter = new RouteEventWriter(() => new Promise<void>(() => {}));
    const failure = await runTriage(
      {
        adapter: new FailingAdapter('Network is offline.'),
        writer: hangingWriter,
        isOnline: () => false,
        recordTimeoutMs: 25,
      },
      ticket,
    );
    expect(failure.status).toBe('failed');
  });

  it('does not resolve success while its route-event write is still pending (T-1.10 strict rule)', async () => {
    // Strict rule (Pintu, T-1.10 gate): a success is never displayed before
    // its route event is durably saved. The write is held open by the test;
    // runTriage must stay unresolved until the write completes.
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
    const pending = runTriage(
      { adapter: new StaticAdapter(GOOD_JSON, 'in_cloud'), writer, isOnline: () => true },
      ticket,
    ).then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saved).toHaveLength(1);
    expect(settled).toBe(false);
    release();
    const outcome = await pending;
    expect(settled).toBe(true);
    expect(outcome.status).toBe('success');
    expect(saved[0]).toMatchObject({
      ticketId: 'RF-001',
      actualSource: 'in_cloud',
      outcome: 'fallback',
    });
  });

  it('surfaces a success whose route-event write rejects as failed, not success (T-1.10 strict rule)', async () => {
    // If the success event cannot be saved, the run must be shown as failed
    // — the displayed record and the stored proof never diverge. The first
    // (success-path) write rejects; the failure-path write that follows it
    // succeeds and records the failed outcome.
    const attempts: RouteEvent[] = [];
    const writer = new RouteEventWriter((event) => {
      attempts.push(event);
      return attempts.length === 1
        ? Promise.reject(new Error('Firestore write failed.'))
        : Promise.resolve();
    });
    const outcome = await runTriage(
      { adapter: new StaticAdapter(GOOD_JSON, 'in_cloud'), writer, isOnline: () => true },
      ticket,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('Firestore write failed.');
    }
    expect(attempts).toHaveLength(2);
    expect(attempts[0].outcome).toBe('fallback');
    expect(attempts[1].outcome).toBe('failed');
    expect(attempts[1].actualSource).toBeNull();
  });

  it('forced error ends in a failed outcome with a failed route event (retryable state)', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runTriage(
      { adapter: new FailingAdapter('App Check token rejected.'), writer, isOnline: () => true },
      ticket,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toContain('App Check');
    }
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe('failed');
  });
});
