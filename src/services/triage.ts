import type {
  Category,
  RequestedMode,
  Sentiment,
  Ticket,
  TriageResult,
  Urgency,
} from '../lib/types';
import type { InferenceAdapter } from './inference';
import { DEFAULT_TRIAGE_PROMPT, renderPrompt } from './prompts';
import {
  DEFAULT_RECORD_TIMEOUT_MS,
  recordRouteEventBounded,
  type RouteEventWriter,
} from './routeEvents';

/**
 * Device-preferred structured triage (SPEC FR-3, TASKS T-1.8).
 * The displayed route always comes from the inference result (NFR-2): if a
 * call succeeds but reports no route, the task is shown as failed, not guessed.
 */

/**
 * Renders the triage prompt from a template (Slice 3: the template comes
 * from Remote Config, with DEFAULT_TRIAGE_PROMPT as the in-code default —
 * rendering the default reproduces the pre-Slice-3 prompt byte for byte).
 */
export function buildTriagePrompt(ticket: Ticket, template: string = DEFAULT_TRIAGE_PROMPT): string {
  return renderPrompt(template, { subject: ticket.subject, body: ticket.body });
}

const CATEGORIES: Category[] = ['billing', 'delivery', 'account', 'product', 'returns', 'technical', 'other'];
const URGENCIES: Urgency[] = ['low', 'normal', 'high', 'urgent'];
const SENTIMENTS: Sentiment[] = ['positive', 'neutral', 'negative', 'angry'];

export interface ParsedTriage {
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  confidence: number;
  issueCount: number;
  personalDataCount: number;
}

export function parseTriageResponse(text: string): ParsedTriage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The model did not return valid JSON.');
  }
  const obj = raw as Record<string, unknown>;
  if (!CATEGORIES.includes(obj.category as Category)) {
    throw new Error(`Unexpected triage category: ${String(obj.category)}`);
  }
  if (!URGENCIES.includes(obj.urgency as Urgency)) {
    throw new Error(`Unexpected triage urgency: ${String(obj.urgency)}`);
  }
  if (!SENTIMENTS.includes(obj.sentiment as Sentiment)) {
    throw new Error(`Unexpected triage sentiment: ${String(obj.sentiment)}`);
  }
  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error('Triage confidence was not a number.');
  }
  const issueCount = Number(obj.issueCount);
  const personalDataCount = Number(obj.personalDataCount);
  if (!Number.isInteger(issueCount) || issueCount < 1) {
    throw new Error('Triage issueCount must be an integer of at least 1.');
  }
  if (!Number.isInteger(personalDataCount) || personalDataCount < 0) {
    throw new Error('Triage personalDataCount must be a non-negative integer.');
  }
  return {
    category: obj.category as Category,
    urgency: obj.urgency as Urgency,
    sentiment: obj.sentiment as Sentiment,
    confidence: Math.min(1, Math.max(0, confidence)),
    issueCount,
    personalDataCount,
  };
}

export type TriageOutcome =
  | { status: 'success'; triage: TriageResult }
  | { status: 'failed'; error: string; latencyMs: number };

export interface TriageDeps {
  adapter: InferenceAdapter;
  writer: RouteEventWriter;
  isOnline: () => boolean;
  /**
   * Which handle the caller selected (Slice 2 task routing). Defaults to
   * the device-preferred handle; Privacy Mode passes 'only_on_device' with
   * the device-only adapter.
   */
  requestedMode?: RequestedMode;
  /** Prompt template (Remote Config, Slice 3); defaults to the in-code template. */
  promptTemplate?: string;
  /**
   * Bound on awaiting the FAILURE-path route-event write; see
   * recordRouteEventBounded. The success path is not bounded: it awaits its
   * write to durable completion before any success is shown (strict rule,
   * T-1.10 gate).
   */
  recordTimeoutMs?: number;
  /**
   * Slice 2 offline state model: called with the computed result the
   * moment inference succeeds, BEFORE the durable route-event write. The
   * caller may show the work as "completed locally — awaiting sync" (with
   * NO route chip: no route is proven yet) and promotes it to a proven
   * success only when this function's promise resolves. The promise still
   * resolves as success solely after the event is durably saved, so the
   * strict T-1.10 rule is unchanged.
   */
  onLocalSuccess?: (triage: TriageResult) => void;
}

export async function runTriage(deps: TriageDeps, ticket: Ticket): Promise<TriageOutcome> {
  const recordTimeoutMs = deps.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS;
  const requestedMode = deps.requestedMode ?? 'prefer_on_device';
  const started = performance.now();
  try {
    const result = await deps.adapter.generateStructured(
      buildTriagePrompt(ticket, deps.promptTemplate ?? DEFAULT_TRIAGE_PROMPT),
    );
    const latencyMs = Math.round(performance.now() - started);
    if (!result.inferenceSource) {
      throw new Error('The inference result did not report which route ran, so the task is recorded as failed rather than guessed (SPEC NFR-2).');
    }
    if (requestedMode === 'only_on_device' && result.inferenceSource !== 'on_device') {
      // Privacy Mode promised device-only processing. A cloud result under
      // the device-only handle breaks that promise, so it is discarded and
      // recorded as a failure, never displayed as a success.
      throw new Error('Privacy Mode: the result reported a cloud route, so it was discarded rather than shown.');
    }
    const parsed = parseTriageResponse(result.text);
    const triage: TriageResult = {
      ...parsed,
      actualSource: result.inferenceSource,
      latencyMs,
      completedAt: new Date().toISOString(),
    };
    // Slice 2 awaiting-sync hook: the caller learns the work is done
    // locally before the proof is durable (see TriageDeps.onLocalSuccess).
    deps.onLocalSuccess?.(triage);
    // Strict success rule (Pintu's T-1.10 gate decision, 12 Nov 2026): a
    // success is displayed only once its route event is durably saved, so
    // this write is awaited WITHOUT the failure-path bound. If it rejects,
    // the throw lands in the catch below and the run is surfaced as failed
    // — the displayed record and the stored proof never diverge. (While
    // fully offline this await can pend until reconnect; the caller handles
    // that through onLocalSuccess — see spec/DESIGN.md, Slice 2 note.)
    await deps.writer.record({
      ticketId: ticket.id,
      taskType: 'triage',
      requestedMode,
      actualSource: result.inferenceSource,
      latencyMs,
      outcome: result.inferenceSource === 'on_device' ? 'success' : 'fallback',
      escalationTrigger: null,
      redactionCount: 0,
      online: deps.isOnline(),
    });
    return { status: 'success', triage };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    try {
      await recordRouteEventBounded(
        deps.writer,
        {
          ticketId: ticket.id,
          taskType: 'triage',
          requestedMode,
          actualSource: null,
          latencyMs,
          outcome: 'failed',
          escalationTrigger: null,
          redactionCount: 0,
          online: deps.isOnline(),
        },
        recordTimeoutMs,
      );
    } catch {
      // The failure event could not be written (for example, Firestore is not
      // reachable yet). The visible failed state below is the primary record.
    }
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Triage failed for an unknown reason.',
      latencyMs,
    };
  }
}
