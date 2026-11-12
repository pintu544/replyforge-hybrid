import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFirebaseServices } from './lib/firebase';
import type { Draft, RedactedArtefact, Ticket } from './lib/types';
import { useAuth } from './hooks/useAuth';
import { FirestoreTicketRepository, type TicketRepository } from './services/repository';
import { loadFixture } from './services/fixtureLoader';
import { writerForRepository, type RouteEventWriter } from './services/routeEvents';
import {
  FirebaseDeviceOnlyAdapter,
  FirebaseDevicePreferredAdapter,
} from './services/inference';
import { AvailabilityController } from './services/availability';
import { runTriage } from './services/triage';
import { produceRedactedArtefact } from './services/redaction';
import { prepareEscalation, type EscalationPreview } from './services/payload';
import { recordRefusal, resolveTaskRoute, type TaskAdapters } from './services/taskRouting';
import { manualDraftRecord, runDraft, sendSimulated, toDraftRecord } from './services/drafts';
import fixtureFileJson from '../fixtures/tickets.json';
import type { FixtureFile } from './lib/types';
import { AuthPanel } from './components/AuthPanel';
import { HybridStatusPanel } from './components/HybridStatusPanel';
import { TicketList } from './components/TicketList';
import {
  ManualTicketForm,
  READY_DRAFT_UI,
  TicketWorkspace,
  type DraftUiState,
  type TriageUiState,
} from './components/TicketWorkspace';

const fixtureFile = fixtureFileJson as FixtureFile;

interface UserServices {
  repo: TicketRepository;
  writer: RouteEventWriter;
  adapter: FirebaseDevicePreferredAdapter;
  deviceOnlyAdapter: FirebaseDeviceOnlyAdapter;
}

