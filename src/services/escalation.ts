import type {
  Draft,
  RedactedEscalation,
  Ticket,
} from '../lib/types';
import type { InferenceAdapter } from './inference';
import type { BuiltEscalation } from './payload';
import { DEFAULT_ESCALATION_PROMPT, renderPrompt } from './prompts';
import { TRIGGER_LABELS, type EscalationTrigger } from './routing';
import {
  DEFAULT_RECORD_TIMEOUT_MS,
  recordRouteEventBounded,
  type RouteEventWriter,
} from './routeEvents';
import { draftRecordId } from './drafts';

/**
 * Cloud escalation drafting (SPEC FR-5, FR-6; TASKS T-3.3).
 *
 * The escalation consumes the exact BuiltEscalation the "What the cloud
 * sees" preview produced — the payload is never rebuilt here. The prompt
 * is rendered from the payload fields only; a raw-body field does not
 * exist on the payload type, so there is nothing raw to send. The ticket
 * id is passed separately as bookkeeping metadata for the route event —
 * it is never part of the prompt or the payload.
 *
 * Gate semantics (Slice 2's gate, wired to action here):
 * - blocked: the payload must not leave the device. No model call is
 *   made; the block is recorded as a route event with outcome 'blocked'.
 * - held-for-review: the operator's explicit confirmation IS the preview
 *   confirmation — without it, this function returns 'needs-confirmation'
 *   and makes no call.
 * - minimised: the preview confirmation is still required (T-3.3: drafts
 *   are produced only after the operator confirms the previewed payload).
 *
 * Privacy Mode: an escalation is a cloud call by definition, so with
 * Privacy Mode on the task is refused before any handle is invoked and
 * the refusal is recorded (SPEC FR-8) — the same shape as the Slice 2
 * refusals.
 */

export const ESCALATION_PRIVACY_REASON =
  'Privacy Mode is on, and an escalation draft runs in the cloud by definition, so it cannot run under Privacy Mode.';
export const ESCALATION_PRIVACY_ALTERNATIVE =
  'Turn off Privacy Mode to escalate this ticket, or draft the reply on the simple path instead.';

export function triggerLabel(trigger: string | null): string {
  if (!trigger) return 'Escalation';
  return TRIGGER_LABELS[trigger as EscalationTrigger] ?? trigger;
}

/** Renders the escalation prompt from the payload — and only the payload. */
export function buildEscalationPrompt(
  payload: RedactedEscalation,
  template: string = DEFAULT_ESCALATION_PROMPT,
): string {
  return renderPrompt(template, {
    triggerLabel: triggerLabel(payload.escalationTrigger),
    category: payload.category,
    urgency: payload.urgency,
    sentiment: payload.sentiment,
    issueCount: String(payload.issueCount),
    summary: payload.redactedSummary,
  });
}

export interface EscalationResult {
  text: string;
  /** Actual route reported by the inference result — never the requested mode. */
  actualSource: NonNullable<Draft['actualSource']>;
  latencyMs: number;
  completedAt: string;
  escalationTrigger: string | null;
}

export type EscalationOutcome =
  | { status: 'success'; result: EscalationResult }
  | { status: 'failed'; error: string; latencyMs: number }
  | { status: 'blocked'; note: string }
  | { status: 'needs-confirmation'; note: string }
  | { status: 'refused'; reason: string; alternative: string };

export interface EscalationDeps {
  adapter: InferenceAdapter;
  writer: RouteEventWriter;
  isOnline: () => boolean;
  /** The operator confirmed the previewed payload in the UI. */
  confirmedByOperator: boolean;
  /** Privacy Mode state; an escalation under it is refused (FR-8). */
  privacyMode: boolean;
  /** Prompt template (Remote Config, Slice 3); defaults to the in-code template. */
  promptTemplate?: string;
  /** Bound for non-success event writes only (see recordRouteEventBounded). */
  recordTimeoutMs?: number;
  /**
   * Awaiting-sync hook, mirroring triage/drafts: called the moment
   * generation succeeds, before the durable route-event write. The
   * promise still resolves as success only after the event is saved
   * (strict rule, T-1.10).
   */
  onLocalSuccess?: (result: EscalationResult) => void;
}

