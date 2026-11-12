import type { Category, Sentiment, Ticket, TriageResult, Urgency } from '../lib/types';
import type { InferenceAdapter } from './inference';
import type { RouteEventInput, RouteEventWriter } from './routeEvents';

/**
 * Device-preferred structured triage (SPEC FR-3, TASKS T-1.8).
 * The displayed route always comes from the inference result (NFR-2): if a
 * call succeeds but reports no route, the task is shown as failed, not guessed.
 */

export function buildTriagePrompt(ticket: Ticket): string {
  return [
    'You are the triage step of a customer-support inbox.',
    'Classify the ticket below and reply with JSON only, matching the schema exactly.',
    'category: billing, delivery, account, product, returns, technical, or other.',
    'urgency: low, normal, high, or urgent.',
    'sentiment: positive, neutral, negative, or angry.',
    'confidence: your confidence in this classification, from 0 to 1.',
    'issueCount: the number of distinct problems the customer raises (at least 1).',
    'personalDataCount: how many items of personal data appear (names, e-mail addresses, telephone numbers, postal addresses, order identifiers, payment references). Count items, not types.',
    '',
    `Subject: ${ticket.subject}`,
    'Message:',
    ticket.body,
  ].join('\n');
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
   * Bound on awaiting the FAILURE-path route-event write; see recordBounded.
   * The success path is not bounded: it awaits its write to durable
   * completion before any success is shown (strict rule, T-1.10 gate).
   */
  recordTimeoutMs?: number;
}

export const DEFAULT_RECORD_TIMEOUT_MS = 10_000;

/**
 * Awaits a route-event write only up to a bound (SPEC NFR-7). Used ONLY on
 * the failure path: a failed task's visible state must settle once its error
 * is known, even when the write cannot reach Firestore — while offline the
 * SDK queues the write and its promise stays pending until reconnect, which
 * previously left the UI in the running state indefinitely (T-1.9 QA). A
 * write that settles within the bound keeps the old strictness (a fast
 * rejection propagates); a write that outlives the bound is left to finish
 * in the background — it is never cancelled and still lands when it can.
 * The success path does NOT use this helper: since the T-1.10 gate decision
 * it awaits its write unboundedly, so a success is never displayed before
 * its route event is durably saved.
 */
async function recordBounded(
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

export async function runTriage(deps: TriageDeps, ticket: Ticket): Promise<TriageOutcome> {
  const recordTimeoutMs = deps.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS;
  const started = performance.now();
  try {
    const result = await deps.adapter.generateStructured(buildTriagePrompt(ticket));
    const latencyMs = Math.round(performance.now() - started);
    if (!result.inferenceSource) {
      throw new Error('The inference result did not report which route ran, so the task is recorded as failed rather than guessed (SPEC NFR-2).');
    }
    const parsed = parseTriageResponse(result.text);
    const triage: TriageResult = {
      ...parsed,
      actualSource: result.inferenceSource,
      latencyMs,
      completedAt: new Date().toISOString(),
    };
    // Strict success rule (Pintu's T-1.10 gate decision, 12 Nov 2026): a
    // success is displayed only once its route event is durably saved, so
    // this write is awaited WITHOUT the failure-path bound. If it rejects,
    // the throw lands in the catch below and the run is surfaced as failed
    // — the displayed record and the stored proof never diverge. (While
    // fully offline this await can pend until reconnect; Slice 2's offline
    // success path must handle that explicitly — see spec/QA-SLICE-1.md.)
    await deps.writer.record({
      ticketId: ticket.id,
      taskType: 'triage',
      requestedMode: 'prefer_on_device',
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
      await recordBounded(
        deps.writer,
        {
          ticketId: ticket.id,
          taskType: 'triage',
          requestedMode: 'prefer_on_device',
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
