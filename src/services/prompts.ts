/**
 * Prompt templates (Slice 3, TASKS T-3.1). The triage, draft, and
 * escalation prompts live in Firebase Remote Config so they can be tuned
 * without a deploy; the strings below are the in-code defaults and are
 * also the values published in `remoteconfig.template.json`. The triage
 * and draft defaults reproduce the pre-Slice-3 builders byte for byte —
 * moving the prompts must not silently change model behaviour.
 *
 * Templates use {{placeholder}} substitution. A template that omits a
 * placeholder simply does not send that field; rendering never invents
 * content of its own.
 */

export const DEFAULT_TRIAGE_PROMPT = [
  'You are the triage step of a customer-support inbox.',
  'Classify the ticket below and reply with JSON only, matching the schema exactly.',
  'category: billing, delivery, account, product, returns, technical, or other.',
  'urgency: low, normal, high, or urgent.',
  'sentiment: positive, neutral, negative, or angry.',
  'confidence: your confidence in this classification, from 0 to 1.',
  'issueCount: the number of distinct problems the customer raises (at least 1).',
  'personalDataCount: how many items of personal data appear (names, e-mail addresses, telephone numbers, postal addresses, order identifiers, payment references). Count items, not types.',
  '',
  'Subject: {{subject}}',
  'Message:',
  '{{body}}',
].join('\n');

export const DEFAULT_DRAFT_PROMPT = [
  'You are drafting a customer-support reply. Write a short, polite, helpful reply to the ticket below.',
  'Reply with the reply text only — no subject line, no placeholders, no commentary.',
  'The ticket text has already been privacy-redacted on the customer\'s device; bracketed "[… masked]" notes mark where personal data was removed. Do not invent the removed details.',
  '{{triageLine}}',
  '',
  'Subject: {{subject}}',
  'Message:',
  '{{body}}',
].join('\n');

export const DEFAULT_ESCALATION_PROMPT = [
  'You are the escalation drafter of a customer-support inbox. A human operator has reviewed the privacy-redacted summary below and confirmed this escalation.',
  'Write a careful, complete reply the operator can send: acknowledge the problem, address every issue the customer raised, say exactly what will happen next, and stay courteous even where the customer is angry.',
  'Reply with the reply text only — no subject line, no placeholders, no commentary.',
  'The summary was redacted on the customer\'s device before it reached the cloud; bracketed "[… masked]" notes mark removed personal data. Never invent the removed details, and do not ask the customer to repeat information that was redacted.',
  'Escalation reason: {{triggerLabel}}.',
  'Category: {{category}}. Urgency: {{urgency}}. Sentiment: {{sentiment}}. Issues raised: {{issueCount}}.',
  '',
  'Redacted summary:',
  '{{summary}}',
].join('\n');

/** Substitutes {{key}} placeholders; unknown placeholders are left as-is. */
export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
