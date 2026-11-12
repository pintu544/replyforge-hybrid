import { describe, expect, it } from 'vitest';
import fixtureFileJson from '../../fixtures/tickets.json';
import type { FixtureFile } from '../lib/types';
import { loadFixture, planFixtureLoad } from './fixtureLoader';
import { MemoryTicketRepository } from './repository';

const file = fixtureFileJson as FixtureFile;
const UID = 'user-test-1';

describe('fixture contract (T-1.3)', () => {
  it('has exactly 30 records with stable IDs RF-001 to RF-030', () => {
    expect(file.tickets).toHaveLength(30);
    expect(file.tickets.map((t) => t.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => `RF-${String(i + 1).padStart(3, '0')}`),
    );
    expect(file.referenceTime).toBe('2026-11-12T10:00:00+05:30');
    expect(file.fixtureVersion).toBe(1);
  });

  it('splits 18 device-labelled and 12 cloud-labelled tickets', () => {
    expect(file.tickets.filter((t) => t.expectedRoute === 'device')).toHaveLength(18);
    expect(file.tickets.filter((t) => t.expectedRoute === 'cloud')).toHaveLength(12);
  });

  it('has at least eight tickets with synthetic personal data', () => {
    expect(file.tickets.filter((t) => t.personalData.length > 0).length).toBeGreaterThanOrEqual(8);
  });

  it('covers angry, refund/legal, long multi-issue, ambiguous, and unsupported-language cases', () => {
    const triggers = new Set(file.tickets.map((t) => t.escalationTrigger));
    expect(triggers.has('negative-sentiment')).toBe(true);
    expect(triggers.has('refund-legal-intent')).toBe(true);
    expect(triggers.has('multiple-issues')).toBe(true);
    expect(triggers.has('low-confidence')).toBe(true);
    expect(triggers.has('unsupported-language')).toBe(true);
    expect(triggers.has('length-complexity')).toBe(true);
    expect(file.tickets.some((t) => t.sentiment === 'angry')).toBe(true);
    expect(file.tickets.some((t) => t.language === 'hi')).toBe(true);
    expect(file.tickets.every((t) => t.expectedRoute === 'cloud' || t.escalationTrigger === null)).toBe(true);
  });
});

describe('fixture loader (T-1.4)', () => {
  it('creates exactly 30 tickets, then zero duplicates on reload, and never touches manual tickets', async () => {
    const repo = new MemoryTicketRepository();
    await repo.saveTicket({
      id: 'manual-1',
      ownerUid: UID,
      source: 'manual',
      subject: 'My own pasted ticket',
      body: 'Written by the operator.',
      receivedAt: '2026-11-12T09:00:00.000Z',
      status: 'inbox',
      language: 'en',
      triage: null,
      fixture: null,
      redactedSummary: null,
      redactionCount: 0,
      privacyMode: false,
    });

    const first = await loadFixture(repo, UID, file);
    expect(first.created).toBe(30);
    expect(first.totalFixtureTickets).toBe(30);

    const second = await loadFixture(repo, UID, file);
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(30);

    const tickets = await repo.listTickets(UID);
    expect(tickets).toHaveLength(31);
    expect(tickets.filter((t) => t.source === 'fixture')).toHaveLength(30);

    const manual = tickets.find((t) => t.id === 'manual-1');
    expect(manual?.subject).toBe('My own pasted ticket');
    expect(manual?.triage).toBeNull();

    // Gold labels are present on created fixture tickets and survive a reload.
    const rf021 = tickets.find((t) => t.id === 'RF-021');
    expect(rf021?.fixture?.expectedRoute).toBe('cloud');
    expect(rf021?.fixture?.personalData.length).toBeGreaterThan(0);
  });

  it('plans no creations when every fixture ticket already exists', () => {
    const planned = planFixtureLoad([], file, UID);
    expect(planned).toHaveLength(30);
    const replanned = planFixtureLoad(planned, file, UID);
    expect(replanned).toHaveLength(0);
  });

  it('derives receivedAt from the fixed reference time plus the offset', () => {
    const planned = planFixtureLoad([], file, UID);
    const rf001 = planned.find((t) => t.id === 'RF-001');
    // RF-001 offset is -35 minutes from 2026-11-12T10:00:00+05:30.
    expect(rf001?.receivedAt).toBe('2026-11-12T03:55:00.000Z');
  });
});
