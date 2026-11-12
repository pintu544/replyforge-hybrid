import { describe, expect, it } from 'vitest';
import {
  AvailabilityController,
  mapAvailability,
  probeAvailability,
  type LanguageModelProbe,
} from './availability';

function probeWith(api: boolean, result: string | Error): LanguageModelProbe {
  return {
    hasApi: () => api,
    availability: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('availability controller (T-1.6)', () => {
  it('maps the four Chrome states and treats anything else as unavailable', () => {
    expect(mapAvailability('available')).toBe('available');
    expect(mapAvailability('downloadable')).toBe('downloadable');
    expect(mapAvailability('downloading')).toBe('downloading');
    expect(mapAvailability('unavailable')).toBe('unavailable');
    expect(mapAvailability('something-new')).toBe('unavailable');
  });

  it('treats a missing LanguageModel object as unavailable, not an error', async () => {
    await expect(probeAvailability(probeWith(false, 'available'))).resolves.toBe('unavailable');
  });

  it('treats a throwing availability call as unavailable', async () => {
    await expect(probeAvailability(probeWith(true, new Error('boom')))).resolves.toBe('unavailable');
  });

  it('refresh() publishes the probed state to subscribers', async () => {
    const controller = new AvailabilityController(probeWith(true, 'downloadable'));
    const seen: string[] = [];
    controller.subscribe((s) => seen.push(s.state));
    const state = await controller.refresh();
    expect(state).toBe('downloadable');
    expect(controller.getSnapshot().state).toBe('downloadable');
    expect(seen).toContain('downloadable');
  });

  it('enable() runs the initialiser with progress and ends available', async () => {
    const controller = new AvailabilityController(probeWith(true, 'available'), async (cb) => {
      cb(0.5);
      cb(1);
    });
    await controller.enable();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('available');
    expect(snap.error).toBeNull();
  });

  it('enable() failure is visible in the snapshot and sets unavailable', async () => {
    const controller = new AvailabilityController(probeWith(true, 'unavailable'), async () => {
      throw new Error('Download requires a user gesture.');
    });
    await controller.enable();
    const snap = controller.getSnapshot();
    expect(snap.state).toBe('unavailable');
    expect(snap.error).toContain('user gesture');
  });
});
