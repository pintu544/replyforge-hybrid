import { useState } from 'react';
import type { Ticket } from '../lib/types';
import type { TriageOutcome } from '../services/triage';
import { RouteChip } from './TicketList';

export type TriageUiState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; outcome: Extract<TriageOutcome, { status: 'success' }> }
  | { kind: 'failed'; outcome: Extract<TriageOutcome, { status: 'failed' }> };

export function TicketWorkspace({
  ticket,
  triageState,
  onRunTriage,
}: {
  ticket: Ticket | null;
  triageState: TriageUiState;
  onRunTriage: (ticket: Ticket) => void;
}) {
  if (!ticket) {
    return (
      <section className="panel workspace-panel" aria-label="Ticket workspace">
        <p className="empty-note">Choose a ticket from the inbox to read it and run triage.</p>
      </section>
    );
  }

  const triage = ticket.triage;

  return (
    <section className="panel workspace-panel" aria-label="Ticket workspace">
      <div className="workspace-head">
        <h2>{ticket.subject}</h2>
        <span className={`source-badge source-badge--${ticket.source}`}>
          {ticket.source === 'fixture' ? 'Fixture ticket' : 'Manual ticket'}
        </span>
      </div>
      <p className="workspace-meta">
        {ticket.id} · received{' '}
        {new Date(ticket.receivedAt).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}{' '}
        · language {ticket.language} · status {ticket.status}
      </p>
      <div className="ticket-body">{ticket.body}</div>

      {ticket.fixture && (
        <details className="gold-labels">
          <summary>Evaluation labels (hidden from the normal workflow)</summary>
          <dl>
            <div><dt>Expected category</dt><dd>{ticket.fixture.category}</dd></div>
            <div><dt>Expected urgency</dt><dd>{ticket.fixture.urgency}</dd></div>
            <div><dt>Expected sentiment</dt><dd>{ticket.fixture.sentiment}</dd></div>
            <div><dt>Expected route</dt><dd>{ticket.fixture.expectedRoute}</dd></div>
            <div><dt>Escalation trigger</dt><dd>{ticket.fixture.escalationTrigger ?? 'none'}</dd></div>
            <div>
              <dt>Labelled personal data</dt>
              <dd>
                {ticket.fixture.personalData.length === 0
                  ? 'none'
                  : ticket.fixture.personalData.map((p) => `${p.type} × ${p.count}`).join(', ')}
              </dd>
            </div>
          </dl>
        </details>
      )}

      <div className="triage-block">
        <div className="triage-head">
          <h3>Triage</h3>
          <button
            type="button"
            className="button button--primary"
            disabled={triageState.kind === 'running'}
            onClick={() => onRunTriage(ticket)}
          >
            {triageState.kind === 'running'
              ? 'Running triage…'
              : triage
                ? 'Run triage again'
                : 'Run triage'}
          </button>
        </div>
        <p className="triage-note">
          Device-preferred: short classification work tries Gemini Nano first and falls back to
          the cloud inside Firebase AI Logic. The route shown is the one the result reports.
        </p>

        {triageState.kind === 'failed' && (
          <div className="triage-result triage-result--failed" role="alert">
            <p className="triage-failed-title">Triage failed</p>
            <p>{triageState.outcome.error}</p>
            <p className="num">Attempt took {triageState.outcome.latencyMs} ms and was recorded.</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onRunTriage(ticket)}
            >
              Retry triage
            </button>
          </div>
        )}

        {triageState.kind !== 'failed' && triage && (
          <div className="triage-result" aria-label="Triage result">
            <div className="triage-route-row">
              <RouteChip source={triage.actualSource} latencyMs={triage.latencyMs} />
              <span className="triage-requested">Requested: prefer on-device</span>
            </div>
            <dl className="triage-grid">
              <div><dt>Category</dt><dd>{triage.category}</dd></div>
              <div><dt>Urgency</dt><dd>{triage.urgency}</dd></div>
              <div><dt>Sentiment</dt><dd>{triage.sentiment}</dd></div>
              <div><dt>Confidence</dt><dd className="num">{Math.round(triage.confidence * 100)}%</dd></div>
              <div><dt>Issues</dt><dd className="num">{triage.issueCount}</dd></div>
              <div><dt>Personal data items</dt><dd className="num">{triage.personalDataCount}</dd></div>
            </dl>
          </div>
        )}

        {triageState.kind !== 'failed' && !triage && triageState.kind !== 'running' && (
          <p className="empty-note">No triage result yet for this ticket.</p>
        )}
      </div>
    </section>
  );
}

export function ManualTicketForm({ onAdd }: { onAdd: (subject: string, body: string) => Promise<void> }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel manual-panel" aria-label="Add a ticket by pasting">
      <h2>Add a ticket</h2>
      <p className="auth-note">Paste a customer message. It is saved as a manual ticket, separate from the fixture set.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          onAdd(subject.trim(), body.trim())
            .then(() => {
              setSubject('');
              setBody('');
            })
            .catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'The ticket could not be saved.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Subject
          <input
            type="text"
            required
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label>
          Message
          <textarea
            required
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button--secondary" disabled={busy}>
          Add ticket
        </button>
      </form>
    </section>
  );
}
