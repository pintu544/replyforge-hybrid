import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFirebaseServices } from './lib/firebase';
import type { Draft, EvaluationRun, RedactedArtefact, RouteEvent, Ticket } from './lib/types';
import { useAuth } from './hooks/useAuth';
import { FirestoreTicketRepository, type TicketRepository } from './services/repository';
import { loadFixture } from './services/fixtureLoader';
import { writerForRepository, type RouteEventWriter } from './services/routeEvents';
import {
  FirebaseCloudPreferredAdapter,
  FirebaseDeviceOnlyAdapter,
  FirebaseDevicePreferredAdapter,
} from './services/inference';
import { AvailabilityController } from './services/availability';
import { runTriage } from './services/triage';
import { produceRedactedArtefact } from './services/redaction';
import { prepareEscalation, type EscalationPreview } from './services/payload';
import { recordRefusal, resolveTaskRoute, type TaskAdapters } from './services/taskRouting';
import { manualDraftRecord, runDraft, sendSimulated, toDraftRecord } from './services/drafts';
import {
  DEFAULT_ROUTING_CONFIG,
  loadAppConfig,
  type RoutingConfig,
} from './services/appConfig';
import { decideRoute, type RoutingDecision } from './services/routing';
import { runEscalation, toEscalationDraftRecord } from './services/escalation';
import { runEvaluation } from './services/evaluation';
import fixtureFileJson from '../fixtures/tickets.json';
import type { FixtureFile } from './lib/types';
import { AuthPanel } from './components/AuthPanel';
import { HybridStatusPanel } from './components/HybridStatusPanel';
import { TicketList } from './components/TicketList';
import { EvaluationPanel } from './components/EvaluationPanel';
import { ScorecardPanel } from './components/ScorecardPanel';
import {
  ManualTicketForm,
  READY_DRAFT_UI,
  TicketWorkspace,
  type DraftUiState,
  type EscalationUiState,
  type TriageUiState,
} from './components/TicketWorkspace';

const fixtureFile = fixtureFileJson as FixtureFile;

/** Recorded on each EvaluationRun so its figures carry their provenance. */
const DEVICE_DESCRIPTION =
  'Reference measurement machine — Ubuntu 24.04.4 LTS · Chrome 155.0.8059.39 · 23 GiB RAM · Intel Xeon 4 cores / 8 threads · no GPU';

interface UserServices {
  repo: TicketRepository;
  writer: RouteEventWriter;
  adapter: FirebaseDevicePreferredAdapter;
  deviceOnlyAdapter: FirebaseDeviceOnlyAdapter;
  cloudAdapter: FirebaseCloudPreferredAdapter;
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
  const [escalationUiStates, setEscalationUiStates] = useState<Record<string, EscalationUiState>>({});
  const [routeEvents, setRouteEvents] = useState<RouteEvent[]>([]);
  const [evaluationRuns, setEvaluationRuns] = useState<EvaluationRun[]>([]);
  const [evalProgress, setEvalProgress] = useState<{ done: number; total: number } | null>(null);
  const [evalRefusal, setEvalRefusal] = useState<{ reason: string; alternative: string } | null>(null);
  const [routingConfig, setRoutingConfig] = useState<RoutingConfig>(DEFAULT_ROUTING_CONFIG);

