import { describe, expect, it } from 'vitest';
import fixtureFileJson from '../../fixtures/tickets.json';
import type {
  FixtureFile,
  FixtureTicketRecord,
  Ticket,
} from '../lib/types';
import { DEFAULT_ROUTING_CONFIG } from './appConfig';
import { runEvaluation } from './evaluation';
import type { InferenceAdapter, StructuredResult, TextResult } from './inference';
import { MemoryTicketRepository } from './repository';
import { writerForRepository } from './routeEvents';

const fixtureFile = fixtureFileJson as FixtureFile;
const UID = 'user-test-1';

function ticketFrom(rec: FixtureTicketRecord): Ticket {
  return {
    id: rec.id,
    ownerUid: UID,
    source: 'fixture',
    subject: rec.subject,
    body: rec.body,
    receivedAt: '2026-11-12T04:30:00.000Z',
    status: 'inbox',
    language: rec.language,
    triage: null,
    fixture: {
      fixtureVersion: 1,
      category: rec.category,
      urgency: rec.urgency,
      sentiment: rec.sentiment,
      issueCount: rec.issueCount,
      language: rec.language,
      expectedRoute: rec.expectedRoute,
      escalationTrigger: rec.escalationTrigger,
      personalData: rec.personalData,
    },
    redactedSummary: null,
    redactionCount: 0,
    privacyMode: false,
  };
}

/**
 * An adapter that answers triage in call order with the fixture's own
 * gold fields — the deterministic stand-in for a perfect triage model, so
 * the runner's aggregation is tested independently of model variance.
 * Gold carries no confidence: low-confidence-labelled tickets get 0.4,
 * the rest 0.95.
 */
class GoldAdapter implements InferenceAdapter {
  private index = 0;
  private readonly failAt: number | null;

  constructor(failAt: number | null = null) {
    this.failAt = failAt;
  }

  async generateStructured(): Promise<StructuredResult> {
    const rec = fixtureFile.tickets[this.index];
    this.index += 1;
    if (this.failAt !== null && this.index - 1 === this.failAt) {
      throw new Error('Simulated triage failure.');
    }
    return {
      text: JSON.stringify({
        category: rec.category,
        urgency: rec.urgency,
        sentiment: rec.sentiment,
        confidence: rec.escalationTrigger === 'low-confidence' ? 0.4 : 0.95,
        issueCount: rec.issueCount,
        personalDataCount: rec.personalData.reduce((n, p) => n + p.count, 0),
      }),
      inferenceSource: 'in_cloud',
    };
  }

  async generateText(): Promise<TextResult> {
    throw new Error('The evaluation runner never drafts.');
  }

  async initialiseDeviceModel(): Promise<void> {}
}

async function runWith(adapter: InferenceAdapter) {
  const repo = new MemoryTicketRepository();
  const tickets = fixtureFile.tickets.map(ticketFrom);
  const progress: number[] = [];
  const run = await runEvaluation(
    {
      adapter,
      writer: writerForRepository(repo, UID),
      isOnline: () => true,
      config: DEFAULT_ROUTING_CONFIG,
      deviceDescription: 'Test machine',
      fixtureVersion: fixtureFile.fixtureVersion,
      onProgress: (done) => progress.push(done),
    },
    tickets,
  );
  return { run, repo, progress };
}

