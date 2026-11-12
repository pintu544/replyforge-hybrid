import type { FixtureFile, FixtureTicketRecord, Ticket } from '../lib/types';
import type { TicketRepository } from './repository';

/**
 * Fixture loading with the contract in fixtures/README.md:
 * exactly 30 fixture tickets, stable IDs, and a reload that creates zero
 * duplicates, preserves gold labels, and changes zero manual tickets.
 */

export function fixtureRecordToTicket(
  record: FixtureTicketRecord,
  fixtureVersion: number,
  referenceTimeIso: string,
  ownerUid: string,
): Ticket {
  const referenceMs = Date.parse(referenceTimeIso);
  const receivedAt = new Date(referenceMs + record.receivedOffsetMinutes * 60_000).toISOString();
  return {
    id: record.id,
    ownerUid,
    source: 'fixture',
    subject: record.subject,
    body: record.body,
    receivedAt,
    status: 'inbox',
    language: record.language,
    triage: null,
    fixture: {
      fixtureVersion,
      category: record.category,
      urgency: record.urgency,
      sentiment: record.sentiment,
      issueCount: record.issueCount,
      language: record.language,
      expectedRoute: record.expectedRoute,
      escalationTrigger: record.escalationTrigger,
      personalData: record.personalData,
    },
  };
}

/** Pure planning step: which fixture tickets still need to be created. */
export function planFixtureLoad(
  existing: Ticket[],
  file: FixtureFile,
  ownerUid: string,
): Ticket[] {
  const existingIds = new Set(existing.map((t) => t.id));
  return file.tickets
    .filter((record) => !existingIds.has(record.id))
    .map((record) => fixtureRecordToTicket(record, file.fixtureVersion, file.referenceTime, ownerUid));
}

export interface FixtureLoadResult {
  created: number;
  skippedExisting: number;
  totalFixtureTickets: number;
}

export async function loadFixture(
  repo: TicketRepository,
  ownerUid: string,
  file: FixtureFile,
): Promise<FixtureLoadResult> {
  const existing = await repo.listTickets(ownerUid);
  const toCreate = planFixtureLoad(existing, file, ownerUid);
  for (const ticket of toCreate) {
    await repo.saveTicket(ticket);
  }
  const fixtureTotal = existing.filter((t) => t.source === 'fixture').length + toCreate.length;
  return {
    created: toCreate.length,
    skippedExisting: file.tickets.length - toCreate.length,
    totalFixtureTickets: fixtureTotal,
  };
}
