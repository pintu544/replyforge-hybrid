import { useState } from 'react';
import type { Draft, PayloadGateStatus, RedactedArtefact, Ticket, TriageResult } from '../lib/types';
import type { EscalationPreview } from '../services/payload';
import { triggerLabel, type EscalationResult } from '../services/escalation';
import type { RoutingDecision } from '../services/routing';
import type { TriageOutcome } from '../services/triage';
import { RouteChip } from './TicketList';

export type TriageUiState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'awaiting-sync'; triage: TriageResult }
  | { kind: 'refused'; reason: string; alternative: string }
  | { kind: 'done'; outcome: Extract<TriageOutcome, { status: 'success' }> }
  | { kind: 'failed'; outcome: Extract<TriageOutcome, { status: 'failed' }> };

export type SendUiState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'queued'; note: string }
  | { kind: 'failed'; error: string; nextAction: string };

export type DraftUiState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'awaiting-sync'; text: string }
  | { kind: 'refused'; reason: string; alternative: string }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; send: SendUiState; saveError: string | null };

export const READY_DRAFT_UI: DraftUiState = { kind: 'ready', send: { kind: 'idle' }, saveError: null };

export type EscalationUiState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'awaiting-sync'; result: EscalationResult }
  | { kind: 'refused'; reason: string; alternative: string }
  | { kind: 'blocked'; note: string }
  | { kind: 'needs-confirmation'; note: string }
  | { kind: 'failed'; error: string }
  | { kind: 'done'; result: EscalationResult };

const GATE_LABEL: Record<PayloadGateStatus, string> = {
  blocked: 'Blocked',
  minimised: 'Minimised',
  'held-for-review': 'Held for review',
};

function TriageFields({ triage }: { triage: TriageResult }) {
  return (
    <dl className="triage-grid">
      <div><dt>Category</dt><dd>{triage.category}</dd></div>
      <div><dt>Urgency</dt><dd>{triage.urgency}</dd></div>
      <div><dt>Sentiment</dt><dd>{triage.sentiment}</dd></div>
      <div><dt>Confidence</dt><dd className="num">{Math.round(triage.confidence * 100)}%</dd></div>
      <div><dt>Issues</dt><dd className="num">{triage.issueCount}</dd></div>
      <div><dt>Personal data items</dt><dd className="num">{triage.personalDataCount}</dd></div>
    </dl>
  );
}

