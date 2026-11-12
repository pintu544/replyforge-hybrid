import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft, RouteEvent } from './lib/types';
import type { MemoryTicketRepository } from './services/repository';
import type { StructuredResult, TextResult } from './services/inference';
import App from './App';

/**
 * Component-level rig for App's session-state integrity (T-2.8, W-2).
 *
 * The Slice 2 QA findings in this area were code-traced in the browser —
 * the account-switch race and the delayed refusal display could not be
 * reproduced live in that session. This rig is the substitute evidence:
 * Firebase, Auth, the repository, the inference adapters, and the route
 * event writer are replaced with controllable doubles, so an in-flight
 * task can be held open across an account switch, and a route-event
 * write can be made to never settle — deterministically.
 */

interface FakeUser {
  uid: string;
  email: string;
}

const h = vi.hoisted(() => ({
  user: null as FakeUser | null,
  structuredImpl: null as null | ((prompt: string) => Promise<StructuredResult>),
  textImpl: null as null | ((prompt: string) => Promise<TextResult>),
  structuredCalls: 0,
  textCalls: 0,
  repos: [] as MemoryTicketRepository[],
  writerSink: null as null | ((event: RouteEvent) => Promise<void>),
  saveDraftGate: null as null | Promise<void>,
}));

vi.mock('./lib/firebase', () => ({
  getFirebaseServices: () => ({ app: {}, auth: {}, db: {}, ai: {}, appCheck: undefined }),
}));

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    configured: true,
    loading: false,
    user: h.user,
    signInGoogle: () => Promise.resolve(),
    signInEmail: () => Promise.resolve(),
    registerEmail: () => Promise.resolve(),
    signOutUser: () => Promise.resolve(),
  }),
}));

vi.mock('./services/repository', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./services/repository')>();
  class TrackedMemoryRepository extends orig.MemoryTicketRepository {
    constructor() {
      super();
      h.repos.push(this);
    }

    async saveDraft(ownerUid: string, draft: Draft): Promise<void> {
      if (h.saveDraftGate) await h.saveDraftGate;
      return super.saveDraft(ownerUid, draft);
    }
  }
  return { ...orig, FirestoreTicketRepository: TrackedMemoryRepository };
});

vi.mock('./services/inference', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./services/inference')>();
  class FakeAdapter {
    async generateStructured(prompt: string): Promise<StructuredResult> {
      h.structuredCalls += 1;
      if (!h.structuredImpl) throw new Error('structuredImpl not set by the test');
      return h.structuredImpl(prompt);
    }

    async generateText(prompt: string): Promise<TextResult> {
      h.textCalls += 1;
      if (!h.textImpl) throw new Error('textImpl not set by the test');
      return h.textImpl(prompt);
    }

    async initialiseDeviceModel(): Promise<void> {}
  }
  return {
    ...orig,
    FirebaseDevicePreferredAdapter: FakeAdapter,
    FirebaseDeviceOnlyAdapter: FakeAdapter,
    FirebaseCloudPreferredAdapter: FakeAdapter,
  };
});

vi.mock('./services/routeEvents', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./services/routeEvents')>();
  return {
    ...orig,
    writerForRepository: (repo: MemoryTicketRepository, ownerUid: string) =>
      new orig.RouteEventWriter(
        h.writerSink ?? ((event: RouteEvent) => repo.addRouteEvent(ownerUid, event)),
      ),
  };
});

const USER_A: FakeUser = { uid: 'user-a', email: 'a@replyforge.test' };
const USER_B: FakeUser = { uid: 'user-b', email: 'b@replyforge.test' };

const TRIAGE_JSON = JSON.stringify({
  category: 'delivery',
  urgency: 'normal',
  sentiment: 'neutral',
  confidence: 0.92,
  issueCount: 1,
  personalDataCount: 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(createElement(App));
  });
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function waitFor(check: () => boolean, description: string, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    await flush(2);
    if (check()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
  }
}

