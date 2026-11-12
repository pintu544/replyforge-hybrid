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
