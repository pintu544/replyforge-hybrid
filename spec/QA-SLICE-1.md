# QA — Slice 1 Adversarial Report (T-1.9)

> Fresh-agent adversarial QA, 12 November 2026. Method: the real app on
> http://localhost:5173 driven in headless Chromium (140.0.7339.16) via
> Playwright against the live Firebase project `replyforge-hybrid`, exactly
> as a user would — no console or database workarounds for the attacks
> themselves. Firestore REST reads with a user's own ID token were used only
> to verify outcomes. Accounts: A = `slice1-qa@replyforge.test` (created by
> the earlier verification run), B = `slice1-qa-b@replyforge.test` (created
> by this QA through the app's own sign-up; credentials for both are in the
> gitignored `qa-test-account.txt`). Screenshots: `spec/evidence/qa-*.png`.
>
> **Result: 2 Critical findings — both fixed and re-tested closed. 4 Warning
> findings — all fixed. 5 Informational notes. Zero Criticals remain open,
> so T-1.9 is checked off.** Final gates: `npm test` 24/24 passed,
> `npm run typecheck` clean, `npm run lint` clean, `npm run build` succeeds.

## Critical

### C-1 — Status panel falsely claims "On-device model available" after Enable — FIXED

- **Reproduction:** on this VM (no Prompt API at all — `window.LanguageModel`
  is absent, per SPIKE-VERDICT.md), sign in and click **Enable on-device AI**
  in the hybrid status panel. The panel settles on a green dot and
  **"On-device model available — Gemini Nano can run on this machine. Short
  work will prefer the device."** with no error — while zero model requests
  were made and every triage continues to run in the cloud.
  Evidence: `spec/evidence/qa-07-availability-after-enable.png`.
- **Why critical:** a false capability/route claim in the one panel whose job
  is honest availability; it violates SPEC NFR-8 ("the system SHALL state the
  actual availability") and the spirit of FR-2/FR-9. A judge clicking that
  button on any non-Nano machine would be told the opposite of the truth.
- **Root cause:** `AvailabilityController.enable()` in
  `src/services/availability.ts` mapped a post-initialisation probe of
  `unavailable` to `available` (`state === 'unavailable' ? 'available' :
  state`). Firebase AI Logic's `initializeDeviceModel()` resolves without
  throwing on this browser, so the override fired.
- **Fix:** `enable()` now publishes the probed state verbatim; when the probe
  still reports `unavailable` it sets the visible error "The on-device model
  is still unavailable on this machine after initialisation." Regression test
  added to `availability.test.ts`.
- **Re-test:** same click now settles on "On-device model unavailable" with
  that error shown. Evidence: `spec/evidence/qa-16-availability-after-fix.png`.

### C-2 — Offline triage never settles: UI stuck on "Running triage…" — FIXED

- **Reproduction:** sign in, open RF-007, turn the browser offline, click
  **Run triage**. The inference fails fast (a failed route event with
  latencyMs 544, `online: false` was recorded server-side after reconnect),
  but the UI showed "Running triage…" for the full 150 s observation window
  with no failed state and no Retry. Evidence:
  `spec/evidence/qa-09-offline-triage.png`.
- **Why critical:** violates SPEC NFR-7 — "no task SHALL remain in an
  unexplained loading state after its result or error is known". The same
  await sits on the success path, so on a Nano-capable machine an offline
  on-device success (the FR-11 scenario) could not be displayed either.
- **Root cause:** `runTriage` (`src/services/triage.ts`) awaited
  `writer.record(...)`; a Firestore `setDoc` promise stays pending while
  offline (the SDK queues the write for reconnect), so the function never
  returned.
- **Fix:** both record calls go through `recordBounded` — the write is
  awaited up to a bound (default 10 s, injectable for tests). A write that
  settles within the bound keeps the old strictness (a fast rejection still
  propagates); a write that outlives the bound is left to finish in the
  background — never cancelled, and proven to still land (below). Regression
  tests added to `triage.test.ts` for both the success and failure paths
  with a never-settling writer.
- **Re-test:** offline triage on RF-011 settled into the visible failed state
  in ~10.9 s; after reconnect, the failed route event was present with
  `latencyMs: 418`, `online: false`, matching the card's "Attempt took
  418 ms" exactly. Evidence: `spec/evidence/qa-17-offline-triage-after-fix.png`.

## Warning

### W-1 — Triage state bleeds across accounts on the same page — FIXED

- **Reproduction:** as account A, fail a triage on RF-009. Sign out and sign
  in as account B **without reloading the page**. B's RF-009 — never triaged
  by B, status `inbox` — displays A's failure card, including A's error text,
  A's latency, and the claim "Attempt took 36 ms and was recorded" (nothing
  was recorded for B). Evidence: `spec/evidence/qa-13-b-sees-rf009.png`.