function pageText(): string {
  return container.textContent ?? '';
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

/**
 * Mirrors the Slice 1 QA W-2 technique: a stuck assistive tool or a
 * state-lag double-fire can activate a button whose `disabled` attribute
 * is the only protection. The handler's own guard is what must hold.
 */
function forceClick(el: HTMLButtonElement) {
  act(() => {
    el.removeAttribute('disabled');
    el.click();
  });
}

async function signInAs(user: FakeUser) {
  h.user = user;
  render();
  await waitFor(() => pageText().includes('30 of 30'), `fixture inbox for ${user.uid}`);
}

async function switchAccount(from: FakeUser, to: FakeUser) {
  // The real flow: sign out, then sign in as the other account, no reload.
  void from;
  h.user = null;
  render();
  await flush();
  await signInAs(to);
}

beforeEach(() => {
  h.user = null;
  h.structuredImpl = null;
  h.textImpl = null;
  h.structuredCalls = 0;
  h.textCalls = 0;
  h.repos = [];
  h.writerSink = null;
  h.saveDraftGate = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('App session-state integrity (T-2.8 W-2)', () => {
  it('(a) an in-flight triage completing after an account switch does not paint into the new session', async () => {
    const gate = deferred<StructuredResult>();
    h.structuredImpl = () => gate.promise;
    await signInAs(USER_A);
    click(buttonByText('Run triage'));
    await flush();
    expect(pageText()).toContain('Running triage…');

    await switchAccount(USER_A, USER_B);
    await act(async () => {
      gate.resolve({ text: TRIAGE_JSON, inferenceSource: 'in_cloud' });
    });
    await flush(8);

    // B's session shows its own untouched ticket: no route chip, no
    // awaiting-sync card, no triage fields from A's run.
    expect(container.querySelector('.route-chip')).toBeNull();
    expect(pageText()).not.toContain('awaiting sync');
    expect(pageText()).toContain('No triage result yet for this ticket.');
  });

  it('(a) an in-flight draft completing after an account switch does not paint its text into the new session', async () => {
    const gate = deferred<TextResult>();
    h.textImpl = () => gate.promise;
    await signInAs(USER_A);
    click(buttonByText('Draft reply'));
    await flush();
    expect(pageText()).toContain('Drafting…');

    await switchAccount(USER_A, USER_B);
    await act(async () => {
      gate.resolve({ text: 'A-ONLY DRAFT MARKER', inferenceSource: 'in_cloud' });
    });
    await flush(8);

    expect(pageText()).not.toContain('A-ONLY DRAFT MARKER');
    expect(pageText()).toContain('No draft yet.');
  });

  it('(b) a Privacy Mode refusal is displayed immediately, even when its route-event write never settles', async () => {
    // Offline Firestore behaviour: the write stays pending indefinitely.
    h.writerSink = () => new Promise<void>(() => {});
    await signInAs(USER_A);
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) throw new Error('Privacy Mode toggle not found');
    click(toggle);
    await flush();

    click(buttonByText('Run triage'));
    // The refusal card must appear promptly — not after the 10 s bounded
    // record used for the refusal's route event.
    await waitFor(() => pageText().includes('Refused — Privacy Mode'), 'refusal card', 2500);
    expect(pageText()).toContain('no device route to run on');
  });

  it('(c) Write manually cannot start while an AI draft is in flight for the same ticket', async () => {
    const gate = deferred<TextResult>();
    h.textImpl = () => gate.promise;
    await signInAs(USER_A);
    click(buttonByText('Draft reply'));
    await flush();
    expect(pageText()).toContain('Drafting…');

    forceClick(buttonByText('Write manually'));
    await flush();
    expect(pageText()).not.toContain('Written manually');

    await act(async () => {
      gate.resolve({ text: 'The AI draft.', inferenceSource: 'in_cloud' });
    });
    await waitFor(() => pageText().includes('Send (simulated)'), 'draft ready after release');
    const textarea = container.querySelector<HTMLTextAreaElement>('.draft-result textarea');
    expect(textarea?.value).toBe('The AI draft.');
  });

  it('(c) Regenerate cannot start while a simulated send is in flight for the same ticket', async () => {
    h.textImpl = () =>
      Promise.resolve({ text: 'Ready draft.', inferenceSource: 'in_cloud' as const });
    await signInAs(USER_A);
    click(buttonByText('Draft reply'));
    await waitFor(() => pageText().includes('Send (simulated)'), 'draft ready');

    const saveGate = deferred<void>();
    h.saveDraftGate = saveGate.promise;
    click(buttonByText('Send (simulated)'));
    await flush();
    expect(pageText()).toContain('Sending (simulated)…');

    forceClick(buttonByText('Regenerate draft'));
    await flush();
    expect(h.textCalls).toBe(1);

    await act(async () => {
      saveGate.resolve();
    });
    h.saveDraftGate = null;
    await waitFor(() => pageText().includes('Sent (simulated)'), 'send completes');
  });

  it('(d) regenerating after a simulated send returns the ticket to a non-sent state and re-offers Send', async () => {
    h.textImpl = () =>
      Promise.resolve({ text: 'Fresh draft.', inferenceSource: 'in_cloud' as const });
    await signInAs(USER_A);
    click(buttonByText('Draft reply'));
    await waitFor(() => pageText().includes('Send (simulated)'), 'draft ready');
    click(buttonByText('Send (simulated)'));
    await waitFor(() => pageText().includes('status sent-simulated'), 'ticket sent');

    click(buttonByText('Regenerate draft'));
    await waitFor(
      () => !pageText().includes('status sent-simulated') && pageText().includes('Send (simulated)'),
      'ticket reverted and Send re-offered',
    );
    expect(pageText()).toContain('status inbox');
  });

  it('(d) Write manually after a simulated send returns the ticket to a non-sent state', async () => {
    h.textImpl = () =>
      Promise.resolve({ text: 'Fresh draft.', inferenceSource: 'in_cloud' as const });
    await signInAs(USER_A);
    click(buttonByText('Draft reply'));
    await waitFor(() => pageText().includes('Send (simulated)'), 'draft ready');
    click(buttonByText('Send (simulated)'));
    await waitFor(() => pageText().includes('status sent-simulated'), 'ticket sent');

    click(buttonByText('Write manually'));
    await waitFor(
      () => pageText().includes('Written manually') && !pageText().includes('status sent-simulated'),
      'manual draft replaces the sent record and reverts the ticket',
    );
    expect(pageText()).toContain('Send (simulated)');
  });
});

describe('App Slice 3 invariants (T-3.7 QA)', () => {
  it('(C-1) Privacy Mode refuses the evaluation before any model call', async () => {
    await signInAs(USER_A);
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) throw new Error('Privacy Mode toggle not found');
    click(toggle);
    await flush();

    click(buttonByText('Run evaluation over all 30 tickets'));
    await waitFor(
      () => pageText().includes('No model call was made and no run was recorded'),
      'evaluation refusal in the panel',
    );
    // The refusal is total: not one triage ran, and nothing was stored.
    expect(h.structuredCalls).toBe(0);
    expect(pageText()).toContain('No evaluation run yet in this account.');
  });

  it('(W-2) confirming the preview escalates with that payload and stores the escalation draft', async () => {
    h.structuredImpl = () =>
      Promise.resolve({
        text: JSON.stringify({
          category: 'delivery',
          urgency: 'high',
          sentiment: 'angry',
          confidence: 0.92,
          issueCount: 1,
          personalDataCount: 0,
        }),
        inferenceSource: 'in_cloud' as const,
      });
    h.textImpl = () =>
      Promise.resolve({ text: 'Escalation draft text.', inferenceSource: 'in_cloud' as const });
    await signInAs(USER_A);
    click(buttonByText('Run triage'));
    await waitFor(() => pageText().includes('Run triage again'), 'triage completed');
    click(buttonByText('Redact personal data'));
    await waitFor(() => pageText().includes('Redaction count:'), 'redaction shown');

    click(buttonByText('Confirm payload and escalate'));
    await waitFor(
      () => pageText().includes('Escalation reason: Negative sentiment'),
      'escalation result card',
    );
    expect(h.textCalls).toBe(1);
    // The stored draft is the escalation draft for the selected ticket.
    let stored: Draft[] = [];
    for (const repo of h.repos) {
      stored = [...stored, ...(await repo.listDrafts(USER_A.uid))];
    }
    const escalationDraft = stored.find((d) => d.escalationReason !== null);
    expect(escalationDraft).toMatchObject({
      text: 'Escalation draft text.',
      requestedMode: 'prefer_in_cloud',
      actualSource: 'in_cloud',
      escalationReason: 'Negative sentiment',
      state: 'draft',
    });
  });
});
