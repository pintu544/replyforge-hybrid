import type {
  ActualSource,
  RequestedMode,
  RouteEvent,
  RouteOutcome,
  TaskType,
} from '../lib/types';
import { currentBrowserInfo } from '../lib/browserInfo';
import type { TicketRepository } from './repository';

export interface RouteEventInput {
  ticketId: string;
  taskType: TaskType;
  requestedMode: RequestedMode;
  actualSource: ActualSource | null;
  latencyMs: number;
  outcome: RouteOutcome;
  escalationTrigger: string | null;
  redactionCount: number;
  online: boolean;
}

/**
 * Field names that would put ticket or prompt text into a route event.
 * Their presence is a programming error and is rejected loudly (NFR-3).
 */
const FORBIDDEN_KEYS = [
  'subject',
  'body',
  'bodyRaw',
  'text',
  'prompt',
  'draft',
  'summary',
  'redactedSummary',
  'email',
  'phone',
  'name',
  'address',
];

let fallbackCounter = 0;

export function newEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `evt-${Date.now()}-${fallbackCounter}`;
}

export function buildRouteEvent(input: RouteEventInput, nowIso?: string): RouteEvent {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error(`Route events must not contain the field "${key}" (SPEC NFR-3).`);
    }
  }
  if (input.latencyMs < 0 || !Number.isFinite(input.latencyMs)) {
    throw new Error('Route event latencyMs must be a finite, non-negative number.');
  }
  if (input.redactionCount < 0) {
    throw new Error('Route event redactionCount must not be negative.');
  }
  const browser = currentBrowserInfo();
  return {
    id: newEventId(),
    ticketId: input.ticketId,
    taskType: input.taskType,
    requestedMode: input.requestedMode,
    actualSource: input.actualSource,
    latencyMs: Math.round(input.latencyMs),
    outcome: input.outcome,
    escalationTrigger: input.escalationTrigger,
    redactionCount: input.redactionCount,
    online: input.online,
    browserFamily: browser.browserFamily,
    chromeVersion: browser.chromeVersion,
    createdAt: nowIso ?? new Date().toISOString(),
  };
}

/**
 * The only metrics path in the app (DESIGN.md). UI components and other
 * services receive this writer; nothing else writes route events.
 */
export class RouteEventWriter {
  private readonly sink: (event: RouteEvent) => Promise<void>;

  constructor(sink: (event: RouteEvent) => Promise<void>) {
    this.sink = sink;
  }

  async record(input: RouteEventInput): Promise<RouteEvent> {
    const event = buildRouteEvent(input);
    await this.sink(event);
    return event;
  }
}

export function writerForRepository(repo: TicketRepository, ownerUid: string): RouteEventWriter {
  return new RouteEventWriter((event) => repo.addRouteEvent(ownerUid, event));
}

export const DEFAULT_RECORD_TIMEOUT_MS = 10_000;

/**
 * Awaits a route-event write only up to a bound (SPEC NFR-7). Used ONLY for
 * non-success records (failures, refusals): their visible state must settle
 * once the outcome is known, even when the write cannot reach Firestore —
 * while offline the SDK queues the write and its promise stays pending
 * until reconnect, which previously left the UI in the running state
 * indefinitely (T-1.9 QA, C-2). A write that settles within the bound keeps
 * full strictness (a fast rejection propagates); a write that outlives the
 * bound is left to finish in the background — never cancelled, and it still
 * lands when it can. Success records do NOT use this helper: since the
 * T-1.10 gate decision they are awaited unboundedly, so a success is never
 * displayed before its route event is durably saved.
 */
export async function recordRouteEventBounded(
  writer: RouteEventWriter,
  input: RouteEventInput,
  timeoutMs: number,
): Promise<void> {
  const settled = writer.record(input).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([settled, expired]);
    if (result === 'timeout') return;
    if (!result.ok) throw result.err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