export async function runEscalation(
  deps: EscalationDeps,
  ticketId: string,
  built: BuiltEscalation,
): Promise<EscalationOutcome> {
  const { payload, gate } = built;
  const recordTimeoutMs = deps.recordTimeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS;

  if (deps.privacyMode) {
    // Refused before any handle is invoked — zero cloud calls by
    // construction. The refusal is a non-success record: bounded write.
    try {
      await recordRouteEventBounded(
        deps.writer,
        {
          ticketId,
          taskType: 'escalation-draft',
          requestedMode: 'only_on_device',
          actualSource: null,
          latencyMs: 0,
          outcome: 'blocked',
          escalationTrigger: payload.escalationTrigger,
          redactionCount: payload.redactionCount,
          online: deps.isOnline(),
        },
        recordTimeoutMs,
      );
    } catch {
      // The visible refusal below is the primary record.
    }
    return {
      status: 'refused',
      reason: ESCALATION_PRIVACY_REASON,
      alternative: ESCALATION_PRIVACY_ALTERNATIVE,
    };
  }

  if (gate.status === 'blocked') {
    try {
      await recordRouteEventBounded(
        deps.writer,
        {
          ticketId,
          taskType: 'escalation-draft',
          requestedMode: 'prefer_in_cloud',
          actualSource: null,
          latencyMs: 0,
          outcome: 'blocked',
          escalationTrigger: payload.escalationTrigger,
          redactionCount: payload.redactionCount,
          online: deps.isOnline(),
        },
        recordTimeoutMs,
      );
    } catch {
      // The visible blocked state below is the primary record.
    }
    return { status: 'blocked', note: gate.note };
  }

  if (!deps.confirmedByOperator) {
    return {
      status: 'needs-confirmation',
      note:
        gate.status === 'held-for-review'
          ? `${gate.note} Confirm the previewed payload to escalate.`
          : 'The escalation draft is produced only after you confirm the previewed payload.',
    };
  }

  const started = performance.now();
  try {
    const result = await deps.adapter.generateText(
      buildEscalationPrompt(payload, deps.promptTemplate ?? DEFAULT_ESCALATION_PROMPT),
    );
    const latencyMs = Math.round(performance.now() - started);
    if (!result.inferenceSource) {
      throw new Error('The escalation result did not report which route ran, so it is recorded as failed rather than guessed (SPEC NFR-2).');
    }
    const text = result.text.trim();
    if (!text) {
      throw new Error('The cloud model returned an empty escalation draft, so nothing was saved as a reply.');
    }
    const escalationResult: EscalationResult = {
      text,
      actualSource: result.inferenceSource,
      latencyMs,
      completedAt: new Date().toISOString(),
      escalationTrigger: payload.escalationTrigger,
    };
    deps.onLocalSuccess?.(escalationResult);
    // Strict success rule (T-1.10 gate): awaited unboundedly, exactly as
    // triage and simple drafts. A rejection surfaces as failed.
    await deps.writer.record({
      ticketId,
      taskType: 'escalation-draft',
      requestedMode: 'prefer_in_cloud',
      actualSource: result.inferenceSource,
      latencyMs,
      outcome: result.inferenceSource === 'in_cloud' ? 'success' : 'fallback',
      escalationTrigger: payload.escalationTrigger,
      redactionCount: payload.redactionCount,
      online: deps.isOnline(),
    });
    return { status: 'success', result: escalationResult };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    try {
      await recordRouteEventBounded(
        deps.writer,
        {
          ticketId,
          taskType: 'escalation-draft',
          requestedMode: 'prefer_in_cloud',
          actualSource: null,
          latencyMs,
          outcome: 'failed',
          escalationTrigger: payload.escalationTrigger,
          redactionCount: payload.redactionCount,
          online: deps.isOnline(),
        },
        recordTimeoutMs,
      );
    } catch {
      // The visible failed state below is the primary record.
    }
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Escalation drafting failed for an unknown reason.',
      latencyMs,
    };
  }
}

/** Builds the stored draft record for a successful escalation. */
export function toEscalationDraftRecord(
  ticket: Ticket,
  payload: RedactedEscalation,
  result: EscalationResult,
): Draft {
  return {
    id: draftRecordId(ticket.id),
    ticketId: ticket.id,
    text: result.text,
    requestedMode: 'prefer_in_cloud',
    actualSource: result.actualSource,
    latencyMs: result.latencyMs,
    escalationReason: triggerLabel(payload.escalationTrigger),
    state: 'draft',
    updatedAt: result.completedAt,
  };
}