export default function App() {
  const auth = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [triageStates, setTriageStates] = useState<Record<string, TriageUiState>>({});
  const [privacyMode, setPrivacyMode] = useState(false);
  const [redactions, setRedactions] = useState<Record<string, RedactedArtefact>>({});
  const [draftsByTicket, setDraftsByTicket] = useState<Record<string, Draft>>({});
  const [draftUiStates, setDraftUiStates] = useState<Record<string, DraftUiState>>({});

  const userServices = useMemo<UserServices | null>(() => {
    const services = getFirebaseServices();
    if (!services || !auth.user) return null;
    const repo = new FirestoreTicketRepository(services.db);
    return {
      repo,
      writer: writerForRepository(repo, auth.user.uid),
      adapter: new FirebaseDevicePreferredAdapter(services.ai),
      deviceOnlyAdapter: new FirebaseDeviceOnlyAdapter(services.ai),
    };
  }, [auth.user]);

  const controllerRef = useRef<AvailabilityController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AvailabilityController(undefined, async (onProgress) => {
      const services = getFirebaseServices();
      if (!services) throw new Error('Firebase is not configured.');
      const adapter = new FirebaseDevicePreferredAdapter(services.ai);
      await adapter.initialiseDeviceModel(onProgress);
    });
  }

  useEffect(() => {
    void controllerRef.current?.refresh();
  }, []);

  const refreshTickets = useCallback(async () => {
    if (!userServices || !auth.user) return;
    const existing = await userServices.repo.listTickets(auth.user.uid);
    if (!existing.some((t) => t.source === 'fixture')) {
      const result = await loadFixture(userServices.repo, auth.user.uid, fixtureFile);
      setInboxMessage(
        `Fixture inbox ready: ${result.totalFixtureTickets} tickets (${result.created} newly loaded).`,
      );
      setTickets(await userServices.repo.listTickets(auth.user.uid));
    } else {
      setTickets(existing);
    }
    const drafts = await userServices.repo.listDrafts(auth.user.uid);
    setDraftsByTicket(Object.fromEntries(drafts.map((d) => [d.ticketId, d])));
  }, [userServices, auth.user]);

  // A queued simulated send lands when the connection returns; reloading on
  // reconnect is how its outcome becomes visible (SPEC FR-11).
  useEffect(() => {
    if (!auth.user) return;
    const onOnline = () => {
      refreshTickets().catch(() => {
        // The next interaction retries the load anyway.
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [auth.user, refreshTickets]);

  useEffect(() => {
    if (!auth.user) {
      setTickets([]);
      setSelectedId(null);
      // Per-user session state must not bleed into the next account that
      // signs in on this page (T-1.9 QA: account B was shown account A's
      // triage failure card, including its "was recorded" claim).
      setTriageStates({});
      setRedactions({});
      setDraftsByTicket({});
      setDraftUiStates({});
      setPrivacyMode(false);
      setInboxMessage(null);
      setInboxError(null);
      return;
    }
    refreshTickets().catch((err: unknown) => {
      setInboxError(
        err instanceof Error
          ? `The inbox could not be loaded: ${err.message}`
          : 'The inbox could not be loaded.',
      );
    });
  }, [auth.user, refreshTickets]);

  const selected = tickets.find((t) => t.id === selectedId) ?? tickets[0] ?? null;

  // Handlers receive the ticket as rendered at click time, which can lag a
  // just-completed update (e.g. Redact clicked, then Triage a moment later:
  // the triage save would spread the pre-redaction snapshot and silently
  // revert redactionCount/redactedSummary in Firestore — caught in the
  // Slice 2 live pass). Persistence spreads the freshest known ticket.
  const ticketsRef = useRef<Ticket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);
  const freshest = useCallback(
    (ticket: Ticket) => ticketsRef.current.find((t) => t.id === ticket.id) ?? ticket,
    [],
  );

  const triageInFlightRef = useRef<Set<string>>(new Set());

  const taskAdapters = useCallback((): TaskAdapters | null => {
    if (!userServices) return null;
    return {
      devicePreferred: userServices.adapter,
      deviceOnly: userServices.deviceOnlyAdapter,
    };
  }, [userServices]);

  const deviceAvailabilityNow = useCallback(
    () => controllerRef.current?.getSnapshot().state ?? 'unavailable',
    [],
  );

  const handleRunTriage = useCallback(
    async (ticket: Ticket) => {
      if (!userServices) return;
      const adapters = taskAdapters();
      if (!adapters) return;
      // The button's disabled state is a courtesy, not a guard: a second
      // activation that slips past it must not run a duplicate AI task or
      // write a duplicate route event (T-1.9 QA).
      if (triageInFlightRef.current.has(ticket.id)) return;
      triageInFlightRef.current.add(ticket.id);
      try {
        const resolution = resolveTaskRoute({
          privacyMode,
          availability: deviceAvailabilityNow(),
          adapters,
        });
        if (resolution.kind === 'refused') {
          await recordRefusal(userServices.writer, {
            ticketId: ticket.id,
            taskType: 'triage',
            redactionCount: ticket.redactionCount,
            isOnline: () => navigator.onLine,
          });
          setTriageStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'refused', reason: resolution.reason, alternative: resolution.alternative },
          }));
          return;
        }
        setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
        const outcome = await runTriage(
          {
            adapter: resolution.adapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
            requestedMode: resolution.requestedMode,
            onLocalSuccess: (triage) => {
              // Slice 2 awaiting-sync state: finished work, no route claim,
              // until the durable route event lands (strict rule, T-1.10).
              setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'awaiting-sync', triage } }));
            },
          },
          ticket,
        );
        if (outcome.status === 'success') {
          const updated: Ticket = {
            ...freshest(ticket),
            triage: outcome.triage,
            status: 'triaged',
            privacyMode,
          };
          try {
            await userServices.repo.saveTicket(updated);
            setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)));
          } catch {
            // The result stays visible even if persistence fails; the route event
            // has already been written by the triage service.
            setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)));
          }
          setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'done', outcome } }));
        } else {
          setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'failed', outcome } }));
        }
      } finally {
        triageInFlightRef.current.delete(ticket.id);
      }
    },
    [userServices, taskAdapters, deviceAvailabilityNow, privacyMode, freshest],
  );

  const handleRedact = useCallback(
    async (ticket: Ticket) => {
      if (!userServices) return;
      // Deterministic local code: no model call, no route event (T-2.2).
      const artefact = produceRedactedArtefact(ticket);
      setRedactions((r) => ({ ...r, [ticket.id]: artefact }));
      const updated: Ticket = {
        ...freshest(ticket),
        redactedSummary: artefact.redactedSummary,
        redactionCount: artefact.redactionCount,
        privacyMode,
      };
      try {
        await userServices.repo.saveTicket(updated);
        setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)));
      } catch {
        // The artefact stays visible for this session even if the summary
        // fields could not be persisted.
      }
    },
    [userServices, privacyMode, freshest],
  );

  const draftInFlightRef = useRef<Set<string>>(new Set());

  const handleDraft = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const adapters = taskAdapters();
      if (!adapters) return;
      if (draftInFlightRef.current.has(ticket.id)) return;
      draftInFlightRef.current.add(ticket.id);
      try {
        // The draft prompt is built from the redacted artefact only; if the
        // ticket has not been redacted yet, redact it first (local, free).
        const artefact = redactions[ticket.id] ?? produceRedactedArtefact(ticket);
        if (!redactions[ticket.id]) {
          setRedactions((r) => ({ ...r, [ticket.id]: artefact }));
        }
        const resolution = resolveTaskRoute({
          privacyMode,
          availability: deviceAvailabilityNow(),
          adapters,
        });
        if (resolution.kind === 'refused') {
          await recordRefusal(userServices.writer, {
            ticketId: ticket.id,
            taskType: 'simple-draft',
            redactionCount: artefact.redactionCount,
            isOnline: () => navigator.onLine,
          });
          setDraftUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'refused', reason: resolution.reason, alternative: resolution.alternative },
          }));
          return;
        }
        setDraftUiStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
        const outcome = await runDraft(
          {
            adapter: resolution.adapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
            requestedMode: resolution.requestedMode,
            onLocalSuccess: (draft) => {
              setDraftUiStates((s) => ({
                ...s,
                [ticket.id]: { kind: 'awaiting-sync', text: draft.text },
              }));
            },
          },
          ticket,
          artefact,
        );
        if (outcome.status === 'success') {
          const record = toDraftRecord(ticket, outcome.draft);
          let saveError: string | null = null;
          try {
            await userServices.repo.saveDraft(auth.user.uid, record);
          } catch (err) {
            saveError = err instanceof Error ? err.message : 'The draft could not be saved.';
          }
          setDraftsByTicket((d) => ({ ...d, [ticket.id]: record }));
          setDraftUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'ready', send: { kind: 'idle' }, saveError },
          }));
        } else {
          setDraftUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'failed', error: outcome.error },
          }));
        }
      } finally {
        draftInFlightRef.current.delete(ticket.id);
      }
    },
    [userServices, auth.user, taskAdapters, deviceAvailabilityNow, privacyMode, redactions],
  );

  const handleManualDraft = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const record = manualDraftRecord(ticket, draftsByTicket[ticket.id]?.text ?? '');
      let saveError: string | null = null;
      try {
        await userServices.repo.saveDraft(auth.user.uid, record);
      } catch (err) {
        saveError = err instanceof Error ? err.message : 'The draft could not be saved.';
      }
      setDraftsByTicket((d) => ({ ...d, [ticket.id]: record }));
      setDraftUiStates((s) => ({
        ...s,
        [ticket.id]: { kind: 'ready', send: { kind: 'idle' }, saveError },
      }));
    },
    [userServices, auth.user, draftsByTicket],
  );

  const handleDraftTextChange = useCallback((ticket: Ticket, text: string) => {
    setDraftsByTicket((d) => {
      const current = d[ticket.id];
      if (!current) return d;
      return {
        ...d,
        [ticket.id]: {
          ...current,
          text,
          state: current.state === 'sent-simulated' ? current.state : 'edited',
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const handleDraftSave = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const record = draftsByTicket[ticket.id];
      if (!record || record.state === 'sent-simulated') return;
      try {
        await userServices.repo.saveDraft(auth.user.uid, record);
        setDraftUiStates((s) => {
          const current = s[ticket.id];
          if (current?.kind !== 'ready') return s;
          return { ...s, [ticket.id]: { ...current, saveError: null } };
        });
      } catch (err) {
        setDraftUiStates((s) => {
          const current = s[ticket.id];
          if (current?.kind !== 'ready') return s;
          return {
            ...s,
            [ticket.id]: {
              ...current,
              saveError: err instanceof Error ? err.message : 'The draft could not be saved.',
            },
          };
        });
      }
    },
    [userServices, auth.user, draftsByTicket],
  );

  const sendInFlightRef = useRef<Set<string>>(new Set());

  const handleSend = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const record = draftsByTicket[ticket.id];
      if (!record || record.state === 'sent-simulated') return;
      if (sendInFlightRef.current.has(ticket.id)) return;
      sendInFlightRef.current.add(ticket.id);
      const uid = auth.user.uid;
      const setSend = (send: DraftUiState) =>
        setDraftUiStates((s) => ({ ...s, [ticket.id]: send }));
      try {
        setSend({ kind: 'ready', send: { kind: 'sending' }, saveError: null });
        const sentRecord: Draft = {
          ...record,
          state: 'sent-simulated',
          updatedAt: new Date().toISOString(),
        };
        const sentTicket: Ticket = { ...freshest(ticket), status: 'sent-simulated' };
        // The whole "send" is these two writes to the user's own partition:
        // no request leaves the app for any mail or messaging service.
        const outcome = await sendSimulated(async () => {
          await userServices.repo.saveDraft(uid, sentRecord);
          await userServices.repo.saveTicket(sentTicket);
        });
        if (outcome.status === 'sent') {
          setDraftsByTicket((d) => ({ ...d, [ticket.id]: sentRecord }));
          setTickets((list) => list.map((t) => (t.id === ticket.id ? sentTicket : t)));
          setSend({ kind: 'ready', send: { kind: 'idle' }, saveError: null });
        } else if (outcome.status === 'queued') {
          setSend({ kind: 'ready', send: { kind: 'queued', note: outcome.note }, saveError: null });
        } else {
          setSend({
            kind: 'ready',
            send: { kind: 'failed', error: outcome.error, nextAction: outcome.nextAction },
            saveError: null,
          });
        }
      } finally {
        sendInFlightRef.current.delete(ticket.id);
      }
    },
    [userServices, auth.user, draftsByTicket, freshest],
  );

  const handleAddManual = useCallback(
    async (subject: string, body: string) => {
      if (!userServices || !auth.user) throw new Error('Sign in first.');
      // Whitespace-only input passes the form's native `required` check but
      // trims to nothing; a content-less ticket must not enter the inbox
      // (T-1.9 QA).
      if (!subject.trim() || !body.trim()) {
        throw new Error('Subject and message must not be blank.');
      }
      const ticket: Ticket = {
        id: `manual-${crypto.randomUUID()}`,
        ownerUid: auth.user.uid,
        source: 'manual',
        subject,
        body,
        receivedAt: new Date().toISOString(),
        status: 'inbox',
        language: 'en',
        triage: null,
        fixture: null,
        redactedSummary: null,
        redactionCount: 0,
        privacyMode: false,
      };
      await userServices.repo.saveTicket(ticket);
      setTickets((list) => [ticket, ...list]);
      setSelectedId(ticket.id);
    },
    [userServices, auth.user],
  );

  const selectedPreview: EscalationPreview | null = useMemo(() => {
    if (!selected?.triage) return null;
    if (!redactions[selected.id]) return null;
    // The single preparation path: the preview shows the exact payload
    // object the escalation path will consume (T-2.4).
    return prepareEscalation(selected, selected.triage);
  }, [selected, redactions]);

  const selectedDraftUi: DraftUiState = selected
    ? (draftUiStates[selected.id] ?? (draftsByTicket[selected.id] ? READY_DRAFT_UI : { kind: 'idle' }))
    : { kind: 'idle' };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">RF</span>
          <div>
            <p className="brand-name">ReplyForge Hybrid</p>
            <p className="brand-line">On-device first. The cloud sees a redacted summary, never the raw ticket.</p>
          </div>
        </div>
        <div className="header-user">
          {auth.loading ? (
            <span className="header-note">Checking sign-in…</span>
          ) : auth.user ? (
            <>
              <span className="header-note">{auth.user.email ?? auth.user.uid}</span>
              <button type="button" className="button button--ghost" onClick={() => void auth.signOutUser()}>
                Sign out
              </button>
            </>
          ) : (
            <span className="header-note">Signed out</span>
          )}
        </div>
      </header>

      <main className="app-main">
        <div className="column column--side">
          <HybridStatusPanel controller={controllerRef.current} />
          {auth.user && (
            <section className="panel privacy-panel" aria-label="Privacy Mode">
              <div className="status-head">
                <h2>Privacy Mode</h2>
                <span className={`privacy-state${privacyMode ? ' privacy-state--on' : ''}`}>
                  {privacyMode ? 'On' : 'Off'}
                </span>
              </div>
              <p className="status-explanation">
                When on, triage and drafting run on-device only. If the on-device model is
                unavailable, the task is refused and the refusal recorded — nothing is sent to
                the cloud.
              </p>
              <label className="privacy-toggle">
                <input
                  type="checkbox"
                  checked={privacyMode}
                  onChange={(e) => setPrivacyMode(e.target.checked)}
                />
                <span>Use device-only processing</span>
              </label>
            </section>
          )}
          {auth.user ? (
            <ManualTicketForm onAdd={handleAddManual} />
          ) : (
            !auth.loading && <AuthPanel auth={auth} />
          )}
          {auth.user && (
            <TicketList
              tickets={tickets}
              query={query}
              onQueryChange={setQuery}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
          )}
        </div>
        <div className="column column--work">
          {inboxError && (
            <p className="banner banner--error" role="alert">{inboxError}</p>
          )}
          {inboxMessage && <p className="banner">{inboxMessage}</p>}
          {auth.user ? (
            <TicketWorkspace
              ticket={selected}
              triageState={selected ? (triageStates[selected.id] ?? { kind: 'idle' }) : { kind: 'idle' }}
              onRunTriage={(t) => void handleRunTriage(t)}
              artefact={selected ? (redactions[selected.id] ?? null) : null}
              onRedact={(t) => void handleRedact(t)}
              preview={selectedPreview}
              draft={selected ? (draftsByTicket[selected.id] ?? null) : null}
              draftUi={selectedDraftUi}
              onDraft={(t) => void handleDraft(t)}
              onManualDraft={(t) => void handleManualDraft(t)}
              onDraftTextChange={handleDraftTextChange}
              onDraftSave={(t) => void handleDraftSave(t)}
              onSend={(t) => void handleSend(t)}
              privacyMode={privacyMode}
            />
          ) : (
            <section className="panel workspace-panel" aria-label="Welcome">
              <h2>How ReplyForge works</h2>
              <p>
                Sign in to open the seeded support inbox. Triage runs device-preferred through
                Firebase AI Logic: short classification work tries Gemini Nano on this machine
                first, and the result card always shows the route that actually ran, with its
                latency. Personal data is redacted on-device before anything else happens,
                drafts are written from the redacted text only, and the “What the cloud sees”
                preview shows the exact payload a cloud escalation would send.
              </p>
              <p>
                Every AI attempt writes a route event that contains no ticket text — only the
                task, the requested mode, the actual route, and the timing.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
