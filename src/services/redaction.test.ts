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

describe('separator coverage widened in T-2.8 QA', () => {
  it('detects phone numbers with slash, parenthesis, and mid-group split separators', () => {
    const variants = [
      'Reach me on 98200/11223 please',
      'Reach me on (98200) 11223 please',
      'Reach me on 98200 11\n223 please',
      'Reach me on 982 0011223 please',
      'Reach me on (+91) 98200 11223 please',
    ];
    for (const text of variants) {
      const found = detectPersonalData(text).filter((d) => d.type === 'phone');
      expect(found, text).toHaveLength(1);
      // All are the same subscriber number: one distinct item.
      expect(found[0].value.replace(/\D/g, '').slice(-10)).toBe('9820011223');
    }
  });

  it('detects order identifiers with dot and slash separators', () => {
    for (const text of ['About order ORD.78451 please', 'About order ORD/78451 please']) {
      const found = detectPersonalData(text).filter((d) => d.type === 'order-id');
      expect(found, text).toHaveLength(1);
    }
  });

  it('detects a name with a middle initial inside the labelled anchors', () => {
    const intro = detectPersonalData('My name is Priya S. Nair and I am waiting').filter(
      (d) => d.type === 'name',
    );
    expect(intro).toHaveLength(1);
    expect(intro[0].value).toBe('Priya S. Nair');
    const callMe = detectPersonalData('You can call me, Priya S. Nair, for updates').filter(
      (d) => d.type === 'name',
    );
    expect(callMe).toHaveLength(1);
    expect(callMe[0].value).toBe('Priya S. Nair');
  });

  it('the widened formats no longer survive into a redacted artefact', () => {
    const artefact = produceRedactedArtefact({
      id: 'manual-slash',
      subject: 'Refund help',
      body: 'My refund has not arrived after ten days. Also reach me on 98200/11223 for updates about ORD/78451.',
    });
    expect(artefact.redactionCount).toBe(2);
    expect(artefact.redactedBody).not.toContain('98200/11223');
    expect(artefact.redactedBody).not.toContain('ORD/78451');
    expect(artefact.redactedBody).toContain('[telephone masked]');
    expect(artefact.redactedBody).toContain('[order identifier masked]');
  });

  it('does not invent phone numbers from longer digit runs or PINs', () => {
    // 12-digit UPI-style reference and 13-digit run: outside the labelled
    // phone forms; a city + PIN alone is not a postal address.
    expect(
      detectPersonalData('UPI reference 123456789012 for the refund').filter(
        (d) => d.type === 'phone',
      ),
    ).toHaveLength(0);
    expect(
      detectPersonalData('Reference 1234567890123 quoted').filter((d) => d.type === 'phone'),
    ).toHaveLength(0);
    expect(detectPersonalData('The parcel reached Pune 411001 yesterday')).toHaveLength(0);
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
