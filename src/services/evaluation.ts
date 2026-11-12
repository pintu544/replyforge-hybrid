import { currentBrowserInfo } from '../lib/browserInfo';
import type {
  EvaluationRun,
  EvaluationTicketResult,
  Ticket,
} from '../lib/types';
import type { RoutingConfig } from './appConfig';
import type { InferenceAdapter } from './inference';
import { buildEscalationPayload } from './payload';
import { detectPersonalData, produceRedactedArtefact } from './redaction';
import { decideRoute } from './routing';
import { newEventId, type RouteEventWriter } from './routeEvents';
import { runTriage } from './triage';

/**
 * The repeatable 30-ticket evaluation runner (SPEC FR-14, TASKS T-3.4).
 *
 * One action runs the real pipeline over every fixture ticket: triage
 * through the device-preferred handle (which writes its own route event
 * with the ACTUAL route from inferenceSource), deterministic redaction,
 * the routing engine, and the payload gate. It changes no labels and
 * persists no ticket state — the only writes are the triage route events
 * and the EvaluationRun itself.
 *
 * Honesty rules: the run records the routes that actually ran on this
 * machine (on this VM that is in_cloud for every ticket — the runner
 * never synthesises an on-device outcome), and routing accuracy is the
 * engine's agreement with the gold route labels given the triage the
 * model actually produced.
 */

export interface EvaluationDeps {
  adapter: InferenceAdapter;
  writer: RouteEventWriter;
  isOnline: () => boolean;
  config: RoutingConfig;
  /** Triage prompt template (Remote Config); defaults inside runTriage. */
  promptTemplate?: string;
  /** Human description of the machine/browser the run measured on. */
  deviceDescription: string;
  fixtureVersion: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runEvaluation(
  deps: EvaluationDeps,
  tickets: Ticket[],
): Promise<EvaluationRun> {
  const fixtureTickets = tickets.filter((t) => t.fixture !== null);
  const results: EvaluationTicketResult[] = [];
  let correctRoutes = 0;
  let labelledRedactions = 0;
  let survivingLabelledPatterns = 0;
  let onDeviceCount = 0;
  let inCloudCount = 0;
  let failedCount = 0;

  for (const [index, ticket] of fixtureTickets.entries()) {
    const gold = ticket.fixture;
    if (!gold) continue;
    const labelledCount = gold.personalData.reduce((n, p) => n + p.count, 0);
    labelledRedactions += labelledCount;

    const outcome = await runTriage(
      {
        adapter: deps.adapter,
        writer: deps.writer,
        isOnline: deps.isOnline,
        promptTemplate: deps.promptTemplate,
      },
      ticket,
    );

    if (outcome.status === 'failed') {
      failedCount += 1;
      results.push({
        ticketId: ticket.id,
        expectedRoute: gold.expectedRoute,
        selectedRoute: null,
        trigger: null,
        correct: false,
        triageActualSource: null,
        redactionCount: 0,
        labelledCount,
        survivingPatterns: 0,
      });
    } else {
      const triage = outcome.triage;
      if (triage.actualSource === 'on_device') onDeviceCount += 1;
      else inCloudCount += 1;

      const artefact = produceRedactedArtefact(ticket);
      const decision = decideRoute(
        {
          sentiment: triage.sentiment,
          confidence: triage.confidence,
          issueCount: triage.issueCount,
          language: ticket.language,
          redactedText: `${artefact.redactedSubject}\n${artefact.redactedBody}`,
          redactedBodyChars: artefact.redactedBody.length,
        },
        deps.config,
      );
      // The payload is built for every ticket, not only escalations, so
      // the gate check covers the whole set (SPEC NFR-4).
      const { payload, gate } = buildEscalationPayload(artefact, {
        category: triage.category,
        urgency: triage.urgency,
        sentiment: triage.sentiment,
        escalationTrigger: decision.trigger,
        issueCount: triage.issueCount,
        triagePersonalDataCount: triage.personalDataCount,
      });
      const surviving =
        gate.status === 'blocked' ? detectPersonalData(payload.redactedSummary).length : 0;
      survivingLabelledPatterns += surviving;

      const selectedRoute = decision.route;
      const correct = (selectedRoute === 'escalate') === (gold.expectedRoute === 'cloud');
      if (correct) correctRoutes += 1;
      results.push({
        ticketId: ticket.id,
        expectedRoute: gold.expectedRoute,
        selectedRoute,
        trigger: decision.trigger,
        correct,
        triageActualSource: triage.actualSource,
        redactionCount: artefact.redactionCount,
        labelledCount,
        survivingPatterns: surviving,
      });
    }
    deps.onProgress?.(index + 1, fixtureTickets.length);
  }

  const ticketCount = fixtureTickets.length;
  return {
    id: newEventId(),
    fixtureVersion: deps.fixtureVersion,
    ticketCount,
    correctRoutes,
    accuracy: ticketCount > 0 ? correctRoutes / ticketCount : 0,
    labelledRedactions,
    survivingLabelledPatterns,
    onDeviceCount,
    inCloudCount,
    failedCount,
    deviceDescription: deps.deviceDescription,
    chromeVersion: currentBrowserInfo().chromeVersion,
    createdAt: new Date().toISOString(),
    results,
  };
}