- **Note:** this was session UI state only — the underlying data isolation
  held perfectly (see Passes §2). It is a misleading cross-account display,
  not a data leak.
- **Fix:** the sign-out effect in `src/App.tsx` now also clears
  `triageStates`, `inboxMessage`, and `inboxError` alongside tickets and
  selection.
- **Re-test:** after the same account switch, B's RF-011 shows
  "No triage result yet". Evidence: `spec/evidence/qa-18-b-rf011-after-fix.png`.

### W-2 — No in-flight guard behind the triage button's disabled state — FIXED

- **Reproduction:** on RF-012, start triage, then re-activate the button
  programmatically (clearing `disabled` and clicking, as a stuck assistive
  tool or a state-lag double-fire could). Result: **2 route events** for one
  user action — `handleRunTriage` had no guard of its own; the `disabled`
  attribute was the only protection. (Ordinary mouse double-clicks were
  correctly absorbed by `disabled` and produced one event in the first
  barrage; the forced-activation barrage produced two.)
- **Fix:** `src/App.tsx` keeps an in-flight ticket-ID set (ref) around
  `handleRunTriage`; re-entry for a ticket already running returns
  immediately.
- **Re-test:** the identical forced-click barrage on RF-014 produced
  exactly **1** new route event.

### W-3 — Whitespace-only pasted ticket is saved with empty subject and body — FIXED

- **Reproduction:** in the Add-a-ticket form, enter spaces/tabs/newlines
  only and submit. Native `required` passes (whitespace is a value), the
  handler trims, and a ticket with `subject: ""`, `body: ""` was saved to
  Firestore (document `manual-3ab250fb-…`, still in account A's inbox as
  evidence). Evidence: `spec/evidence/qa-03-whitespace-ticket.png`.
- **Fix:** `handleAddManual` in `src/App.tsx` rejects blank-after-trim
  subject or message with "Subject and message must not be blank.", which
  the form displays via its existing error path.
- **Re-test:** the same submission now shows that error and the manual
  ticket count is unchanged (10 before, 10 after).

### W-4 — Manual tickets blow out the side column; panels overlap — FIXED

- **Reproduction:** sign in with any manual ticket present (manual IDs are
  `manual-<uuid>`). Measured geometry at 1280 px viewport: side panels were
  **555 px wide inside a 380 px column**, sliding under the workspace panel
  (428 px), which painted over them — the status panel's Browser and
  Route-proof values were partially hidden. Evidence:
  `spec/evidence/qa-15-layout-viewport.png`.
- **Root cause:** the unbreakable `manual-<uuid>` token in
  `.ticket-row-meta` set a min-content wider than the column; the implicit
  grid track in `.column` grew to fit it. Fixture-only inboxes (short
  `RF-0xx` IDs) never trigger it, which is why earlier screenshots looked
  correct.
- **Fix (CSS only, `src/styles.css`):** cap the column track with
  `grid-template-columns: minmax(0, 1fr)` and let the ID span truncate with
  an ellipsis.
