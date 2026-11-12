import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFirebaseServices } from './lib/firebase';
import type { Ticket } from './lib/types';
import { useAuth } from './hooks/useAuth';
import { FirestoreTicketRepository, type TicketRepository } from './services/repository';
import { loadFixture } from './services/fixtureLoader';
import { writerForRepository, type RouteEventWriter } from './services/routeEvents';
import { FirebaseDevicePreferredAdapter } from './services/inference';
import { AvailabilityController } from './services/availability';
import { runTriage } from './services/triage';
import fixtureFileJson from '../fixtures/tickets.json';
import type { FixtureFile } from './lib/types';
import { AuthPanel } from './components/AuthPanel';
import { HybridStatusPanel } from './components/HybridStatusPanel';
import { TicketList } from './components/TicketList';
import { ManualTicketForm, TicketWorkspace, type TriageUiState } from './components/TicketWorkspace';

const fixtureFile = fixtureFileJson as FixtureFile;

interface UserServices {
  repo: TicketRepository;
  writer: RouteEventWriter;
  adapter: FirebaseDevicePreferredAdapter;
}

export default function App() {
  const auth = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [inboxMessage, setInboxMessage] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [triageStates, setTriageStates] = useState<Record<string, TriageUiState>>({});

  const userServices = useMemo<UserServices | null>(() => {
    const services = getFirebaseServices();
    if (!services || !auth.user) return null;
    const repo = new FirestoreTicketRepository(services.db);
    return {
      repo,
      writer: writerForRepository(repo, auth.user.uid),
      adapter: new FirebaseDevicePreferredAdapter(services.ai),
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
  }, [userServices, auth.user]);

  useEffect(() => {
    if (!auth.user) {
      setTickets([]);
      setSelectedId(null);
      // Per-user session state must not bleed into the next account that
      // signs in on this page (T-1.9 QA: account B was shown account A's
      // triage failure card, including its "was recorded" claim).
      setTriageStates({});
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

  const triageInFlightRef = useRef<Set<string>>(new Set());

  const handleRunTriage = useCallback(
    async (ticket: Ticket) => {
      if (!userServices) return;
      // The button's disabled state is a courtesy, not a guard: a second
      // activation that slips past it must not run a duplicate AI task or
      // write a duplicate route event (T-1.9 QA).
      if (triageInFlightRef.current.has(ticket.id)) return;
      triageInFlightRef.current.add(ticket.id);
      setTriageStates((s) => ({ ...s, [ticket.id]: { kind: 'running' } }));
      try {
        const outcome = await runTriage(
          {
            adapter: userServices.adapter,
            writer: userServices.writer,
            isOnline: () => navigator.onLine,
          },
          ticket,
        );
        if (outcome.status === 'success') {
          const updated: Ticket = { ...ticket, triage: outcome.triage, status: 'triaged' };
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
    [userServices],
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
      };
      await userServices.repo.saveTicket(ticket);
      setTickets((list) => [ticket, ...list]);
      setSelectedId(ticket.id);
    },
    [userServices, auth.user],
  );

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
            />
          ) : (
            <section className="panel workspace-panel" aria-label="Welcome">
              <h2>How ReplyForge works</h2>
              <p>
                Sign in to open the seeded support inbox. Triage runs device-preferred through
                Firebase AI Logic: short classification work tries Gemini Nano on this machine
                first, and the result card always shows the route that actually ran, with its
                latency. Later slices add on-device redaction, simple drafts, and cloud
                escalation built from the redacted summary only.
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
