import {
  REDACTED_ARTEFACT_BRAND,
  type Category,
  type PayloadGate,
  type RedactedArtefact,
  type RedactedEscalation,
  type Sentiment,
  type Ticket,
  type TriageResult,
  type Urgency,
} from '../lib/types';
import { detectPersonalData, produceRedactedArtefact } from './redaction';

/**
 * Cloud-payload safety gate (SPEC FR-6, FR-7; TASKS T-2.3, T-2.4).
 *
 * The builder's only content input is a RedactedArtefact — the brand makes
 * handing it a raw ticket a compile-time error, and the runtime check
 * below refuses unbranded objects as well. Before any payload is treated
 * as usable, the deterministic pattern checks run over it again: a
 * labelled pattern that survived redaction BLOCKS the payload (NFR-4).
 */

export interface EscalationMeta {
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  /** Null in Slice 2 — the routing engine assigns triggers in Slice 3. */
  escalationTrigger: string | null;
  issueCount: number;
  /**
   * Personal-data count reported by triage (a model count over the raw
   * ticket). When it exceeds what the deterministic checks redacted, the
   * payload is held for review: something the model saw may not have been
   * caught, and the operator must look before this payload is ever used.
   */
  triagePersonalDataCount: number | null;
}

export interface BuiltEscalation {
  payload: RedactedEscalation;
  gate: PayloadGate;
}

function assertArtefact(candidate: unknown): asserts candidate is RedactedArtefact {
  const branded =
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate as Record<PropertyKey, unknown>)[REDACTED_ARTEFACT_BRAND] === true &&
    typeof (candidate as RedactedArtefact).redactedSummary === 'string' &&
    typeof (candidate as RedactedArtefact).redactedBody === 'string';
  if (!branded) {
    throw new Error(
      'Cloud payloads can only be built from a redacted artefact produced on-device. Raw tickets are refused.',
    );
  }
}

/**
 * Builds the exact escalation payload from a redacted artefact plus triage
 * metadata, and applies the pre-send safety gate. This is the single
 * builder: the "What the cloud sees" preview and the (Slice 3) escalation
 * path consume the object returned here — identical by construction.
 */
export function buildEscalationPayload(
  artefact: RedactedArtefact,
  meta: EscalationMeta,
): BuiltEscalation {
  assertArtefact(artefact);

  const payload: RedactedEscalation = {
    redactedSummary: artefact.redactedSummary,
    category: meta.category,
    urgency: meta.urgency,
    sentiment: meta.sentiment,
    escalationTrigger: meta.escalationTrigger,
    issueCount: meta.issueCount,
    bodyCharacterCount: artefact.redactedBody.length,
    redactionCount: artefact.redactionCount,
  };

  // Pre-send pattern check over every free-text field of the payload.
  const surviving = detectPersonalData(payload.redactedSummary);
  if (surviving.length > 0) {
    const survivingTypes = [...new Set(surviving.map((d) => d.type))];
    return {
      payload,
      gate: {
        status: 'blocked',
        survivingTypes,
        note: `Blocked: ${surviving.length} labelled personal-data pattern(s) survived redaction (${survivingTypes.join(', ')}). This payload must not leave the device.`,
      },
    };
  }

  if (
    meta.triagePersonalDataCount !== null &&
    meta.triagePersonalDataCount > artefact.redactionCount
  ) {
    return {
      payload,
      gate: {
        status: 'held-for-review',
        survivingTypes: [],
        note: `Held for review: triage reported ${meta.triagePersonalDataCount} personal-data items, but the deterministic checks redacted ${artefact.redactionCount}. Check the redacted text before this payload is used.`,
      },
    };
  }

  return {
    payload,
    gate: {
      status: 'minimised',
      survivingTypes: [],
      note: 'Minimised: the payload contains only the redacted summary and ticket metadata, and the pattern checks find nothing left to mask.',
    },
  };
}

export interface EscalationPreview {
  artefact: RedactedArtefact;
  payload: RedactedEscalation;
  gate: PayloadGate;
}

/**
 * The one preparation path behind the "What the cloud sees" preview
 * (T-2.4): redacts the ticket on-device, then builds the payload through
 * the same builder the escalation path will use.
 */
export function prepareEscalation(ticket: Ticket, triage: TriageResult): EscalationPreview {
  const artefact = produceRedactedArtefact(ticket);
  const { payload, gate } = buildEscalationPayload(artefact, {
    category: triage.category,
    urgency: triage.urgency,
    sentiment: triage.sentiment,
    escalationTrigger: null,
    issueCount: triage.issueCount,
    triagePersonalDataCount: triage.personalDataCount,
  });
  return { artefact, payload, gate };
}