- **Re-test:** all side panels measure exactly 380 px (28→408), workspace
  starts at 428 — zero overlap. Evidence:
  `spec/evidence/qa-19-layout-after-fix.png`.

## Informational

- **I-1 — Inbox reads "0 of 0" while the first load is in flight.** There is
  no explicit loading label; the count settles to the real total within
  seconds. Could be misread as an empty inbox on a slow connection.
- **I-2 — Failed-triage cards show the raw Firebase error string**, including
  the internal endpoint URL. Honest and debuggable, but verbose for a judge;
  a friendlier error mapping is a Slice 4 polish candidate.
- **I-3 — The status panel's "Network" fact is a render-time snapshot** of
  `navigator.onLine` with no online/offline listener, so it can be stale
  between renders. Route events themselves record `online` accurately at
  task time (verified `online: false` on the offline attempts).
- **I-4 — The "Enable on-device AI" button is offered while the state is
  `unavailable`.** After the C-1 fix the click is harmless and truthful, but
  hiding it in that state is a design choice left for the Slice 4 pass.
- **I-5 — Test-method note (no finding):** a full page reload under
  Playwright's offline mode renders a blank page because that mode also
  blocks localhost; the screenshot `qa-14-offline-reload.png` is a harness
  artefact, **not** app behaviour, and no finding is recorded from it. The
  meaningful offline behaviours are covered under C-2 and Passes §6.

## Passes — what was attacked and held

1. **Sign-in boundaries.** Wrong password and unregistered email both end at
   `auth/invalid-credential` with the form error visible and the session
   still signed out; malformed email and empty fields are stopped by native
   validation; a 3-character password is rejected on register
   (`auth/weak-password`); registering A's email again is rejected
   (`auth/email-already-in-use`); the session persists across reload;
   sign-out removes all ticket data from the DOM, and neither the Back
   button nor a reload resurrects it.
2. **Cross-user isolation (data).** Account B — created fresh during this
   QA — received its own 30 fixture tickets and never saw A's manual marker
   ticket in the list or via search; B's RF-001 row shows no trace of A's
   earlier triage (no route chip). REST verification with each user's own
   token: B→A tickets 403, B→A routeEvents 403, A→B tickets 403, A→B
   routeEvents 403, unauthenticated 403, self-read 200.
3. **Repeated fixture loads.** Four reloads and two sign-out/sign-in cycles
   for A, plus B's two-tab first load: REST counts stayed at exactly 30
   fixture documents per user with unique IDs RF-001…RF-030 (NFR-6).
4. **Malformed pasted tickets.** Truly-empty submit is blocked natively.
   `<script>`/`<img onerror>`/`<svg onload>` content renders as inert text —
   no dialog, no injected nodes, no execution. A 28.5 k-character body saves
   and renders with no horizontal overflow. A body containing a fake route
   event JSON renders literally and, when triaged, the card and the
   persisted ticket both show the **real** route (`in_cloud`, 12,406 ms) —
   ticket content cannot fake route evidence. Hindi and Bengali tickets
   save and render; the Hindi ticket triaged successfully. RTL/Arabic +
   emoji render correctly. The subject field caps at its 200 characters.
5. **Availability honesty (pre-gesture).** On load the panel states
   "On-device model unavailable"; network observation recorded **zero**
   requests to model endpoints before the Enable gesture (no model work is
   initialised on load).
6. **Failed inference.** Offline attempts end in the visible failed state
   with a working Retry (post-C-2); RF-007's retry then succeeded. Failure
   route events are written with `actualSource: null`, `outcome: failed`,
   and the true `online` flag.
7. **Route-chip truthfulness — 5/5 spot-checks exact.** RF-007 retry
   (1,269 ms), RF-002 (14,715 ms), the PII-vault manual ticket (4,484 ms),
   the fake-event JSON ticket (12,406 ms), and the post-fix offline failure
   (418 ms): in every case the card's route and latency equal the Firestore
   route event's `actualSource` and `latencyMs`. No success was ever
   displayed without a route.
