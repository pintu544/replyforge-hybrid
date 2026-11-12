import { describe, expect, it } from 'vitest';
import type { Ticket } from '../lib/types';
import { CountingAdapter, FailingAdapter, StaticAdapter } from './inference';
import { MemoryTicketRepository } from './repository';
import { writerForRepository } from './routeEvents';
import { recordRefusal, resolveTaskRoute, type TaskAdapters } from './taskRouting';
import { runTriage } from './triage';

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

const GOOD_JSON = JSON.stringify({
  category: 'billing',
  urgency: 'normal',
  sentiment: 'neutral',
  confidence: 0.9,
  issueCount: 1,
  personalDataCount: 1,
});

function adapters(overrides: Partial<TaskAdapters> = {}): TaskAdapters {
  return {
    devicePreferred: new StaticAdapter(GOOD_JSON, 'in_cloud'),
    deviceOnly: new StaticAdapter(GOOD_JSON, 'on_device'),
    ...overrides,
  };
}

describe('Privacy Mode routing (T-2.6)', () => {
  it('with Privacy Mode off, selects the device-preferred handle (normal fallback path)', () => {
    const ads = adapters();
    const resolution = resolveTaskRoute({ privacyMode: false, availability: 'unavailable', adapters: ads });
    expect(resolution.kind).toBe('run');
    if (resolution.kind === 'run') {
      expect(resolution.adapter).toBe(ads.devicePreferred);
      expect(resolution.requestedMode).toBe('prefer_on_device');
    }
  });

  it('with Privacy Mode on and the device route available, selects the device-only handle', () => {
    const ads = adapters();
    const resolution = resolveTaskRoute({ privacyMode: true, availability: 'available', adapters: ads });
    expect(resolution.kind).toBe('run');
    if (resolution.kind === 'run') {
      expect(resolution.adapter).toBe(ads.deviceOnly);
      expect(resolution.requestedMode).toBe('only_on_device');
    }
  });

  it('with Privacy Mode on and no device route, refuses BEFORE any handle is invoked — zero cloud calls', async () => {
    const cloudSpy = new CountingAdapter(new StaticAdapter(GOOD_JSON, 'in_cloud'));
    const deviceSpy = new CountingAdapter(new StaticAdapter(GOOD_JSON, 'on_device'));
    const ads: TaskAdapters = { devicePreferred: cloudSpy, deviceOnly: deviceSpy };

    const resolution = resolveTaskRoute({ privacyMode: true, availability: 'unavailable', adapters: ads });
    expect(resolution.kind).toBe('refused');
    if (resolution.kind !== 'refused') return;
    expect(resolution.reason).toMatch(/unavailable on this machine/);
    expect(resolution.alternative).toMatch(/Turn off Privacy Mode/);

    // The refusal itself is recorded as a blocked route event.
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    await recordRefusal(writer, {
      ticketId: ticket.id,
      taskType: 'triage',
      redactionCount: 1,
      isOnline: () => true,
    });

    expect(cloudSpy.counts).toEqual({ structured: 0, text: 0, initialise: 0 });
    expect(deviceSpy.counts).toEqual({ structured: 0, text: 0, initialise: 0 });
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ticketId: 'RF-003',
      taskType: 'triage',
      requestedMode: 'only_on_device',
      actualSource: null,
      outcome: 'blocked',
      redactionCount: 1,
    });
  });

  it('refusal reasons distinguish downloadable and downloading states', () => {
    const ads = adapters();
    const downloadable = resolveTaskRoute({ privacyMode: true, availability: 'downloadable', adapters: ads });
    expect(downloadable.kind).toBe('refused');
    if (downloadable.kind === 'refused') expect(downloadable.reason).toMatch(/not been downloaded/);
    const downloading = resolveTaskRoute({ privacyMode: true, availability: 'downloading', adapters: ads });
    expect(downloading.kind).toBe('refused');
    if (downloading.kind === 'refused') expect(downloading.reason).toMatch(/still downloading/);
  });

  it('a Privacy Mode triage through the device-only handle succeeds on-device and records only_on_device', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const ads = adapters();
    const resolution = resolveTaskRoute({ privacyMode: true, availability: 'available', adapters: ads });
    if (resolution.kind !== 'run') throw new Error('expected a run resolution');
    const outcome = await runTriage(
      { adapter: resolution.adapter, writer, isOnline: () => true, requestedMode: resolution.requestedMode },
      ticket,
    );
    expect(outcome.status).toBe('success');
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0]).toMatchObject({
      requestedMode: 'only_on_device',
      actualSource: 'on_device',
      outcome: 'success',
    });
  });

  it('a cloud result under the device-only handle is discarded, never shown as success', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const outcome = await runTriage(
      {
        adapter: new StaticAdapter(GOOD_JSON, 'in_cloud'),
        writer,
        isOnline: () => true,
        requestedMode: 'only_on_device',
      },
      ticket,
    );
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.error).toMatch(/Privacy Mode/);
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0].outcome).toBe('failed');
    expect(events[0].actualSource).toBeNull();
  });

  it('with Privacy Mode off again, the device-preferred fallback resumes (cloud result is a fallback success)', async () => {
    const repo = new MemoryTicketRepository();
    const writer = writerForRepository(repo, ticket.ownerUid);
    const ads = adapters({ devicePreferred: new FailingAdapter('must not be used') });
    // Use the plain static adapters: privacy off → device-preferred handle.
    const resolution = resolveTaskRoute({
      privacyMode: false,
      availability: 'unavailable',
      adapters: { devicePreferred: new StaticAdapter(GOOD_JSON, 'in_cloud'), deviceOnly: ads.deviceOnly },
    });
    if (resolution.kind !== 'run') throw new Error('expected a run resolution');
    const outcome = await runTriage(
      { adapter: resolution.adapter, writer, isOnline: () => true, requestedMode: resolution.requestedMode },
      ticket,
    );
    expect(outcome.status).toBe('success');
    const events = await repo.listRouteEvents(ticket.ownerUid);
    expect(events[0]).toMatchObject({ requestedMode: 'prefer_on_device', outcome: 'fallback' });
  });
});