describe('evaluation runner (T-3.4)', () => {
  it('evaluates all 30 tickets and aggregates routes, redactions and accuracy', async () => {
    const { run, repo, progress } = await runWith(new GoldAdapter());
    const labelledTotal = fixtureFile.tickets.reduce(
      (n, t) => n + t.personalData.reduce((m, p) => m + p.count, 0),
      0,
    );
    expect(run.ticketCount).toBe(30);
    expect(run.correctRoutes).toBe(30);
    expect(run.accuracy).toBe(1);
    expect(run.labelledRedactions).toBe(labelledTotal);
    expect(run.survivingLabelledPatterns).toBe(0);
    // The adapter reported in_cloud for every triage: the run records the
    // actual split as measured, never the labels' device/cloud split.
    expect(run.inCloudCount).toBe(30);
    expect(run.onDeviceCount).toBe(0);
    expect(run.failedCount).toBe(0);
    expect(run.results).toHaveLength(30);
    expect(progress).toHaveLength(30);
    // Engine priority spot checks inside the run.
    expect(run.results.find((r) => r.ticketId === 'RF-021')?.trigger).toBe('length-complexity');
    expect(run.results.find((r) => r.ticketId === 'RF-022')?.trigger).toBe('low-confidence');
    expect(run.results.find((r) => r.ticketId === 'RF-023')?.trigger).toBe('unsupported-language');
    expect(run.results.find((r) => r.ticketId === 'RF-001')?.selectedRoute).toBe('simple');
    // One triage route event per ticket, all with actual routes.
    const events = await repo.listRouteEvents(UID);
    expect(events).toHaveLength(30);
    expect(events.every((e) => e.taskType === 'triage' && e.actualSource === 'in_cloud')).toBe(true);
  });

  it('is repeatable: a second run over the same fixture version agrees', async () => {
    const first = await runWith(new GoldAdapter());
    const second = await runWith(new GoldAdapter());
    expect(second.run.correctRoutes).toBe(first.run.correctRoutes);
    expect(second.run.accuracy).toBe(first.run.accuracy);
    expect(second.run.labelledRedactions).toBe(first.run.labelledRedactions);
    expect(second.run.id).not.toBe(first.run.id);
  });

  it('a failed triage counts against the run and is reported, not hidden', async () => {
    const { run } = await runWith(new GoldAdapter(2));
    expect(run.failedCount).toBe(1);
    expect(run.correctRoutes).toBe(29);
    const failed = run.results[2];
    expect(failed.selectedRoute).toBeNull();
    expect(failed.correct).toBe(false);
    expect(failed.triageActualSource).toBeNull();
  });

  it('retries a quota failure once after the suggested delay instead of scoring it as a routing failure', async () => {
    // The live free tier caps requests per minute; a burst evaluation
    // measured 12 of 30 triages quota-failed (13 Nov 2026). The first
    // call for ticket index 5 fails with a quota error, then succeeds.
    const inner = new GoldAdapter();
    let calls = 0;
    const flaky: InferenceAdapter = {
      async generateStructured() {
        calls += 1;
        if (calls === 6) {
          throw new Error(
            'Quota exceeded for metric: generate requests per minute. Please retry in 1s',
          );
        }
        return inner.generateStructured();
      },
      async generateText() {
        throw new Error('unused');
      },
      async initialiseDeviceModel() {},
    };
    const sleeps: number[] = [];
    const repo = new MemoryTicketRepository();
    const run = await runEvaluation(
      {
        adapter: flaky,
        writer: writerForRepository(repo, UID),
        isOnline: () => true,
        config: DEFAULT_ROUTING_CONFIG,
        deviceDescription: 'Test machine',
        fixtureVersion: fixtureFile.fixtureVersion,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      fixtureFile.tickets.map(ticketFrom),
    );
    expect(run.failedCount).toBe(0);
    expect(run.correctRoutes).toBe(30);
    // The retry waited the API's suggested delay (1s + buffer, clamped).
    expect(sleeps).toEqual([1500]);
    // Both attempts keep their route events: 30 successes + 1 failure.
    const events = await repo.listRouteEvents(UID);
    expect(events).toHaveLength(31);
    expect(events.filter((e) => e.outcome === 'failed')).toHaveLength(1);
  });

  it('paces triage calls when paceMs is set', async () => {
    const sleeps: number[] = [];
    const repo = new MemoryTicketRepository();
    await runEvaluation(
      {
        adapter: new GoldAdapter(),
        writer: writerForRepository(repo, UID),
        isOnline: () => true,
        config: DEFAULT_ROUTING_CONFIG,
        deviceDescription: 'Test machine',
        fixtureVersion: fixtureFile.fixtureVersion,
        paceMs: 10,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
      fixtureFile.tickets.map(ticketFrom),
    );
    expect(sleeps).toHaveLength(29);
    expect(sleeps.every((ms) => ms === 10)).toBe(true);
  });

  it('records no ticket text anywhere in the run record', async () => {
    const { run } = await runWith(new GoldAdapter());
    const serialised = JSON.stringify(run);
    for (const needle of ['Priya Nair', 'ORD-78451', 'Rosewood', 'chargeback with my bank']) {
      expect(serialised).not.toContain(needle);
    }
  });

  it('still measures redaction for a ticket whose triage failed (T-3.7 QA, W-3)', async () => {
    // Redaction is local and deterministic — it does not depend on the
    // failed triage. Before the fix the failed branch recorded zeroes,
    // so a run's redaction figures silently covered fewer tickets than
    // the panel claims.
    const { run } = await runWith(new GoldAdapter(2));
    const failed = run.results[2];
    expect(failed.triageActualSource).toBeNull();
    expect(failed.labelledCount).toBeGreaterThan(0);
    expect(failed.redactionCount).toBe(failed.labelledCount);
    expect(failed.survivingPatterns).toBe(0);
  });

  it('a device-only run discards cloud results instead of counting them (T-3.7 QA, C-1)', async () => {
    // The wiring Privacy Mode uses: the device-only requested mode makes
    // runTriage discard any result that reports a cloud route, so an
    // evaluation under Privacy Mode on a machine without the device
    // model records honest failures — never cloud successes.
    const repo = new MemoryTicketRepository();
    const run = await runEvaluation(
      {
        adapter: new GoldAdapter(),
        writer: writerForRepository(repo, UID),
        isOnline: () => true,
        config: DEFAULT_ROUTING_CONFIG,
        deviceDescription: 'Test machine',
        fixtureVersion: fixtureFile.fixtureVersion,
        requestedMode: 'only_on_device',
      },
      fixtureFile.tickets.map(ticketFrom),
    );
    expect(run.failedCount).toBe(30);
    expect(run.inCloudCount).toBe(0);
    expect(run.onDeviceCount).toBe(0);
    expect(run.correctRoutes).toBe(0);
    expect(run.results.every((r) => r.triageActualSource === null)).toBe(true);
  });
});
