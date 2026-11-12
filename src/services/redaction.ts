import {
  REDACTED_ARTEFACT_BRAND,
  type PersonalDataEntity,
  type PersonalDataType,
  type RedactedArtefact,
  type Ticket,
} from '../lib/types';

/**
 * Deterministic personal-data checks and on-device redaction (SPEC FR-3,
 * FR-7; TASKS T-2.1, T-2.2). Pure local code: no model call is involved in
 * detecting or masking, so redaction runs identically offline and in
 * Privacy Mode.
 *
 * Scope, stated honestly: the checks cover the LABELLED pattern types of
 * the fixture gold set — e-mail, telephone, order identifier, payment
 * reference, postal address, and names in common introduction or sign-off
 * forms ("my name is …", "call me, …", a delivery recipient, a quoted
 * from/to name change). They are verified against that labelled set; they
 * do not claim to catch arbitrary free-text names or unusual formats.
 */

export interface Detection {
  type: PersonalDataType;
  /** Raw value, held in memory only so it can be masked. Never logged. */
  value: string;
  maskedValue: string;
  /** Character span within the text the detection was found in. */
  index: number;
  length: number;
  /** Exact string the redactor splices over the span. */
  replacement: string;
}

const MASK_TOKEN: Record<PersonalDataType, string> = {
  email: '[e-mail masked]',
  phone: '[telephone masked]',
  'order-id': '[order identifier masked]',
  'payment-reference': '[payment reference masked]',
  'postal-address': '[postal address masked]',
  name: '[name masked]',
};

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return `${local.charAt(0)}•••@${domain.charAt(0)}•••${dot >= 0 ? domain.slice(dot) : ''}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const lastTwo = digits.slice(-2);
  return value.trimStart().startsWith('+')
    ? `+91 ••••• ••${lastTwo}`
    : `••••• ••${lastTwo}`;
}

function maskOrderId(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `ORD-•••${digits.slice(-2)}`;
}

function maskPaymentReference(value: string): string {
  return `pay_•••${value.slice(-2)}`;
}

function maskPostalAddress(value: string): string {
  const pin = value.replace(/\D/g, '').slice(-6);
  return `••• (PIN •••${pin.slice(-3)})`;
}

function maskName(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => `${word.charAt(0)}.`)
    .join(' ');
}

const MASKERS: Record<PersonalDataType, (value: string) => string> = {
  email: maskEmail,
  phone: maskPhone,
  'order-id': maskOrderId,
  'payment-reference': maskPaymentReference,
  'postal-address': maskPostalAddress,
  name: maskName,
};

/** Identity used to count DISTINCT items: formatting variants are one item. */
function distinctKey(type: PersonalDataType, value: string): string {
  switch (type) {
    case 'email':
      return value.toLowerCase();
    case 'phone':
      // The country code is formatting: +91 98200 11223 and 9820011223 are
      // the same item, so identity is the final ten digits.
      return value.replace(/\D/g, '').slice(-10);
    case 'order-id':
      return value.replace(/\D/g, '');
    case 'postal-address':
      return value.toLowerCase().replace(/[\s,]+/g, ' ').trim();
    case 'payment-reference':
    case 'name':
      return value.toLowerCase();
  }
}

interface RawMatch {
  type: PersonalDataType;
  value: string;
  index: number;
  length: number;
  replacement?: string;
  maskedValue?: string;
}

function collect(re: RegExp, text: string, type: PersonalDataType, group = 0): RawMatch[] {
  const out: RawMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[group];
    const index = group === 0 ? m.index : m.index + m[0].indexOf(value);
    out.push({ type, value, index, length: value.length });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

function collectRawMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];

  matches.push(...collect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, text, 'email'));
  matches.push(...collect(/\bpay_[A-Za-z0-9]{6,}\b/g, text, 'payment-reference'));
  matches.push(...collect(/\bORD[-\s]?\d{4,}\b/gi, text, 'order-id'));
  // Telephone: Indian numbers, with the country code and the digit groups
  // optionally split by spaces, dots, or dashes (or not split at all).
  matches.push(...collect(/(?<!\d)(?:\+91[\s.-]?)?\d{5}[\s.-]?\d{5}(?!\d)/g, text, 'phone'));
  // Postal address: house number, street name + suffix, city, 6-digit PIN;
  // the commas are optional.
  matches.push(
    ...collect(
      /\b\d{1,4}\s+[A-Za-z]+(?:\s+[A-Za-z]+)*?\s+(?:Lane|Road|Street|Avenue|Drive|Marg|Nagar|Place|Court),?\s+[A-Za-z]+(?:\s+[A-Za-z]+)*?,?\s+\d{6}(?!\d)/g,
      text,
      'postal-address',
    ),
  );
  // Names — phrase-anchored forms only (see the scope note above).
  // A quoted from/to name change is ONE labelled item covering two forms.
  for (const m of text.matchAll(/from\s+"([^"]+)"\s+to\s+"([^"]+)"/g)) {
    matches.push({
      type: 'name',
      value: m[0],
      index: m.index,
      length: m[0].length,
      replacement: `from "${MASK_TOKEN.name}" to "${MASK_TOKEN.name}"`,
      maskedValue: `${maskName(m[1])} → ${maskName(m[2])}`,
    });
  }
  // Note: no /i flag on the name group — the name itself must be capitalised,
  // or the pattern would swallow following lowercase words ("…and you can…").
  matches.push(...collect(/[Mm]y name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g, text, 'name', 1));
  matches.push(...collect(/call me,?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g, text, 'name', 1));
  // Delivery recipient: "Priya Nair, 14 Rosewood Lane, …".
  matches.push(...collect(/([A-Z][a-z]+\s+[A-Z][a-z]+)(?=,\s*\d{1,4}\s)/g, text, 'name', 1));

  // Resolve overlaps: earliest span wins; for equal starts, the longer wins.
  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  const accepted: RawMatch[] = [];
  let coveredUntil = -1;
  for (const match of matches) {
    if (match.index < coveredUntil) continue;
    accepted.push(match);
    coveredUntil = match.index + match.length;
  }
  return accepted;
}

/**
 * Runs every deterministic check over one text. Returns one Detection per
 * occurrence, in document order. The raw value exists only inside the
 * returned objects so the caller can mask it — it must never be copied
 * into a log, an entity, or a route event.
 */
export function detectPersonalData(text: string): Detection[] {
  return collectRawMatches(text).map((match) => ({
    type: match.type,
    value: match.value,
    maskedValue: match.maskedValue ?? MASKERS[match.type](match.value),
    index: match.index,
    length: match.length,
    replacement: match.replacement ?? MASK_TOKEN[match.type],
  }));
}

function redactText(text: string, detections: Detection[]): string {
  let out = '';
  let cursor = 0;
  for (const d of detections) {
    out += text.slice(cursor, d.index) + d.replacement;
    cursor = d.index + d.length;
  }
  return out + text.slice(cursor);
}

function buildSummary(redactedSubject: string, redactedBody: string): string {
  const body = redactedBody.trim();
  const firstSentence = body.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? '';
  const combined = firstSentence ? `${redactedSubject} — ${firstSentence}` : redactedSubject;
  return combined.length > 240 ? `${combined.slice(0, 237).trimEnd()}…` : combined;
}

/**
 * Produces the redacted artefact for a ticket (T-2.2). Deterministic local
 * code — no model call. Every labelled pattern found in the subject or
 * body is masked in the artefact; the count is the number of DISTINCT
 * items (a value repeated in the subject and the body is one item, which
 * is how the fixture labels count it).
 */
export function produceRedactedArtefact(
  ticket: Pick<Ticket, 'id' | 'subject' | 'body'>,
): RedactedArtefact {
  const subjectDetections = detectPersonalData(ticket.subject);
  const bodyDetections = detectPersonalData(ticket.body);
  const redactedSubject = redactText(ticket.subject, subjectDetections);
  const redactedBody = redactText(ticket.body, bodyDetections);

  const byKey = new Map<string, PersonalDataEntity & { key: string }>();
  for (const d of [...subjectDetections, ...bodyDetections]) {
    const key = `${d.type}:${distinctKey(d.type, d.value)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { key, type: d.type, maskedValue: d.maskedValue, count: 1 });
    }
  }
  const entities: PersonalDataEntity[] = [...byKey.values()].map((entry) => ({
    type: entry.type,
    maskedValue: entry.maskedValue,
    count: entry.count,
  }));

  return {
    [REDACTED_ARTEFACT_BRAND]: true,
    sourceTicketId: ticket.id,
    redactedSubject,
    redactedBody,
    redactedSummary: buildSummary(redactedSubject, redactedBody),
    entities,
    redactionCount: entities.length,
  };
}
