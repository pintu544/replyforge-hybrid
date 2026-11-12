import type {
  Draft,
  RedactedArtefact,
  RequestedMode,
  Ticket,
} from '../lib/types';
import type { InferenceAdapter } from './inference';
import { detectPersonalData } from './redaction';
import {
  DEFAULT_RECORD_TIMEOUT_MS,
  recordRouteEventBounded,
  type RouteEventWriter,
} from './routeEvents';

/**
 * Simple-reply drafting (SPEC FR-4, TASKS T-2.5). The draft prompt is built
 * from the REDACTED artefact only (DESIGN.md: draftSimple takes the
 * redacted ticket), so no raw personal data is ever placed in a prompt —
 * on either route. Route events follow the same rules as triage, including
 * the strict success rule from the T-1.10 gate.
 */

export function buildDraftPrompt(artefact: RedactedArtefact, ticket: Ticket): string {
  return [
    'You are drafting a customer-support reply. Write a short, polite, helpful reply to the ticket below.',
    'Reply with the reply text only — no subject line, no placeholders, no commentary.',
    'The ticket text has already been privacy-redacted on the customer\'s device; bracketed "[… masked]" notes mark where personal data was removed. Do not invent the removed details.',
    ticket.triage
      ? `Triage: category ${ticket.triage.category}, urgency ${ticket.triage.urgency}, sentiment ${ticket.triage.sentiment}.`
      : 'Triage has not been run for this ticket.',
    '',
    `Subject: ${artefact.redactedSubject}`,
    'Message:',
    artefact.redactedBody,
  ].join('\n');
}

export interface DraftResult {
  text: string;
  /** Actual route reported by the inference result — never the requested mode. */
  actualSource: NonNullable<Draft['actualSource']>;
  latencyMs: number;
  requestedMode: RequestedMode;
  completedAt: string;
}

export type DraftOutcome =
  | { status: 'success'; draft: DraftResult }
  | { status: 'failed'; error: string; latencyMs: number };

export interface DraftDeps {
  adapter: InferenceAdapter;
  writer: RouteEventWriter;
  isOnline: () => boolean;
  /** Handle the caller selected (Slice 2 task routing); default device-preferred. */
  requestedMode?: RequestedMode;
  /** Bound for the FAILURE-path event write only (see recordRouteEventBounded). */
  recordTimeoutMs?: number;
  /**
   * Slice 2 offline state model, mirroring triage: called with the draft
   * the moment generation succeeds, before the durable route-event write.
   * The caller may show it as completed locally / awaiting sync (no route
   * chip); the promise resolves as success only after the event is saved.
   */
  onLocalSuccess?: (draft: DraftResult) => void;
}

