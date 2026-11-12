import { describe, expect, it } from 'vitest';
import type { FixtureFile, Ticket, TriageResult } from '../lib/types';
import { fixtureRecordToTicket } from './fixtureLoader';
import { buildEscalationPayload, prepareEscalation, type EscalationMeta } from './payload';
import { produceRedactedArtefact } from './redaction';
import fixtureFileJson from '../../fixtures/tickets.json';

const fixtureFile = fixtureFileJson as FixtureFile;

function fixtureTicket(id: string): Ticket {
  const record = fixtureFile.tickets.find((t) => t.id === id);
  if (!record) throw new Error(`${id} missing from fixture`);
  return fixtureRecordToTicket(record, fixtureFile.fixtureVersion, fixtureFile.referenceTime, 'user-test-1');
}

const META: EscalationMeta = {
  category: 'delivery',
  urgency: 'normal',
  sentiment: 'neutral',
  escalationTrigger: null,
  issueCount: 1,
  triagePersonalDataCount: null,
};

describe('cloud-payload safety gate (T-2.3)', () => {
  it('accepts only a redacted artefact — a raw ticket is refused at runtime', () => {
    const ticket = fixtureTicket('RF-005');
    expect(() =>
      buildEscalationPayload(ticket as unknown as Parameters<typeof buildEscalationPayload>[0], META),
    ).toThrow(/redacted artefact/);
    expect(() =>
      buildEscalationPayload(
        { redactedSummary: 'x', redactedBody: 'y' } as unknown as Parameters<
          typeof buildEscalationPayload
        >[0],
        META,
      ),
    ).toThrow(/redacted artefact/);
  });

  it('builds the payload from the artefact and metadata only — no raw-body field exists', () => {
    const ticket = fixtureTicket('RF-005');
    const artefact = produceRedactedArtefact(ticket);
    const { payload, gate } = buildEscalationPayload(artefact, { ...META, triagePersonalDataCount: 3 });
    expect(Object.keys(payload).sort()).toEqual([
      'bodyCharacterCount',
      'category',
      'escalationTrigger',
      'issueCount',
      'redactedSummary',
      'redactionCount',
      'sentiment',
      'urgency',
    ]);
    expect(payload.redactedSummary).toBe(artefact.redactedSummary);
    expect(payload.bodyCharacterCount).toBe(artefact.redactedBody.length);
    expect(payload.redactionCount).toBe(3);
    expect(gate.status).toBe('minimised');
    expect(JSON.stringify(payload)).not.toContain('ORD-78451');
    expect(JSON.stringify(payload)).not.toContain('Priya Nair');
  });

  it('BLOCKS a payload in which a labelled pattern survived redaction (negative test)', () => {
    const ticket = fixtureTicket('RF-021');
    const artefact = produceRedactedArtefact(ticket);
    // Tamper: reintroduce a labelled value into the summary, as a redaction
    // miss would. The gate — not the caller — must catch it.
    const tampered = {
      ...artefact,
      redactedSummary: `${artefact.redactedSummary} Reach me at meera.pillai@examplemail.com`,
    };
    const { gate } = buildEscalationPayload(tampered, { ...META, triagePersonalDataCount: 5 });
    expect(gate.status).toBe('blocked');
    expect(gate.survivingTypes).toContain('email');
    expect(gate.note).toMatch(/Blocked/);
  });

  it('holds for review when triage counted more personal data than redaction caught', () => {
    const ticket = fixtureTicket('RF-003'); // one labelled e-mail
    const artefact = produceRedactedArtefact(ticket);
    expect(artefact.redactionCount).toBe(1);
    const { gate } = buildEscalationPayload(artefact, { ...META, triagePersonalDataCount: 4 });
    expect(gate.status).toBe('held-for-review');
    expect(gate.note).toMatch(/Held for review/);
  });

  it('reports minimised when nothing survived and the counts agree', () => {
    const ticket = fixtureTicket('RF-001'); // no personal data at all
    const artefact = produceRedactedArtefact(ticket);
    const { gate } = buildEscalationPayload(artefact, { ...META, triagePersonalDataCount: 0 });
    expect(gate.status).toBe('minimised');
    expect(gate.survivingTypes).toEqual([]);
  });
});

describe('"What the cloud sees" preview (T-2.4)', () => {
  const triage: TriageResult = {
    category: 'delivery',
    urgency: 'high',
    sentiment: 'negative',
    confidence: 0.88,
    issueCount: 3,
    personalDataCount: 5,
    actualSource: 'in_cloud',
    latencyMs: 4200,
    completedAt: '2026-11-12T05:00:00.000Z',
  };

  it('shows the complete proposed payload for a triaged ticket', () => {
    const ticket = fixtureTicket('RF-021');
    const preview = prepareEscalation(ticket, triage);
    expect(preview.payload.redactedSummary).toContain('[order identifier masked]');
    expect(preview.payload.category).toBe('delivery');
    expect(preview.payload.urgency).toBe('high');
    expect(preview.payload.sentiment).toBe('negative');
    expect(preview.payload.escalationTrigger).toBeNull();
    expect(preview.payload.issueCount).toBe(3);
    expect(preview.payload.bodyCharacterCount).toBeGreaterThan(0);
    expect(preview.payload.redactionCount).toBe(5);
    expect(preview.gate.status).toBe('minimised');
  });

  it('the previewed payload is identical to the payload the escalation path builds', () => {
    const ticket = fixtureTicket('RF-021');
    const preview = prepareEscalation(ticket, triage);
    // The escalation path (Slice 3) calls the same builder with the same
    // artefact and metadata. The objects must be indistinguishable.
    const escalationSide = buildEscalationPayload(preview.artefact, {
      category: triage.category,
      urgency: triage.urgency,
      sentiment: triage.sentiment,
      escalationTrigger: null,
      issueCount: triage.issueCount,
      triagePersonalDataCount: triage.personalDataCount,
    });
    expect(preview.payload).toEqual(escalationSide.payload);
    expect(JSON.stringify(preview.payload)).toBe(JSON.stringify(escalationSide.payload));
    expect(preview.gate).toEqual(escalationSide.gate);
  });
});