  // Routing configuration (Slice 3, T-3.1): Remote Config values merge
  // over the in-code defaults; any failure resolves to the defaults, so
  // the app behaves identically until the console template is published.
  useEffect(() => {
    const services = getFirebaseServices();
    let cancelled = false;
    void loadAppConfig(services?.app ?? null).then((config) => {
      if (!cancelled) setRoutingConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const userServices = useMemo<UserServices | null>(() => {
    const services = getFirebaseServices();
    if (!services || !auth.user) return null;
    const repo = new FirestoreTicketRepository(services.db);
    return {
      repo,
      writer: writerForRepository(repo, auth.user.uid),
      adapter: new FirebaseDevicePreferredAdapter(services.ai, routingConfig.cloudModelName),
      deviceOnlyAdapter: new FirebaseDeviceOnlyAdapter(services.ai, routingConfig.cloudModelName),
      cloudAdapter: new FirebaseCloudPreferredAdapter(services.ai, routingConfig.cloudModelName),
    };
  }, [auth.user, routingConfig]);

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

  // Session epoch (T-2.8 QA, generalising the T-1.9 W-1 fix): every change
  // of signed-in account bumps the epoch. Handlers capture the epoch when
  // they start and check it before painting any post-await state, so a
  // task that completes after an account switch cannot paint the previous
  // account's result — including draft text — into the new session. The
  // data layer was never the problem (each account's writes stay in its
  // own partition); this guards the UI state only.
  const sessionEpochRef = useRef(0);
  useEffect(() => {
    sessionEpochRef.current += 1;
  }, [auth.user?.uid]);
  const isCurrentSession = useCallback(
    (epoch: number) => sessionEpochRef.current === epoch,
    [],
  );

  const refreshTickets = useCallback(async () => {
    if (!userServices || !auth.user) return;
    // A refresh that straddles an account switch must not paint the old
    // account's inbox into the new session (T-2.8 QA, session epoch).
    const epoch = sessionEpochRef.current;
    const existing = await userServices.repo.listTickets(auth.user.uid);
    if (!isCurrentSession(epoch)) return;
    if (!existing.some((t) => t.source === 'fixture')) {
      const result = await loadFixture(userServices.repo, auth.user.uid, fixtureFile);
      if (!isCurrentSession(epoch)) return;
      setInboxMessage(
        `Fixture inbox ready: ${result.totalFixtureTickets} tickets (${result.created} newly loaded).`,
      );
      setTickets(await userServices.repo.listTickets(auth.user.uid));
    } else {
      setTickets(existing);
    }
    const drafts = await userServices.repo.listDrafts(auth.user.uid);
    if (!isCurrentSession(epoch)) return;
    setDraftsByTicket(Object.fromEntries(drafts.map((d) => [d.ticketId, d])));
    // Scorecard inputs (Slice 3): stored route events + evaluation runs.
    // A metrics read failure must not fail the inbox — the panels show
    // their empty states and the next refresh retries.
    try {
      const [events, runs] = await Promise.all([
        userServices.repo.listRouteEvents(auth.user.uid),
        userServices.repo.listEvaluationRuns(auth.user.uid),
      ]);
      if (!isCurrentSession(epoch)) return;
      setRouteEvents(events);
      setEvaluationRuns(runs);
    } catch {
      // See above: metrics are a display, task flows keep their own proof.
    }
  }, [userServices, auth.user, isCurrentSession]);

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
      setEscalationUiStates({});
      setRouteEvents([]);
      setEvaluationRuns([]);
      setEvalProgress(null);
      setEvalRefusal(null);
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

  // One guard for the whole draft lifecycle of a ticket (T-2.8 QA): an AI
  // draft, a manual draft, and a simulated send for the same ticket must
  // never overlap. Previously the AI draft and the send had separate
  // guards and the manual draft had none, so Write manually could
  // overwrite an in-flight AI draft and Regenerate could run mid-send.
  const draftActionInFlightRef = useRef<Set<string>>(new Set());

  /**
   * A new draft cycle supersedes a simulated send (T-2.8 QA): when a
   * fresh draft record replaces a sent one, the ticket returns to its
   * pre-send status ('triaged' when triage exists, otherwise 'inbox'),
   * so the Send action becomes available again for the new draft.
   * Without this, Regenerate / Write manually silently overwrote the
   * sent draft record while the ticket still claimed 'sent-simulated' —
   * an inconsistent pair. Called only on paths that actually produce a
   * replacement draft; a refused or failed attempt leaves the sent pair
   * untouched.
   */
  const revertSentTicketIfNeeded = useCallback(
    async (ticket: Ticket, epoch: number) => {
      if (!userServices) return;
      const current = freshest(ticket);
      if (current.status !== 'sent-simulated') return;
      const reverted: Ticket = {
        ...current,
        status: current.triage ? 'triaged' : 'inbox',
      };
      try {
        await userServices.repo.saveTicket(reverted);
      } catch {
        // The in-memory revert below still keeps the pair consistent.
      }
      if (!isCurrentSession(epoch)) return;
      setTickets((list) => list.map((t) => (t.id === reverted.id ? reverted : t)));
    },
    [userServices, freshest, isCurrentSession],
  );

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
      const epoch = sessionEpochRef.current;
      try {
        const resolution = resolveTaskRoute({
          privacyMode,
          availability: deviceAvailabilityNow(),
          adapters,
        });
        if (resolution.kind === 'refused') {
          // Paint the refusal FIRST (T-2.8 QA): recording the refusal
          // event is bounded at 10 s, and the operator must not wait for
          // the record to learn the task was refused.
          setTriageStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'refused', reason: resolution.reason, alternative: resolution.alternative },
          }));
          await recordRefusal(userServices.writer, {
            ticketId: ticket.id,
            taskType: 'triage',
            redactionCount: ticket.redactionCount,
            isOnline: () => navigator.onLine,
          });
          return;
        }
        setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
        const outcome = await runTriage(
          {
            adapter: resolution.adapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
            requestedMode: resolution.requestedMode,
            promptTemplate: routingConfig.triagePrompt,
            onLocalSuccess: (triage) => {
              if (!isCurrentSession(epoch)) return;
              // Slice 2 awaiting-sync state: finished work, no route claim,
              // until the durable route event lands (strict rule, T-1.10).
              setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'awaiting-sync', triage } }));
            },
          },
          ticket,
        );
        if (!isCurrentSession(epoch)) return;
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
    [
      userServices,
      taskAdapters,
      deviceAvailabilityNow,
      privacyMode,
      freshest,
      isCurrentSession,
      routingConfig,
    ],
  );

  const handleRedact = useCallback(
    async (ticket: Ticket) => {
      if (!userServices) return;
      const epoch = sessionEpochRef.current;
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
        if (!isCurrentSession(epoch)) return;
        setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)));
      } catch {
        // The artefact stays visible for this session even if the summary
        // fields could not be persisted.
      }
    },
    [userServices, privacyMode, freshest, isCurrentSession],
  );

  const handleDraft = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const adapters = taskAdapters();
      if (!adapters) return;
      if (draftActionInFlightRef.current.has(ticket.id)) return;
      draftActionInFlightRef.current.add(ticket.id);
      const epoch = sessionEpochRef.current;
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
          // Paint first, record second — same rule as triage (T-2.8 QA).
          setDraftUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'refused', reason: resolution.reason, alternative: resolution.alternative },
          }));
          await recordRefusal(userServices.writer, {
            ticketId: ticket.id,
            taskType: 'simple-draft',
            redactionCount: artefact.redactionCount,
            isOnline: () => navigator.onLine,
          });
          return;
        }
        setDraftUiStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
        const outcome = await runDraft(
          {
            adapter: resolution.adapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
            requestedMode: resolution.requestedMode,
            promptTemplate: routingConfig.draftPrompt,
            onLocalSuccess: (draft) => {
              if (!isCurrentSession(epoch)) return;
              setDraftUiStates((s) => ({
                ...s,
                [ticket.id]: { kind: 'awaiting-sync', text: draft.text },
              }));
            },
          },
          ticket,
          artefact,
        );
        if (!isCurrentSession(epoch)) return;
        if (outcome.status === 'success') {
          const record = toDraftRecord(ticket, outcome.draft);
          let saveError: string | null = null;
          try {
            await userServices.repo.saveDraft(auth.user.uid, record);
          } catch (err) {
            saveError = err instanceof Error ? err.message : 'The draft could not be saved.';
          }
          if (!isCurrentSession(epoch)) return;
          // A fresh draft supersedes any earlier simulated send.
          await revertSentTicketIfNeeded(ticket, epoch);
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
        draftActionInFlightRef.current.delete(ticket.id);
      }
    },
    [
      userServices,
      auth.user,
      taskAdapters,
      deviceAvailabilityNow,
      privacyMode,
      redactions,
      isCurrentSession,
      revertSentTicketIfNeeded,
      routingConfig,
    ],
  );

  const handleManualDraft = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      if (draftActionInFlightRef.current.has(ticket.id)) return;
      draftActionInFlightRef.current.add(ticket.id);
      const epoch = sessionEpochRef.current;
      try {
        const record = manualDraftRecord(ticket, draftsByTicket[ticket.id]?.text ?? '');
        let saveError: string | null = null;
        try {
          await userServices.repo.saveDraft(auth.user.uid, record);
        } catch (err) {
          saveError = err instanceof Error ? err.message : 'The draft could not be saved.';
        }
        if (!isCurrentSession(epoch)) return;
        // A fresh manual draft supersedes any earlier simulated send.
        await revertSentTicketIfNeeded(ticket, epoch);
        setDraftsByTicket((d) => ({ ...d, [ticket.id]: record }));
        setDraftUiStates((s) => ({
          ...s,
          [ticket.id]: { kind: 'ready', send: { kind: 'idle' }, saveError },
        }));
      } finally {
        draftActionInFlightRef.current.delete(ticket.id);
      }
    },
    [userServices, auth.user, draftsByTicket, isCurrentSession, revertSentTicketIfNeeded],
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
      const epoch = sessionEpochRef.current;
      try {
        await userServices.repo.saveDraft(auth.user.uid, record);
        if (!isCurrentSession(epoch)) return;
        setDraftUiStates((s) => {
          const current = s[ticket.id];
          if (current?.kind !== 'ready') return s;
          return { ...s, [ticket.id]: { ...current, saveError: null } };
        });
      } catch (err) {
        if (!isCurrentSession(epoch)) return;
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
    [userServices, auth.user, draftsByTicket, isCurrentSession],
  );

  const handleSend = useCallback(
    async (ticket: Ticket) => {
      if (!userServices || !auth.user) return;
      const record = draftsByTicket[ticket.id];
      if (!record || record.state === 'sent-simulated') return;
      if (draftActionInFlightRef.current.has(ticket.id)) return;
      draftActionInFlightRef.current.add(ticket.id);
      const epoch = sessionEpochRef.current;
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
        if (!isCurrentSession(epoch)) return;
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
        draftActionInFlightRef.current.delete(ticket.id);
      }
    },
    [userServices, auth.user, draftsByTicket, freshest, isCurrentSession],
  );

  const handleEscalate = useCallback(
    async (ticket: Ticket, preview: EscalationPreview, confirmedByOperator: boolean) => {
      if (!userServices || !auth.user) return;
      // Escalation is part of the ticket's draft lifecycle: the shared
      // in-flight guard keeps it from overlapping a draft or a send.
      if (draftActionInFlightRef.current.has(ticket.id)) return;
      draftActionInFlightRef.current.add(ticket.id);
      const epoch = sessionEpochRef.current;
      try {
        const current = freshest(ticket);
        if (!current.triage) return;
        // The escalation consumes the very BuiltEscalation object the
        // workspace preview rendered and the operator confirmed — it is
        // passed in, never rebuilt here (DESIGN.md, Slice 3 note; the
        // rebuild-by-construction this replaced was T-3.7 QA finding
        // W-2: identical only as long as every rebuild input happened
        // to match what was on screen).
        setEscalationUiStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
        const outcome = await runEscalation(
          {
            adapter: userServices.cloudAdapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
            confirmedByOperator,
            privacyMode,
            promptTemplate: routingConfig.escalationPrompt,
            onLocalSuccess: (result) => {
              if (!isCurrentSession(epoch)) return;
              setEscalationUiStates((s) => ({
                ...s,
                [ticket.id]: { kind: 'awaiting-sync', result },
              }));
            },
          },
          ticket.id,
          preview,
        );
        if (!isCurrentSession(epoch)) return;
        if (outcome.status === 'success') {
          const record = toEscalationDraftRecord(current, preview.payload, outcome.result);
          let saveError: string | null = null;
          try {
            await userServices.repo.saveDraft(auth.user.uid, record);
          } catch (err) {
            saveError = err instanceof Error ? err.message : 'The draft could not be saved.';
          }
          if (!isCurrentSession(epoch)) return;
          // The escalation draft becomes the ticket's reply draft: it
          // supersedes any earlier simulated send, exactly like a fresh
          // simple draft, and the ticket records its escalated state.
          await revertSentTicketIfNeeded(ticket, epoch);
          const escalated: Ticket = { ...freshest(ticket), status: 'escalated' };
          try {
            await userServices.repo.saveTicket(escalated);
          } catch {
            // The status is also set in memory below.
          }
          if (!isCurrentSession(epoch)) return;
          setTickets((list) => list.map((t) => (t.id === escalated.id ? escalated : t)));
          setDraftsByTicket((d) => ({ ...d, [ticket.id]: record }));
          setDraftUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'ready', send: { kind: 'idle' }, saveError },
          }));
          setEscalationUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'done', result: outcome.result },
          }));
          // The scorecard gains an escalation event; refresh its inputs.
          void refreshTickets();
        } else if (outcome.status === 'refused') {
          setEscalationUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'refused', reason: outcome.reason, alternative: outcome.alternative },
          }));
        } else if (outcome.status === 'blocked') {
          setEscalationUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'blocked', note: outcome.note },
          }));
        } else if (outcome.status === 'needs-confirmation') {
          setEscalationUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'needs-confirmation', note: outcome.note },
          }));
        } else {
          setEscalationUiStates((s) => ({
            ...s,
            [ticket.id]: { kind: 'failed', error: outcome.error },
          }));
        }
      } finally {
        draftActionInFlightRef.current.delete(ticket.id);
      }
    },
    [
      userServices,
      auth.user,
      privacyMode,
      routingConfig,
      freshest,
      isCurrentSession,
      revertSentTicketIfNeeded,
      refreshTickets,
    ],
  );

  const evalInFlightRef = useRef(false);

  const handleRunEvaluation = useCallback(async () => {
    if (!userServices || !auth.user) return;
    if (evalInFlightRef.current) return;
    const adapters = taskAdapters();
    if (!adapters) return;
    // The evaluation performs AI processing (30 triages), so it goes
    // through the same task routing as every other task (T-3.7 QA,
    // Critical C-1): under Privacy Mode with no device route it is
    // REFUSED before any model call — previously it silently used the
    // device-preferred handle and all 30 triages fell back to the
    // cloud, falsifying Privacy Mode's promise. With a device route it
    // runs device-only, and runTriage discards any cloud result.
    const resolution = resolveTaskRoute({
      privacyMode,
      availability: deviceAvailabilityNow(),
      adapters,
    });
    if (resolution.kind === 'refused') {
      setEvalRefusal({ reason: resolution.reason, alternative: resolution.alternative });
      return;
    }
    setEvalRefusal(null);
    evalInFlightRef.current = true;
    const epoch = sessionEpochRef.current;
    setEvalProgress({ done: 0, total: fixtureFile.tickets.length });
    try {
      const run = await runEvaluation(
        {
          adapter: resolution.adapter,
          writer: userServices.writer,
          isOnline: () => navigator.onLine,
          config: routingConfig,
          promptTemplate: routingConfig.triagePrompt,
          requestedMode: resolution.requestedMode,
          deviceDescription: DEVICE_DESCRIPTION,
          fixtureVersion: fixtureFile.fixtureVersion,
          // The free tier allows 15 requests/minute for the configured
          // model; pacing keeps the batch under it (see evaluation.ts).
          paceMs: 4_500,
          onProgress: (done, total) => {
            if (isCurrentSession(epoch)) setEvalProgress({ done, total });
          },
        },
        ticketsRef.current,
      );
      await userServices.repo.saveEvaluationRun(auth.user.uid, run);
      if (!isCurrentSession(epoch)) return;
      setEvaluationRuns((runs) => [run, ...runs]);
      const events = await userServices.repo.listRouteEvents(auth.user.uid);
      if (!isCurrentSession(epoch)) return;
      setRouteEvents(events);
    } catch {
      // A failed run saves nothing; the panel keeps the previous runs.
    } finally {
      evalInFlightRef.current = false;
      if (isCurrentSession(epoch)) setEvalProgress(null);
    }
  }, [userServices, auth.user, routingConfig, isCurrentSession, taskAdapters, privacyMode, deviceAvailabilityNow]);

  const handleAddManual = useCallback(
    async (subject: string, body: string) => {
      if (!userServices || !auth.user) throw new Error('Sign in first.');
      const epoch = sessionEpochRef.current;
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
      if (!isCurrentSession(epoch)) return;
      setTickets((list) => [ticket, ...list]);
      setSelectedId(ticket.id);
    },
    [userServices, auth.user, isCurrentSession],
  );

  // The routing engine's decision for the selected ticket (Slice 3,
  // T-3.2): triage output plus the REDACTED artefact — keyword checks run
  // on the redacted text only, never the raw ticket.
  const selectedDecision: RoutingDecision | null = useMemo(() => {
    if (!selected?.triage) return null;
    const artefact = redactions[selected.id];
    if (!artefact) return null;
    return decideRoute(
      {
        sentiment: selected.triage.sentiment,
        confidence: selected.triage.confidence,
        issueCount: selected.triage.issueCount,
        language: selected.language,
        redactedText: `${artefact.redactedSubject}\n${artefact.redactedBody}`,
        redactedBodyChars: artefact.redactedBody.length,
      },
      routingConfig,
    );
  }, [selected, redactions, routingConfig]);

  const selectedPreview: EscalationPreview | null = useMemo(() => {
    if (!selected?.triage) return null;
    if (!redactions[selected.id]) return null;
    // The single preparation path: the preview shows the exact payload
    // object the escalation path will consume (T-2.4) — now carrying the
    // routing engine's trigger (T-3.3).
    return prepareEscalation(selected, selected.triage, selectedDecision?.trigger ?? null);
  }, [selected, redactions, selectedDecision]);

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
            <p className="brand-line">On-device first. Drafts and escalations are built only from the redacted summary. Triage may run in the cloud — when it does, the ticket text goes to Firebase AI Logic.</p>
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
            <>
              <TicketWorkspace
                ticket={selected}
                triageState={selected ? (triageStates[selected.id] ?? { kind: 'idle' }) : { kind: 'idle' }}
                onRunTriage={(t) => void handleRunTriage(t)}
                artefact={selected ? (redactions[selected.id] ?? null) : null}
                onRedact={(t) => void handleRedact(t)}
                preview={selectedPreview}
                decision={selectedDecision}
                escalationUi={
                  selected ? (escalationUiStates[selected.id] ?? { kind: 'idle' }) : { kind: 'idle' }
                }
                onEscalate={(t, preview, confirmed) => void handleEscalate(t, preview, confirmed)}
                draft={selected ? (draftsByTicket[selected.id] ?? null) : null}
                draftUi={selectedDraftUi}
                onDraft={(t) => void handleDraft(t)}
                onManualDraft={(t) => void handleManualDraft(t)}
                onDraftTextChange={handleDraftTextChange}
                onDraftSave={(t) => void handleDraftSave(t)}
                onSend={(t) => void handleSend(t)}
                privacyMode={privacyMode}
              />
              <EvaluationPanel
                runs={evaluationRuns}
                progress={evalProgress}
                refusal={evalRefusal}
                onRun={() => void handleRunEvaluation()}
              />
              <ScorecardPanel events={routeEvents} runs={evaluationRuns} />
            </>
          ) : (
            <section className="panel workspace-panel" aria-label="Welcome">
              <h2>How ReplyForge works</h2>
              <p>
                Sign in to open the seeded support inbox. Triage runs device-preferred through
                Firebase AI Logic: short classification work tries Gemini Nano on this machine
                first, and the result card always shows the route that actually ran, with its
                latency. Triage classifies the ticket itself, so on a machine with no on-device
                model it runs in the cloud and the ticket text goes to Firebase AI Logic.
                Redaction is a separate step: deterministic pattern checks run on this device,
                drafts are written from the redacted text only, and the “What the cloud sees”
                preview shows the exact payload a cloud escalation would send — an escalation
                never carries the raw ticket.
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
