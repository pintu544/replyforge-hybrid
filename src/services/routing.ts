import type { Sentiment } from '../lib/types';
import type { RoutingConfig } from './appConfig';

/**
 * App-level routing engine (SPEC FR-5, GRILL Q5, TASKS T-3.2).
 *
 * The engine is deterministic application code: given the triage result,
 * the ticket language, and the REDACTED artefact text, it decides whether
 * the ticket stays on the simple path or escalates to a cloud draft, and
 * names the reason. It never claims a route — it only selects the path;
 * the actual route of any AI task still comes from the inference result.
 *
 * Text checks (the refund/legal keyword scan) run on the redacted
 * artefact text only. Keywords are not personal data, so they survive
 * redaction and remain visible to the engine; the raw ticket body is
 * never an input here.
 */

export const ESCALATION_TRIGGERS = [
  'length-complexity',
  'negative-sentiment',
  'refund-legal-intent',
  'multiple-issues',
  'low-confidence',
  'unsupported-language',
] as const;

export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

/** Human-readable reason labels, shown on cards and stored on drafts. */
export const TRIGGER_LABELS: Record<EscalationTrigger, string> = {
  'length-complexity': 'Long or complex ticket',
  'negative-sentiment': 'Negative sentiment',
  'refund-legal-intent': 'Refund or legal intent',
  'multiple-issues': 'Multiple issues',
  'low-confidence': 'Low triage confidence',
  'unsupported-language': 'Language not supported on-device',
};

/**
 * Languages the on-device model supports (Firebase hybrid documentation,
 * research 12 Nov 2026). Anything else is a designed cloud escalation —
 * on-device processing in Hindi, for example, is out of scope by design.
 */
export const ON_DEVICE_LANGUAGES: readonly string[] = ['en', 'ja', 'es', 'de', 'fr'];

export interface RoutingInput {
  sentiment: Sentiment;
  /** Triage confidence, 0..1. */
  confidence: number;
  issueCount: number;
  /** Ticket language code (e.g. 'en', 'hi'). */
  language: string;
  /** Redacted subject + body text — the keyword scan runs on this only. */
  redactedText: string;
  /** Character count of the redacted body (the payload's own count). */
  redactedBodyChars: number;
}

export interface RoutingDecision {
  route: 'simple' | 'escalate';
  /** The reason label when escalating; null on the simple path. */
  trigger: EscalationTrigger | null;
  /** Factual explanation for the operator. */
  reason: string;
}

function containsKeyword(text: string, keyword: string): boolean {
  const haystack = text.toLowerCase();
  const needle = keyword.toLowerCase();
  if (needle.includes(' ')) return haystack.includes(needle);
  return new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`).test(haystack);
}

/**
 * Decides the path for one triaged ticket. Trigger priority is fixed and
 * documented — the first matching rule names the escalation:
 *
 * 1. unsupported language (the device route cannot serve it at all);
 * 2. refund or legal intent (keyword scan of the redacted text);
 * 3. length or complexity (redacted body over the configured threshold);
 * 4. multiple issues (triage counted at least two distinct problems);
 * 5. negative sentiment (the customer is angry — the strongest negative
 *    reading; a merely 'negative' ticket stays simple, which is what the
 *    fixture labels show);
 * 6. low confidence (triage confidence under the configured minimum —
 *    the fallback signal when nothing else explains the ticket).
 */
export function decideRoute(input: RoutingInput, config: RoutingConfig): RoutingDecision {
  if (!ON_DEVICE_LANGUAGES.includes(input.language.toLowerCase())) {
    return {
      route: 'escalate',
      trigger: 'unsupported-language',
      reason: `The ticket language (${input.language}) is not one of the on-device languages (${ON_DEVICE_LANGUAGES.join(', ')}), so a cloud draft is the designed path.`,
    };
  }

  const matchedKeyword = config.escalationKeywords.find((keyword) =>
    containsKeyword(input.redactedText, keyword),
  );
  if (matchedKeyword) {
    return {
      route: 'escalate',
      trigger: 'refund-legal-intent',
      reason: `The redacted text contains refund/legal wording (“${matchedKeyword}”), which needs a careful cloud draft.`,
    };
  }

  if (input.redactedBodyChars > config.escalationLengthChars) {
    return {
      route: 'escalate',
      trigger: 'length-complexity',
      reason: `The redacted ticket body is ${input.redactedBodyChars} characters, over the ${config.escalationLengthChars}-character escalation threshold.`,
    };
  }

  if (input.issueCount >= 2) {
    return {
      route: 'escalate',
      trigger: 'multiple-issues',
      reason: `Triage counted ${input.issueCount} distinct issues; multi-issue tickets escalate to a cloud draft.`,
    };
  }

  if (input.sentiment === 'angry') {
    return {
      route: 'escalate',
      trigger: 'negative-sentiment',
      reason: 'The customer is angry; an escalation draft handles the tone more carefully than the simple path.',
    };
  }

  if (input.confidence < config.escalationConfidenceMin) {
    return {
      route: 'escalate',
      trigger: 'low-confidence',
      reason: `Triage confidence is ${Math.round(input.confidence * 100)}%, under the ${Math.round(config.escalationConfidenceMin * 100)}% minimum for the simple path.`,
    };
  }

  return {
    route: 'simple',
    trigger: null,
    reason: 'No escalation trigger is present: the ticket stays on the simple path.',
  };
}
