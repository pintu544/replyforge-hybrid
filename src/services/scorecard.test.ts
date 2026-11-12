import { describe, expect, it } from 'vitest';
import type { EvaluationRun, RouteEvent } from '../lib/types';
import { computeScorecard } from './scorecard';

let counter = 0;
function event(partial: Partial<RouteEvent>): RouteEvent {
  counter += 1;
  return {
    id: `evt-${counter}`,
    ticketId: 'RF-001',
    taskType: 'triage',
    requestedMode: 'prefer_on_device',
    actualSource: null,
    latencyMs: 0,
    outcome: 'failed',
    escalationTrigger: null,
    redactionCount: 0,
    online: true,
    browserFamily: 'Chrome',
    chromeVersion: '140.0.7339.16',
    createdAt: `2026-11-13T00:00:${String(counter).padStart(2, '0')}.000Z`,
    ...partial,
  };
}

const run: EvaluationRun = {
  id: 'run-1',
  fixtureVersion: 1,
  ticketCount: 30,
  correctRoutes: 29,
  accuracy: 29 / 30,
  labelledRedactions: 61,
  survivingLabelledPatterns: 0,
  onDeviceCount: 0,
  inCloudCount: 30,
  failedCount: 0,
  deviceDescription: 'Test machine',
  chromeVersion: '140.0.7339.16',
  createdAt: '2026-11-13T01:00:00.000Z',
  results: [],
};

describe('scorecard (T-3.5)', () => {
  it('empty data produces honest empty figures, not placeholder numbers', () => {
    const card = computeScorecard([], []);
    expect(card.totalEvents).toBe(0);
    expect(card.completedTasks).toBe(0);
    expect(card.onDeviceSharePct).toBeNull();
    expect(card.medianLatencyOnDeviceMs).toBeNull();
    expect(card.medianLatencyInCloudMs).toBeNull();
    expect(card.offlineAttempts).toBe(0);
    expect(card.cloudCallsAvoided).toBe(0);
    expect(card.latestRun).toBeNull();
    expect(card.chromeVersion).toBeNull();
  });

  it('computes every figure from the seeded events', () => {
    const events = [
      event({ actualSource: 'on_device', outcome: 'success', latencyMs: 100 }),
      event({ actualSource: 'on_device', outcome: 'success', latencyMs: 300 }),
      event({ actualSource: 'on_device', outcome: 'success', latencyMs: 200 }),
      event({ actualSource: 'in_cloud', outcome: 'fallback', latencyMs: 1000 }),
      event({ actualSource: 'in_cloud', outcome: 'fallback', latencyMs: 3000 }),
      event({ outcome: 'failed', latencyMs: 50 }),
      event({ outcome: 'blocked', requestedMode: 'only_on_device' }),
      event({ outcome: 'blocked', taskType: 'escalation-draft' }),
      event({ actualSource: 'in_cloud', outcome: 'fallback', latencyMs: 500, online: false }),
      event({ outcome: 'failed', latencyMs: 10, online: false }),
    ];
    const card = computeScorecard(events, [run]);
    expect(card.completedTasks).toBe(6);
    expect(card.onDeviceCompleted).toBe(3);
    expect(card.onDeviceSharePct).toBe(50);
    expect(card.medianLatencyOnDeviceMs).toBe(200);
    expect(card.medianLatencyInCloudMs).toBe(1000);
    expect(card.onDeviceSample).toBe(3);
    expect(card.inCloudSample).toBe(3);
    expect(card.offlineAttempts).toBe(2);
    expect(card.offlineSuccesses).toBe(1);
    // 3 on-device completions + 2 blocked attempts.
    expect(card.cloudCallsAvoided).toBe(5);
    expect(card.latestRun?.id).toBe('run-1');
    expect(card.chromeVersion).toBe('140.0.7339.16');
    expect(card.deviceDescription).toBe('Test machine');
  });

  it('uses the latest evaluation run when several exist', () => {
    const older: EvaluationRun = { ...run, id: 'run-old', createdAt: '2026-11-12T01:00:00.000Z', correctRoutes: 20 };
    const card = computeScorecard([], [older, run]);
    expect(card.latestRun?.id).toBe('run-1');
    expect(card.latestRun?.correctRoutes).toBe(29);
  });
});
