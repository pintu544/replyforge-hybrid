import { describe, expect, it } from 'vitest';
import type { Ticket } from '../lib/types';
import { MemoryTicketRepository } from './repository';
import { writerForRepository } from './routeEvents';
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
