import { describe, expect, it } from 'vitest';
import type { FixtureFile, PersonalDataType, Ticket } from '../lib/types';
import { fixtureRecordToTicket } from './fixtureLoader';
import { detectPersonalData, produceRedactedArtefact } from './redaction';
import fixtureFileJson from '../../fixtures/tickets.json';

const fixtureFile = fixtureFileJson as FixtureFile;

function fixtureTickets(): Ticket[] {
  return fixtureFile.tickets.map((record) =>
    fixtureRecordToTicket(record, fixtureFile.fixtureVersion, fixtureFile.referenceTime, 'user-test-1'),
  );
}

function labelCountsByType(ticket: Ticket): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of ticket.fixture?.personalData ?? []) {
    map.set(p.type, (map.get(p.type) ?? 0) + p.count);
  }
  return map;
}

describe('personal-data pattern checks (T-2.1)', () => {
  it('detects every labelled type in the fixture with the labelled count, for all 30 tickets', () => {
    for (const ticket of fixtureTickets()) {
      const artefact = produceRedactedArtefact(ticket);
      const detectedByType = new Map<string, number>();
      for (const entity of artefact.entities) {
        detectedByType.set(entity.type, (detectedByType.get(entity.type) ?? 0) + 1);
      }
      // Both directions: nothing labelled is missed, nothing unlabelled is invented.
      expect(detectedByType, ticket.id).toEqual(labelCountsByType(ticket));
    }
  });

  it('covers each labelled pattern type with a concrete fixture value', () => {
    const cases: { text: string; type: PersonalDataType; raw: string }[] = [
      { text: 'My email is arjun.mehta@examplemail.com.', type: 'email', raw: 'arjun.mehta@examplemail.com' },
      { text: 'call me on +91 98200 11223 when close', type: 'phone', raw: '+91 98200 11223' },
      { text: 'return the headphones from order ORD-90210 please', type: 'order-id', raw: 'ORD-90210' },
      { text: 'Payment reference pay_8f42Kx91.', type: 'payment-reference', raw: 'pay_8f42Kx91' },
      {
        text: 'deliver to 14 Rosewood Lane, Pune 411001 instead',
        type: 'postal-address',
        raw: '14 Rosewood Lane, Pune 411001',
      },
      { text: 'My name is Meera Pillai and you can reach me', type: 'name', raw: 'Meera Pillai' },
    ];
    for (const c of cases) {
      const found = detectPersonalData(c.text).filter((d) => d.type === c.type);
      expect(found, c.text).toHaveLength(1);
      expect(found[0].value).toBe(c.raw);
    }
  });

  it('detects values split by spaces or punctuation', () => {
    const variants: { text: string; type: PersonalDataType }[] = [
      { text: 'call +91-98200-11223 today', type: 'phone' },
      { text: 'call +91.98200.11223 today', type: 'phone' },
      { text: 'call 9820011223 today', type: 'phone' },
      { text: 'call +91 9820011223 today', type: 'phone' },
      { text: 'about order ORD 78451 please', type: 'order-id' },
      { text: 'deliver to 14 Rosewood Lane Pune 411001 instead', type: 'postal-address' },
    ];
    for (const v of variants) {
      const found = detectPersonalData(v.text).filter((d) => d.type === v.type);
      expect(found, v.text).toHaveLength(1);
    }
    // Formatting variants of one value are ONE distinct item.
    const artefact = produceRedactedArtefact({
      id: 'manual-x',
      subject: 'Order ORD-78451',
      body: 'About ORD 78451 and +91 98200 11223 / 9820011223.',
    });
    expect(artefact.redactionCount).toBe(2);
  });

  it('returns type, masked value, and count — and the masked value never leaks the raw value', () => {
    const ticket = fixtureTickets().find((t) => t.id === 'RF-021');
    if (!ticket) throw new Error('RF-021 missing from fixture');
    const rawValues = [
      ...detectPersonalData(ticket.subject),
      ...detectPersonalData(ticket.body),
    ].map((d) => d.value);
    expect(rawValues.length).toBeGreaterThanOrEqual(5);
    const artefact = produceRedactedArtefact(ticket);
    for (const entity of artefact.entities) {
      expect(entity.count).toBeGreaterThanOrEqual(1);
      expect(entity.maskedValue.length).toBeGreaterThan(0);
      for (const raw of rawValues) {
        expect(entity.maskedValue).not.toContain(raw);
        expect(entity.maskedValue).not.toBe(raw);
      }
      // Entities carry no raw-value field at all.
      expect(Object.keys(entity).sort()).toEqual(['count', 'maskedValue', 'type']);
    }
  });
});

describe('redacted artefact (T-2.2)', () => {
  it('redaction count matches the fixture label total for every ticket', () => {
    for (const ticket of fixtureTickets()) {
      const labelTotal = (ticket.fixture?.personalData ?? []).reduce((sum, p) => sum + p.count, 0);
      const artefact = produceRedactedArtefact(ticket);
      expect(artefact.redactionCount, ticket.id).toBe(labelTotal);
    }
  });

  it('masks every labelled value in the redacted subject, body, and summary', () => {
    for (const ticket of fixtureTickets()) {
      const rawValues = [
        ...detectPersonalData(ticket.subject),
        ...detectPersonalData(ticket.body),
      ].map((d) => d.value);
      const artefact = produceRedactedArtefact(ticket);
      for (const raw of rawValues) {
        expect(artefact.redactedSubject, `${ticket.id} subject`).not.toContain(raw);
        expect(artefact.redactedBody, `${ticket.id} body`).not.toContain(raw);
        expect(artefact.redactedSummary, `${ticket.id} summary`).not.toContain(raw);
      }
      // Mask tokens show where values were removed.
      if (rawValues.length > 0) {
        expect(artefact.redactedBody).toContain('masked]');
      }
    }
  });

  it('produces a comparable redacted version of a ticket with no personal data, unchanged', () => {
    const ticket = fixtureTickets().find((t) => t.id === 'RF-001');
    if (!ticket) throw new Error('RF-001 missing from fixture');
    const artefact = produceRedactedArtefact(ticket);
    expect(artefact.redactionCount).toBe(0);
    expect(artefact.entities).toEqual([]);
    expect(artefact.redactedSubject).toBe(ticket.subject);
    expect(artefact.redactedBody).toBe(ticket.body);
    expect(artefact.redactedSummary).toContain(ticket.subject);
  });

  it('keeps the summary deterministic and derived from the redacted text only', () => {
    const ticket = fixtureTickets().find((t) => t.id === 'RF-005');
    if (!ticket) throw new Error('RF-005 missing from fixture');
    const a = produceRedactedArtefact(ticket);
    const b = produceRedactedArtefact(ticket);
    expect(a.redactedSummary).toBe(b.redactedSummary);
    expect(a.redactedSummary).toContain('[order identifier masked]');
    expect(a.redactedSummary.length).toBeLessThanOrEqual(240);
  });
});
