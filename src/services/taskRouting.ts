import type { RequestedMode, TaskType } from '../lib/types';
import type { DeviceAvailability } from './availability';
import type { InferenceAdapter } from './inference';
import {
  DEFAULT_RECORD_TIMEOUT_MS,
  recordRouteEventBounded,
  type RouteEventWriter,
} from './routeEvents';

/**
 * Per-task handle selection (Slice 2). Ordinary work uses the
 * device-preferred handle; Privacy Mode (SPEC FR-8) uses the device-only
 * handle — and when the device route is not actually available, the task
 * is REFUSED before any model handle is invoked, so a refusal makes zero
 * cloud calls by construction, not by cleanup.
 */

export interface TaskAdapters {
  devicePreferred: InferenceAdapter;
  deviceOnly: InferenceAdapter;
}

export type RouteResolution =
  | { kind: 'run'; adapter: InferenceAdapter; requestedMode: RequestedMode }
  | { kind: 'refused'; reason: string; alternative: string };

const NON_PRIVATE_ALTERNATIVE =
  'Turn off Privacy Mode to let this task use the normal device-preferred route with cloud fallback.';

export function resolveTaskRoute(opts: {
  privacyMode: boolean;
  availability: DeviceAvailability;
  adapters: TaskAdapters;
}): RouteResolution {
  if (!opts.privacyMode) {
    return {
      kind: 'run',
      adapter: opts.adapters.devicePreferred,
      requestedMode: 'prefer_on_device',
    };
  }
  if (opts.availability === 'available') {
    return {
      kind: 'run',
      adapter: opts.adapters.deviceOnly,
      requestedMode: 'only_on_device',
    };
  }
  const reason =
    opts.availability === 'downloadable'
      ? 'Privacy Mode is on and the on-device model has not been downloaded yet, so there is no device route to run on.'
      : opts.availability === 'downloading'
        ? 'Privacy Mode is on and the on-device model is still downloading, so there is no device route to run on yet.'
        : 'Privacy Mode is on and the on-device model is unavailable on this machine, so there is no device route to run on.';
  return { kind: 'refused', reason, alternative: NON_PRIVATE_ALTERNATIVE };
}

/**
 * Records a Privacy Mode refusal as a route event (SPEC FR-8, FR-12):
 * task type, requested mode device-only, explicit blocked outcome, no
 * actual route. A refusal is a non-success record, so the write uses the
 * bounded path — the refusal display must settle even while offline.
 */
export async function recordRefusal(
  writer: RouteEventWriter,
  opts: {
    ticketId: string;
    taskType: TaskType;
    redactionCount: number;
    isOnline: () => boolean;
    recordTimeoutMs?: number;
  },
): Promise<void> {
  try {
    await recordRouteEventBounded(
      writer,
      {
        ticketId: opts.ticketId,
        taskType: opts.taskType,
        requestedMode: 'only_on_device',
        actualSource: null,
        latencyMs: 0,
        outcome: 'blocked',
        escalationTrigger: null,
        redactionCount: opts.redactionCount,
        online: opts.isOnline(),
      },
      opts.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS,
    );
  } catch {
    // The refusal display is the primary record if the event cannot land.
  }
}
