import { useMemo } from 'react';
import type { EvaluationRun, RouteEvent } from '../lib/types';
import { computeScorecard } from '../services/scorecard';

/**
 * Scorecard panel (SPEC FR-13, TASKS T-3.5): every figure is computed
 * from the stored route events and evaluation runs for this account —
 * nothing is typed in. A figure with no data shows its honest empty
 * state with the sample size, never a placeholder number.
 */
export function ScorecardPanel({
  events,
  runs,
}: {
  events: RouteEvent[];
  runs: EvaluationRun[];
}) {
  const card = useMemo(() => computeScorecard(events, runs), [events, runs]);
  const run = card.latestRun;

  return (
    <section className="panel scorecard-panel" aria-label="Measured scorecard">
      <div className="status-head">
        <h2>Scorecard — measured, not claimed</h2>
      </div>
      <p className="status-explanation">
        Computed from this account&rsquo;s {card.totalEvents} stored route events
        {run ? ' and its latest evaluation run' : ''}. Route events contain no ticket text —
        only the task, the requested mode, the actual route, and the timing.
      </p>
      <dl className="triage-grid">
        <div>
          <dt>Fully handled on-device</dt>
          <dd className="num">
            {card.onDeviceSharePct === null
              ? 'No completed tasks yet'
              : `${card.onDeviceSharePct}% of ${card.completedTasks} completed tasks`}
          </dd>
        </div>
        <div>
          <dt>Median latency — on-device</dt>
          <dd className="num">
            {card.medianLatencyOnDeviceMs === null
              ? `No on-device completions yet (n=${card.onDeviceSample})`
              : `${card.medianLatencyOnDeviceMs} ms (n=${card.onDeviceSample})`}
          </dd>
        </div>
        <div>
          <dt>Median latency — in cloud</dt>
          <dd className="num">
            {card.medianLatencyInCloudMs === null
              ? `No cloud completions yet (n=${card.inCloudSample})`
              : `${card.medianLatencyInCloudMs} ms (n=${card.inCloudSample})`}
          </dd>
        </div>
        <div>
          <dt>Offline successes</dt>
          <dd className="num">
            {card.offlineSuccesses} of {card.offlineAttempts} attempts while offline
          </dd>
        </div>
        <div>
          <dt>Cloud calls avoided</dt>
          <dd className="num">
            {card.cloudCallsAvoided} (on-device completions + attempts blocked before any call)
          </dd>
        </div>
        <div>
          <dt>Escalation accuracy (latest evaluation)</dt>
          <dd className="num">
            {run
              ? `${run.correctRoutes} of ${run.ticketCount} (${Math.round(run.accuracy * 1000) / 10}%)`
              : 'Run an evaluation to measure'}
          </dd>
        </div>
        <div>
          <dt>Labelled redactions caught</dt>
          <dd className="num">
            {run
              ? `${run.labelledRedactions} caught, ${run.survivingLabelledPatterns} surviving`
              : 'Run an evaluation to measure'}
          </dd>
        </div>
      </dl>
      <p className="triage-note">
        Measured on: {card.deviceDescription ?? 'this browser, on this machine'} · Chrome{' '}
        {card.chromeVersion ?? 'version not recorded'}. On-device figures are zero until the
        evaluation runs on a machine with Gemini Nano — that is the honest state, not a missing
        feature.
      </p>
    </section>
  );
}