8. **Gold-label hygiene.** The Evaluation labels disclosure is closed by
   default; searching for `refund-legal-intent`, `Expected route`, or
   `Labelled personal data` returns "No tickets match that search." — label
   text is not searchable ticket content.
9. **Route-event text leakage, adversarial.** A manual ticket stuffed with
   a name, email, phone (+91 98111 24680 and digit variants), postal
   address, PIN, order ID, and payment reference was triaged (the card
   counted **7** personal-data items); a scan of every string value in all
   of account A's route events for all 10 needles found **zero hits**
   (NFR-3).
10. **Careless-user handling.** Navigating to another ticket mid-triage
    completes and shows the result on return; reloading mid-triage never
    leaves a stuck state (the completed result is persisted, or triage can
    simply be run again); double-submitting the Add-a-ticket form via
    repeated Enter created exactly one ticket.

## Artefacts left behind by QA (test accounts only — not Pintu's data)

- Account B (`slice1-qa-b@replyforge.test`) with its own 30 fixture tickets.
- Account A gained 10 manual QA tickets (marker, the pre-fix empty
  whitespace ticket from W-3, script-content, long-body, fake-event JSON,
  Hindi, Bengali, RTL/emoji, PII-vault, double-submit) and route events from
  ~15 triage attempts across both accounts' sessions. Nothing was deleted;
  the empty ticket is retained as W-3 evidence.

## Left for Pintu's T-1.10 gate

- No Critical or Warning remains open. Informational items I-1… I-4 are
  polish candidates for Slice 4 (T-4.1 designed states), not Slice 1
  blockers; none was fixed, by design, to keep this fix batch minimal.
- One design question the fixes deliberately did **not** touch: when a
  route-event write cannot settle within the bound (C-2), the UI now
  proceeds and the event lands when the network returns. If Pintu prefers
  the stricter "no displayed success before its event is durable" rule for
  the success path specifically, that is a one-line change to
  `recordBounded` usage in `src/services/triage.ts` — flagged here rather
  than decided unilaterally, because it trades against NFR-7/FR-11 offline
  behaviour.

## T-1.10 gate decision — strict success-path rule (12 November 2026)

At the T-1.10 confirmation gate, Pintu confirmed Slice 1 (chat, 12 November
2026, ~22:30 IST) and decided the open design question above in favour of
the STRICT rule: **a success is displayed only after its route event is
durably saved.** The bounded-proceed alternative from the C-2 fix (show the
result after a 10-second bound and let the event land on reconnect) is
rejected for the success path — the displayed record and the stored proof
must never diverge.

- The change is applied to the success path only: `runTriage` in
  `src/services/triage.ts` now awaits `deps.writer.record(...)` in full; if
  that write rejects, the run is surfaced as failed rather than shown as a
  success without proof. The failure path is unchanged — it still records
  through `recordBounded`, so a failed run can never hang the UI.
- Recorded implication: while fully offline, the strict await can pend
  until reconnect, so a fully-offline on-device success (Slice 2's FR-11
  path) cannot display until the connection returns. Slice 2's design must
  handle that case explicitly rather than discovering it in testing; the
  code carries a comment pointing here.
- Verification: `npm test` 26/26 (including 2 new regression tests for the
  strict rule), typecheck clean, lint clean, production build succeeds.
  Live re-test against the running app (QA account A, ticket RF-020, chosen
  because it had never been triaged): the success card rendered only after
  the write — route chip "In cloud · 8280 ms" — and the Firestore route
  event for that run (document `b102e9c4-33ba-4c5f-aa49-9228cda04916`,
  created 2026-11-12T17:14:15.761Z, before the card appeared) carries the
  identical `actualSource: in_cloud` and `latencyMs: 8280`, outcome
  `fallback` for the device-preferred request.
