import type { EvaluationRun, RouteEvent } from '../lib/types';

/**
 * Scorecard computation (SPEC FR-13, TASKS T-3.5). Pure functions over
 * stored data: every figure traces to route events or an EvaluationRun,
 * and nothing is typed in by hand. A figure with no data is null — the UI
 * shows the honest empty state with its sample size, never a placeholder
 * number.
 */

export interface ScorecardData {
  /** Route events the figures were computed from. */
  totalEvents: number;
  /** Completed AI tasks (outcome success or fallback) across all task types. */
  completedTasks: number;
  /** Percentage of completed tasks whose actual route was on-device. */
  onDeviceSharePct: number | null;
  onDeviceCompleted: number;
  medianLatencyOnDeviceMs: number | null;
  medianLatencyInCloudMs: number | null;
  onDeviceSample: number;
  inCloudSample: number;
  /** Tasks attempted while the browser reported offline. */
  offlineAttempts: number;
  /** Offline attempts that completed (success or fallback). */
  offlineSuccesses: number;
  /**
   * Cloud calls avoided: tasks completed on-device (each is a cloud call
   * that did not happen) plus attempts blocked before any call (Privacy
   * Mode refusals and gate blocks).
   */
  cloudCallsAvoided: number;
  /** Escalation accuracy + redaction figures come from the latest run. */
  latestRun: EvaluationRun | null;
  chromeVersion: string | null;
  deviceDescription: string | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function isCompleted(event: RouteEvent): boolean {
  return event.outcome === 'success' || event.outcome === 'fallback';
}

export function computeScorecard(events: RouteEvent[], runs: EvaluationRun[]): ScorecardData {
  const completed = events.filter(isCompleted);
  const onDevice = completed.filter((e) => e.actualSource === 'on_device');
  const inCloud = completed.filter((e) => e.actualSource === 'in_cloud');
  const offline = events.filter((e) => !e.online);
  const blocked = events.filter((e) => e.outcome === 'blocked');
  const latestRun =
    runs.length > 0
      ? [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : null;
  const latestEvent =
    events.length > 0
      ? [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : null;

  return {
    totalEvents: events.length,
    completedTasks: completed.length,
    onDeviceSharePct:
      completed.length > 0 ? Math.round((onDevice.length / completed.length) * 1000) / 10 : null,
    onDeviceCompleted: onDevice.length,
    medianLatencyOnDeviceMs: median(onDevice.map((e) => e.latencyMs)),
    medianLatencyInCloudMs: median(inCloud.map((e) => e.latencyMs)),
    onDeviceSample: onDevice.length,
    inCloudSample: inCloud.length,
    offlineAttempts: offline.length,
    offlineSuccesses: offline.filter(isCompleted).length,
    cloudCallsAvoided: onDevice.length + blocked.length,
    latestRun,
    chromeVersion: latestRun?.chromeVersion ?? latestEvent?.chromeVersion ?? null,
    deviceDescription: latestRun?.deviceDescription ?? null,
  };
}
