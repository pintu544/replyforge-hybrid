import { describe, expect, it } from 'vitest';
import fixtureFileJson from '../../fixtures/tickets.json';
import type { FixtureFile, RouteEvent } from '../lib/types';
import { buildRouteEvent, RouteEventWriter, writerForRepository } from './routeEvents';
import { MemoryTicketRepository } from './repository';

const file = fixtureFileJson as FixtureFile;

describe('route-event writer (T-1.5)', () => {
  it('builds an event with exactly the specified fields', () => {
    const event = buildRouteEvent({
      ticketId: 'RF-001',
      taskType: 'triage',
      requestedMode: 'prefer_on_device',
      actualSource: 'in_cloud',
      latencyMs: 812.4,
      outcome: 'fallback',
      escalationTrigger: null,
      redactionCount: 0,
      online: true,
    });
    expect(Object.keys(event).sort()).toEqual(
      [
        'id',
        'ticketId',
        'taskType',
        'requestedMode',
        'actualSource',
        'latencyMs',
        'outcome',
        'escalationTrigger',
        'redactionCount',
        'online',
        'browserFamily',
        'chromeVersion',
        'createdAt',
      ].sort(),
    );
    expect(event.latencyMs).toBe(812);
    expect(event.actualSource).toBe('in_cloud');
  });

  it('serialises no ticket or prompt text from the fixture ticket it describes', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, 'user-test-1');
    const ticket = file.tickets.find((t) => t.id === 'RF-021');
    expect(ticket).toBeDefined();

    await writer.record({
      ticketId: ticket!.id,
      taskType: 'triage',
      requestedMode: 'prefer_on_device',
      actualSource: 'in_cloud',
      latencyMs: 1200,
      outcome: 'fallback',
      escalationTrigger: null,
      redactionCount: 0,
      online: true,
    });

    const events = await repo.listRouteEvents('user-test-1');
    expect(events).toHaveLength(1);
    const serialised = JSON.stringify(events[0]);
    expect(serialised).not.toContain(ticket!.subject);
    expect(serialised).not.toContain('Meera Pillai');
    expect(serialised).not.toContain('98200');
    expect(serialised).not.toContain('ORD-20417');
    // No free-text payload of any kind is present.
    const event: RouteEvent = events[0];
    expect(Object.values(event).every((v) => typeof v !== 'string' || v.length < 80)).toBe(true);
  });

  it('rejects attempts to add a text field (SPEC NFR-3)', () => {
    expect(() =>
      buildRouteEvent({
        ticketId: 'RF-001',
        taskType: 'triage',
        requestedMode: 'prefer_on_device',
        actualSource: null,
        latencyMs: 10,
        outcome: 'failed',
        escalationTrigger: null,
        redactionCount: 0,
        online: true,
        // @ts-expect-error deliberate violation for the test
        body: 'the raw ticket text',
      }),
    ).toThrow(/must not contain/);
  });

  it('writer is the single sink path: record() writes exactly one event', async () => {
    const written: RouteEvent[] = [];
    const writer = new RouteEventWriter(async (e) => {
      written.push(e);
    });
    const event = await writer.record({
      ticketId: 'RF-002',
      taskType: 'triage',
      requestedMode: 'prefer_on_device',
      actualSource: 'on_device',
      latencyMs: 95,
      outcome: 'success',
      escalationTrigger: null,
      redactionCount: 0,
      online: false,
    });
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe(event.id);
    expect(written[0].online).toBe(false);
  });
});