export function TicketWorkspace({
  ticket,
  triageState,
  onRunTriage,
  artefact,
  onRedact,
  preview,
  decision,
  escalationUi,
  onEscalate,
  draft,
  draftUi,
  onDraft,
  onManualDraft,
  onDraftTextChange,
  onDraftSave,
  onSend,
  privacyMode,
}: {
  ticket: Ticket | null;
  triageState: TriageUiState;
  onRunTriage: (ticket: Ticket) => void;
  artefact: RedactedArtefact | null;
  onRedact: (ticket: Ticket) => void;
  preview: EscalationPreview | null;
  decision: RoutingDecision | null;
  escalationUi: EscalationUiState;
  onEscalate: (ticket: Ticket, preview: EscalationPreview, confirmedByOperator: boolean) => void;
  draft: Draft | null;
  draftUi: DraftUiState;
  onDraft: (ticket: Ticket) => void;
  onManualDraft: (ticket: Ticket) => void;
  onDraftTextChange: (ticket: Ticket, text: string) => void;
  onDraftSave: (ticket: Ticket) => void;
  onSend: (ticket: Ticket) => void;
  privacyMode: boolean;
}) {
  if (!ticket) {
    return (
      <section className="panel workspace-panel" aria-label="Ticket workspace">
        <p className="empty-note">Choose a ticket from the inbox to read it and run triage.</p>
      </section>
    );
  }

  const triage = ticket.triage;
  const triageBusy = triageState.kind === 'running' || triageState.kind === 'awaiting-sync';
  const escalationBusy = escalationUi.kind === 'running' || escalationUi.kind === 'awaiting-sync';
  const draftBusy =
    draftUi.kind === 'running' || draftUi.kind === 'awaiting-sync' || escalationBusy;
  const labelTotal = ticket.fixture
    ? ticket.fixture.personalData.reduce((n, p) => n + p.count, 0)
    : null;
  const countMatchesLabel =
    artefact && labelTotal !== null ? artefact.redactionCount === labelTotal : null;

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
            disabled={triageBusy}
            onClick={() => onRunTriage(ticket)}
          >
            {triageState.kind === 'running'
              ? 'Running triage…'
              : triageState.kind === 'awaiting-sync'
                ? 'Awaiting sync…'
                : triage
                  ? 'Run triage again'
                  : 'Run triage'}
          </button>
        </div>
        <p className="triage-note">
          {privacyMode
            ? 'Privacy Mode is on: triage runs on-device only. If the on-device model is unavailable, the task is refused rather than sent to the cloud.'
            : 'Device-preferred: short classification work tries Gemini Nano first and falls back to the cloud inside Firebase AI Logic. The route shown is the one the result reports.'}
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

        {triageState.kind === 'refused' && (
          <div className="triage-result triage-result--failed" role="alert">
            <p className="triage-failed-title">Refused — Privacy Mode</p>
            <p>{triageState.reason}</p>
            <p>{triageState.alternative}</p>
            <p className="num">The refusal was recorded as a route event. No model call was made.</p>
          </div>
        )}

        {triageState.kind === 'awaiting-sync' && (
          <div className="triage-result triage-result--sync" role="status">
            <p className="triage-failed-title">Completed locally — awaiting sync</p>
            <p>
              The result below is finished work, but it is not yet a proven success: its route
              record has not saved, so no route is claimed. It becomes a proven success when the
              record lands.
            </p>
            <TriageFields triage={triageState.triage} />
          </div>
        )}

        {triageState.kind !== 'failed' && triageState.kind !== 'awaiting-sync' && triage && (
          <div className="triage-result" aria-label="Triage result">
            <div className="triage-route-row">
              <RouteChip source={triage.actualSource} latencyMs={triage.latencyMs} />
              <span className="triage-requested">
                Requested: {ticket.privacyMode ? 'on-device only' : 'prefer on-device'}
              </span>
            </div>
            <TriageFields triage={triage} />
          </div>
        )}

        {triageState.kind !== 'failed' && !triage && triageState.kind !== 'running' && triageState.kind !== 'awaiting-sync' && triageState.kind !== 'refused' && (
          <p className="empty-note">No triage result yet for this ticket.</p>
        )}
      </div>

      <div className="slice-block">
        <div className="triage-head">
          <h3>Personal data &amp; redaction</h3>
          <button type="button" className="button button--secondary" onClick={() => onRedact(ticket)}>
            {artefact ? 'Redact again' : 'Redact personal data'}
          </button>
        </div>
        <p className="triage-note">
          Redaction runs on this device with deterministic pattern checks — no model call. It
          covers the labelled pattern types in the evaluation set: e-mail addresses, telephone
          numbers, order identifiers, payment references, postal addresses and names. It is not a
          guarantee for arbitrary free text.
        </p>

        {artefact && (
          <div className="redaction-result">
            <p className="redaction-count" role="status">
              Redaction count: <strong className="num">{artefact.redactionCount}</strong>
              {countMatchesLabel === true && <> — matches the fixture label for this ticket.</>}
              {countMatchesLabel === false && (
                <> — the fixture label for this ticket is <span className="num">{labelTotal}</span>; the difference is in the table below.</>
              )}
            </p>
            {artefact.entities.length > 0 ? (
              <table className="entity-table">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Masked value</th>
                    <th scope="col">Occurrences</th>
                  </tr>
                </thead>
                <tbody>
                  {artefact.entities.map((entity) => (
                    <tr key={`${entity.type}-${entity.maskedValue}`}>
                      <td>{entity.type}</td>
                      <td>{entity.maskedValue}</td>
                      <td className="num">{entity.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-note">No labelled personal-data patterns were found in this ticket.</p>
            )}
            <div className="compare-grid">
              <div>
                <h4>Original — unredacted</h4>
                <p className="compare-subject">{ticket.subject}</p>
                <p className="compare-body">{ticket.body}</p>
              </div>
              <div>
                <h4>Redacted</h4>
                <p className="compare-subject">{artefact.redactedSubject}</p>
                <p className="compare-body">{artefact.redactedBody}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="slice-block">
        <h3>What the cloud sees</h3>
        {!triage && (
          <p className="empty-note">
            Run triage first: the proposed escalation payload is built from the triage result and
            the redacted summary.
          </p>
        )}
        {triage && !preview && (
          <p className="empty-note">Redact this ticket to preview the exact payload an escalation would send.</p>
        )}
        {triage && preview && (
          <div className="payload-result">
            <p>
              <span className={`gate-chip gate-chip--${preview.gate.status}`}>
                {GATE_LABEL[preview.gate.status]}
              </span>{' '}
              <span className="payload-note">{preview.gate.note}</span>
            </p>
            <dl className="triage-grid">
              <div><dt>Redacted summary</dt><dd className="payload-summary">{preview.payload.redactedSummary}</dd></div>
              <div><dt>Category</dt><dd>{preview.payload.category}</dd></div>
              <div><dt>Urgency</dt><dd>{preview.payload.urgency}</dd></div>
              <div><dt>Sentiment</dt><dd>{preview.payload.sentiment}</dd></div>
              <div>
                <dt>Escalation trigger</dt>
                <dd>
                  {preview.payload.escalationTrigger
                    ? triggerLabel(preview.payload.escalationTrigger)
                    : 'None — no trigger fired'}
                </dd>
              </div>
              <div><dt>Issue count</dt><dd className="num">{preview.payload.issueCount}</dd></div>
              <div><dt>Redacted body characters</dt><dd className="num">{preview.payload.bodyCharacterCount}</dd></div>
              <div><dt>Redaction count</dt><dd className="num">{preview.payload.redactionCount}</dd></div>
            </dl>
            <p className="triage-note">
              This is the complete escalation payload, built from the redacted summary only: an
              escalation sends exactly this object and nothing else. It is not the whole
              cloud picture — triage itself may have run in the cloud on the ticket text; the
              route chip on the triage card shows which route actually ran.
            </p>
          </div>
        )}
      </div>

      <div className="slice-block">
        <h3>Escalation</h3>
        {!triage && (
          <p className="empty-note">
            Run triage first: the routing engine decides from the triage result and the redacted
            text whether this ticket stays on the simple path or escalates.
          </p>
        )}
        {triage && !decision && (
          <p className="empty-note">Redact this ticket to see the routing decision.</p>
        )}
        {triage && decision && decision.route === 'simple' && (
          <p className="triage-note">
            No escalation trigger fired — the routing engine keeps this ticket on the simple
            path. {decision.reason}
          </p>
        )}
        {triage && decision && decision.route === 'escalate' && preview && (
          <div className="escalation-block">
            <p>
              Escalation recommended — <strong>{triggerLabel(decision.trigger)}</strong>.{' '}
              {decision.reason}
            </p>
            <p className="triage-note">
              The escalation draft is written by the cloud model from the payload previewed
              above — exactly that object, never the raw ticket.
              {preview.gate.status === 'held-for-review' &&
                ' The payload is held for review (see the gate note above): the confirmation below is the explicit review this state requires.'}
              {preview.gate.status === 'minimised' &&
                ' Confirming sends exactly the payload above to the cloud model for drafting.'}
              {privacyMode &&
                ' Privacy Mode is on: an escalation runs in the cloud by definition, so escalating will be refused and the refusal recorded.'}
            </p>
            {preview.gate.status === 'blocked' ? (
              <button type="button" className="button button--primary" disabled>
                Escalation blocked by the payload gate
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={escalationBusy || draftUi.kind === 'running' || draftUi.kind === 'awaiting-sync'}
                onClick={() => onEscalate(ticket, preview, true)}
              >
                {escalationUi.kind === 'running'
                  ? 'Escalating…'
                  : escalationUi.kind === 'awaiting-sync'
                    ? 'Awaiting sync…'
                    : preview.gate.status === 'held-for-review'
                      ? 'I reviewed the payload — confirm and escalate'
                      : 'Confirm payload and escalate'}
              </button>
            )}

            {escalationUi.kind === 'awaiting-sync' && (
              <div className="triage-result triage-result--sync" role="status">
                <p className="triage-failed-title">Escalation draft completed — awaiting sync</p>
                <p>
                  The draft below is finished work, but its route record has not saved yet, so no
                  route is claimed. It becomes a proven success when the record lands.
                </p>
                <p className="draft-preview">{escalationUi.result.text}</p>
              </div>
            )}

            {escalationUi.kind === 'done' && (
              <div className="triage-result" aria-label="Escalation result">
                <div className="triage-route-row">
                  <RouteChip
                    source={escalationUi.result.actualSource}
                    latencyMs={escalationUi.result.latencyMs}
                  />
                  <span className="triage-requested">Requested: prefer cloud</span>
                </div>
                <p>
                  Escalation reason: {triggerLabel(escalationUi.result.escalationTrigger)}. The
                  draft is stored as this ticket&rsquo;s reply draft below — review and edit it
                  there before the simulated send.
                </p>
              </div>
            )}

            {escalationUi.kind === 'refused' && (
              <div className="triage-result triage-result--failed" role="alert">
                <p className="triage-failed-title">Refused — Privacy Mode</p>
                <p>{escalationUi.reason}</p>
                <p>{escalationUi.alternative}</p>
                <p className="num">The refusal was recorded as a route event. No model call was made.</p>
              </div>
            )}

            {escalationUi.kind === 'blocked' && (
              <div className="triage-result triage-result--failed" role="alert">
                <p className="triage-failed-title">Escalation blocked</p>
                <p>{escalationUi.note}</p>
                <p className="num">The block was recorded as a route event. No model call was made.</p>
              </div>
            )}

            {escalationUi.kind === 'needs-confirmation' && (
              <p className="triage-note" role="status">{escalationUi.note}</p>
            )}

            {escalationUi.kind === 'failed' && (
              <div className="triage-result triage-result--failed" role="alert">
                <p className="triage-failed-title">Escalation failed</p>
                <p>{escalationUi.error}</p>
                <p>The ticket and any draft below are unchanged.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="slice-block">
        <div className="triage-head">
          <h3>Reply draft</h3>
          <div className="draft-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={draftBusy}
              onClick={() => onDraft(ticket)}
            >
              {draftUi.kind === 'running'
                ? 'Drafting…'
                : draftUi.kind === 'awaiting-sync'
                  ? 'Awaiting sync…'
                  : draft
                    ? 'Regenerate draft'
                    : 'Draft reply'}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={draftBusy}
              onClick={() => onManualDraft(ticket)}
            >
              Write manually
            </button>
          </div>
        </div>
        <p className="triage-note">
          Drafts are written from the redacted ticket text only
          {privacyMode ? ', and Privacy Mode is on: drafting runs on-device only.' : '.'}
        </p>

        {draftUi.kind === 'running' && <p className="empty-note">Drafting a reply…</p>}

        {draftUi.kind === 'awaiting-sync' && (
          <div className="triage-result triage-result--sync" role="status">
            <p className="triage-failed-title">Draft completed locally — awaiting sync</p>
            <p>
              Its route record has not saved yet, so no route is claimed. The text becomes editable
              once the record lands.
            </p>
            <p className="draft-preview">{draftUi.text}</p>
          </div>
        )}

        {draftUi.kind === 'refused' && (
          <div className="triage-result triage-result--failed" role="alert">
            <p className="triage-failed-title">Refused — Privacy Mode</p>
            <p>{draftUi.reason}</p>
            <p>{draftUi.alternative}</p>
            <p className="num">The refusal was recorded as a route event. No model call was made.</p>
          </div>
        )}

        {draftUi.kind === 'failed' && (
          <div className="triage-result triage-result--failed" role="alert">
            <p className="triage-failed-title">Drafting failed</p>
            <p>{draftUi.error}</p>
            <p>
              Regenerate it, or use “Write manually”. The ticket
              {draft ? ' and the previous draft below are' : ' is'} unchanged.
            </p>
          </div>
        )}

        {draft && draftUi.kind !== 'awaiting-sync' && (
          <div className="draft-result">
            <label>
              Draft text (editable)
              <textarea
                rows={7}
                value={draft.text}
                disabled={draft.state === 'sent-simulated'}
                onChange={(e) => onDraftTextChange(ticket, e.target.value)}
                onBlur={() => onDraftSave(ticket)}
              />
            </label>
            {draft.actualSource ? (
              <div className="triage-route-row">
                <RouteChip source={draft.actualSource} latencyMs={draft.latencyMs ?? undefined} />
                <span className="triage-requested">
                  Requested:{' '}
                  {draft.requestedMode === 'only_on_device'
                    ? 'on-device only'
                    : draft.requestedMode === 'prefer_in_cloud'
                      ? 'prefer cloud'
                      : 'prefer on-device'}
                </span>
              </div>
            ) : (
              <p className="triage-note">Written manually — no AI route was used, so no route is shown.</p>
            )}
            {draft.escalationReason && (
              <p className="triage-note">Escalation draft — reason: {draft.escalationReason}.</p>
            )}
            {draftUi.kind === 'ready' && draftUi.saveError && (
              <p className="form-error" role="alert">
                The edited draft could not be saved: {draftUi.saveError} Your text is still in the
                box above; saving is retried when you leave the field.
              </p>
            )}

            {draft.state === 'sent-simulated' ? (
              <p className="sent-note" role="status">
                Sent (simulated). Nothing was sent to the customer — the send is recorded in your own workspace only.
              </p>
            ) : draftUi.kind === 'ready' ? (
              <>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={draftUi.send.kind === 'sending' || draft.text.trim().length === 0}
                  onClick={() => onSend(ticket)}
                >
                  {draftUi.send.kind === 'sending' ? 'Sending (simulated)…' : 'Send (simulated)'}
                </button>
                {draftUi.send.kind === 'queued' && (
                  <p className="triage-result triage-result--sync send-note" role="status">
                    {draftUi.send.note} If it has not landed once you are back online, use “Send
                    (simulated)” again.
                  </p>
                )}
                {draftUi.send.kind === 'failed' && (
                  <div className="triage-result triage-result--failed send-note" role="alert">
                    <p className="triage-failed-title">Send failed</p>
                    <p>{draftUi.send.error}</p>
                    <p>{draftUi.send.nextAction}</p>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        {!draft && draftUi.kind === 'idle' && (
          <p className="empty-note">No draft yet. Drafting uses a single short call on the selected route.</p>
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