export async function runDraft(
  deps: DraftDeps,
  ticket: Ticket,
  artefact: RedactedArtefact,
): Promise<DraftOutcome> {
  const requestedMode = deps.requestedMode ?? 'prefer_on_device';
  const recordTimeoutMs = deps.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS;
  const started = performance.now();
  try {
    // Defence in depth (T-2.8 QA): re-scan the redacted artefact before
    // any prompt is built. The artefact is supposed to be pattern-free;
    // if a labelled pattern survived (a detector gap, or a stale or
    // hand-built artefact), the draft is blocked with a visible reason
    // rather than placing the value in a prompt. Only the pattern TYPES
    // are named in the error — never a surviving value.
    const surviving = [
      ...detectPersonalData(artefact.redactedSubject),
      ...detectPersonalData(artefact.redactedBody),
    ];
    if (surviving.length > 0) {
      const survivingTypes = [...new Set(surviving.map((d) => d.type))].join(', ');
      throw new Error(
        `Drafting was blocked: ${surviving.length} labelled personal-data pattern(s) survived redaction (${survivingTypes}). Re-run redaction on this ticket; if it persists, edit the ticket text before drafting.`,
      );
    }
    const result = await deps.adapter.generateText(buildDraftPrompt(artefact, ticket));
    const latencyMs = Math.round(performance.now() - started);
    if (!result.inferenceSource) {
      throw new Error('The draft result did not report which route ran, so it is recorded as failed rather than guessed (SPEC NFR-2).');
    }
    if (requestedMode === 'only_on_device' && result.inferenceSource !== 'on_device') {
      throw new Error('Privacy Mode: the draft result reported a cloud route, so it was discarded rather than shown.');
    }
    const text = result.text.trim();
    if (!text) {
      throw new Error('The model returned an empty draft, so nothing was saved as a reply. Regenerate it, or write the reply manually.');
    }
    const draft: DraftResult = {
      text,
      actualSource: result.inferenceSource,
      latencyMs,
      requestedMode,
      completedAt: new Date().toISOString(),
    };
    deps.onLocalSuccess?.(draft);
    // Strict success rule (T-1.10 gate): awaited unboundedly, exactly as
    // triage. A rejection surfaces the run as failed, never as a success
    // without its stored proof.
    await deps.writer.record({
      ticketId: ticket.id,
      taskType: 'simple-draft',
      requestedMode,
      actualSource: result.inferenceSource,
      latencyMs,
      outcome: result.inferenceSource === 'on_device' ? 'success' : 'fallback',
      escalationTrigger: null,
      redactionCount: artefact.redactionCount,
      online: deps.isOnline(),
    });
    return { status: 'success', draft };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    try {
      await recordRouteEventBounded(
        deps.writer,
        {
          ticketId: ticket.id,
          taskType: 'simple-draft',
          requestedMode,
          actualSource: null,
          latencyMs,
          outcome: 'failed',
          escalationTrigger: null,
          redactionCount: artefact.redactionCount,
          online: deps.isOnline(),
        },
        recordTimeoutMs,
      );
    } catch {
      // The visible failed state below is the primary record.
    }
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Drafting failed for an unknown reason.',
      latencyMs,
    };
  }
}

/** The single active draft record for a ticket in Slice 2. */
export function draftRecordId(ticketId: string): string {
  return `draft-${ticketId}`;
}

export function toDraftRecord(ticket: Ticket, result: DraftResult): Draft {
  return {
    id: draftRecordId(ticket.id),
    ticketId: ticket.id,
    text: result.text,
    requestedMode: result.requestedMode,
    actualSource: result.actualSource,
    latencyMs: result.latencyMs,
    escalationReason: null,
    state: 'draft',
    updatedAt: result.completedAt,
  };
}

/** A draft the operator wrote by hand: no AI task ran, so no route exists. */
export function manualDraftRecord(ticket: Ticket, text: string): Draft {
  return {
    id: draftRecordId(ticket.id),
    ticketId: ticket.id,
    text,
    requestedMode: null,
    actualSource: null,
    latencyMs: null,
    escalationReason: null,
    state: 'draft',
    updatedAt: new Date().toISOString(),
  };
}

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'queued'; note: string }
  | { status: 'failed'; error: string; nextAction: string };

/**
 * Simulated send (SPEC FR-10, TASKS T-2.7). The `save` closure is the whole
 * send: it persists the draft as sent-simulated and the ticket status in
 * the user's own Firestore partition. There is deliberately no network
 * call to any mail or messaging service anywhere in this path — the send
 * is a simulation by construction.
 *
 * Offline semantics (FR-11): if the save settles, the send is complete; if
 * it rejects, the send failed and the ticket is preserved with a next
 * action; if it outlives the bound (the offline case — the SDK queues the
 * writes), the send is visibly QUEUED and the writes still land on
 * reconnect.
 */
export async function sendSimulated(
  save: () => Promise<void>,
  timeoutMs: number = DEFAULT_RECORD_TIMEOUT_MS,
): Promise<SendOutcome> {
  const settled = save().then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([settled, expired]);
    if (result === 'timeout') {
      // The queued writes may still reject after we stop waiting; swallow
      // that late rejection — the queued state already told the operator
      // the send has not completed.
      settled.catch(() => {});
      return {
        status: 'queued',
        note: 'No connection: this simulated send is queued and will complete when the connection returns. The ticket and draft are preserved.',
      };
    }
    if (!result.ok) {
      return {
        status: 'failed',
        error: result.err instanceof Error ? result.err.message : 'The simulated send could not be saved.',
        nextAction: 'Check the connection and send again. The ticket and your edited draft are preserved.',
      };
    }
    return { status: 'sent' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
