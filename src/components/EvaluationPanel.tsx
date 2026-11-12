import type { EvaluationRun } from '../lib/types';

/**
 * Evaluation panel (SPEC FR-14, TASKS T-3.4): one action runs the real
 * pipeline over all 30 fixture tickets; the panel shows the latest run,
 * the previous run, and the deltas between them.
 */
export function EvaluationPanel({
  runs,
  progress,
  onRun,
}: {
  runs: EvaluationRun[];
  progress: { done: number; total: number } | null;
  onRun: () => void;
}) {
  const latest = runs[0] ?? null;
  const previous = runs[1] ?? null;
  const mismatches = latest ? latest.results.filter((r) => !r.correct) : [];
  const accuracyDelta =
    latest && previous ? Math.round((latest.accuracy - previous.accuracy) * 1000) / 10 : null;

  return (
    <section className="panel evaluation-panel" aria-label="Evaluation">
      <div className="status-head">
        <h2>Evaluation — the 30-ticket set</h2>
      </div>
      <p className="status-explanation">
        One run drives the real pipeline — triage, redaction, the routing engine, the payload
        gate — over every fixture ticket and records what actually happened. The routes in a run
        are the routes that ran in this browser: on a machine without Gemini Nano every triage
        runs in the cloud, and the run reports exactly that. Accuracy is the routing
        engine&rsquo;s agreement with the fixture labels, given the triage the model produced.
      </p>
      <button
        type="button"
        className="button button--primary"
        disabled={progress !== null}
        onClick={onRun}
      >
        {progress
          ? `Evaluating… ${progress.done} of ${progress.total}`
          : 'Run evaluation over all 30 tickets'}
      </button>

      {latest && (
        <div className="run-summary">
          <h3>Latest run</h3>
          <dl className="triage-grid">
            <div>
              <dt>Correct routes</dt>
              <dd className="num">
                {latest.correctRoutes} of {latest.ticketCount}
              </dd>
            </div>
            <div>
              <dt>Routing accuracy</dt>
              <dd className="num">{Math.round(latest.accuracy * 1000) / 10}%</dd>
            </div>
            <div>
              <dt>Labelled redactions</dt>
              <dd className="num">{latest.labelledRedactions}</dd>
            </div>
            <div>
              <dt>Surviving labelled patterns</dt>
              <dd className="num">{latest.survivingLabelledPatterns}</dd>
            </div>
            <div>
              <dt>Triage routes in this run (actual)</dt>
              <dd className="num">
                on-device {latest.onDeviceCount} · in cloud {latest.inCloudCount} · failed{' '}
                {latest.failedCount}
              </dd>
            </div>
            <div>
              <dt>Fixture version</dt>
              <dd className="num">{latest.fixtureVersion}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>
                {new Date(latest.createdAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </dd>
            </div>
            <div>
              <dt>Chrome version</dt>
              <dd className="num">{latest.chromeVersion ?? 'not recorded'}</dd>
            </div>
          </dl>
          {mismatches.length > 0 ? (
            <>
              <p className="triage-note">Where the engine and the labels disagreed:</p>
              <ul className="mismatch-list">
                {mismatches.map((r) => (
                  <li key={r.ticketId}>
                    {r.ticketId} — label says {r.expectedRoute === 'cloud' ? 'escalate' : 'simple'},{' '}
                    {r.selectedRoute === null
                      ? 'but triage failed, so no route was selected'
                      : `engine chose ${r.selectedRoute === 'escalate' ? 'escalate' : 'simple'}${
                          r.trigger ? ` (${r.trigger})` : ''
                        }`}
                    .
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="triage-note">The engine agreed with every label in this run.</p>
          )}
          {previous && (
            <p className="triage-note">
              Previous run:{' '}
              <span className="num">
                {previous.correctRoutes} of {previous.ticketCount}
              </span>{' '}
              correct ({Math.round(previous.accuracy * 1000) / 10}%)
              {accuracyDelta !== null && (
                <>
                  {' '}
                  — accuracy {accuracyDelta > 0 ? 'up' : accuracyDelta < 0 ? 'down' : 'unchanged'}{' '}
                  {accuracyDelta !== 0 && (
                    <span className="num">{Math.abs(accuracyDelta)} points</span>
                  )}{' '}
                  since then.
                </>
              )}
            </p>
          )}
        </div>
      )}
      {!latest && !progress && (
        <p className="empty-note">No evaluation run yet in this account.</p>
      )}
    </section>
  );
}
