# RUNBOOK — Joint on-device session (T-3.8 gate + Slice 4 on-device proof)

> One sitting on Pintu's Ubuntu VM, about 20–25 minutes. It combines
> three things: the **T-3.8 Slice 3 confirmation gate**, the
> **on-device proof** Slice 4 needs, and the **capture of the real
> figures** that replace the [REFRESH] placeholders in
> `submission/IMPACT.md` and the README. Pintu drives; Muse talks
> through the steps. Nothing in Parts A–C changes any configuration.

## Before the session (Muse prep — not Pintu's time)

These steps need a browser session and the Firebase CLI; they are
**not** done yet. State as of 13 November 2026: `firebase-tools` is
not installed on the build VM and no Firebase CLI login exists, so
the deploy has not been attempted. Local readiness is done:
`firebase.json` carries the Hosting config (public `dist`, SPA
rewrite `**` → `/index.html`), `.firebaserc` selects project
`replyforge-hybrid`, and `npm run build` produces the bundle
(114/114 tests green).

**Deploy sequence (run once, in a session where installs and logins
are allowed):**

```sh
npm install -g firebase-tools        # or prefix each command with: npx firebase-tools@latest
firebase login                       # browser sign-in with the Google account that owns the project
cd ~/workspace/replyforge-hybrid
npm run build
firebase deploy --only hosting
```

Then open `https://replyforge-hybrid.web.app` (fallback:
`https://replyforge-hybrid.firebaseapp.com`) and confirm it loads
over HTTPS.

**Hosting smoke test — do this before inviting Pintu.** Sign in on
the hosted build and run one triage. Known risk: AI Logic App Check
enforcement is "Basic — Enforced" in the console, and the production
build does not yet initialise App Check (the debug-token path in
`src/lib/firebase.ts` is dev-only). If the triage fails with an App
Check error, stop: the fix is a named Slice 4 step (register
reCAPTCHA v3 for the web app under Console → App Check, then
initialise App Check in production), not something to improvise
during the joint session.

**Remote Config publish (same browser session, ~3 minutes):**

1. Firebase Console → project `replyforge-hybrid` → **Build →
   Remote Config**. On first use, choose **Create configuration**.
2. Import the template: the Remote Config page's overflow (⋮) menu
   offers template download/upload — upload
   `remoteconfig.template.json` from the repository root.
3. Check the eight parameters match the template
   (`escalation_length_chars` 400, `escalation_confidence_min` 0.6,
   `escalation_keywords_version` v1, `device_model_name`,
   `cloud_model_name`, and the triage, draft, and escalation
   prompts), then **Publish changes**.
4. Reload the hosted app and spot-check one simple ticket (RF-001)
   and one escalation (RF-021): behaviour must be identical, because
   the published values equal the in-code defaults (a test asserts
   template and code agree).

**Record the real machine description (same prep session):** in
`src/App.tsx`, replace the `DEVICE_DESCRIPTION` constant (currently
the generic "The operator's machine, in this browser session") with
exactly:

> Ubuntu 24.04.4 LTS VM · Google Chrome 155.0.8059.39 · 23 GiB RAM ·
> Intel Xeon @ 2.50 GHz (4 cores / 8 threads) · no GPU (CPU/RAM path
> for Gemini Nano)

Then `npm run build` and re-deploy **before** the joint session, so
the evaluation run made in Part B stores this description in its
`EvaluationRun` document and the scorecard panel displays it.
(QA-SLICE-3, Informational 5: run provenance is otherwise a generic
constant.)

**Have ready:** the QA account A sign-in (credentials in
`qa-test-account.txt` on the build VM) for Part A, and Pintu's own
Google sign-in for Part B.

## Pre-flight (2 minutes, Pintu's machine)

1. Open Chrome 155 in the **isolated Nano profile** used for the
   12 November setup (Prompt API flag on; main profile untouched).
2. Open the hosted app URL, then DevTools → Console, and run:
   `await LanguageModel.availability()`
   - **`"available"`** — proceed.
   - **`"downloadable"`** — the model is not downloaded yet. In the
     app, click **Enable on-device AI** in the hybrid status panel
     (initialisation needs that user gesture), keep the tab open on
     an unmetered connection, and wait for the panel to report the
     model ready; progress is also visible at
     `chrome://on-device-internals`. The download is several
     gigabytes — if it has only just started, do Part A first and
     re-check before Part B.
   - **`"downloading"`** — wait until it flips to `"available"`
     (same internals page); do Part A meanwhile.
   - **`"unavailable"`** — check
     `chrome://flags/#prompt-api-for-gemini-nano` is still set to
     Enabled and relaunch Chrome. If it stays unavailable, the
     machine cannot prove the device route today: run Part A only
     (cloud fallback is a designed path) and reschedule Part B.

## Part A — T-3.8 gate review (about 6 minutes; QA account A)

Sign in with **QA account A** — its history (previous evaluation
runs, 133 route events) is what the gate reviews.

1. **Inbox:** confirm it shows **30 of 30** fixture tickets.
2. **One simple route:** open **RF-001** → **Run triage**. Check the
   result card: category, urgency, sentiment, confidence, issue
   count — and the route chip, which on this machine should read
   **On device** with a latency. (On any machine the chip shows the
   route that actually ran.) Click **Draft reply** and skim the
   draft.
3. **One escalation with its preview:** open **RF-021** → **Run
   triage** → read the **What the cloud sees** panel: redacted
   summary only, redaction count **5**, gate chip **Held for
   review**. Confirm no name, e-mail, phone number, order ID, or
   address appears anywhere in the payload. Click **I reviewed the
   payload — confirm and escalate** (that click *is* the review) and
   check the result card: escalation reason **Long or complex
   ticket**, route chip **In cloud**, latency shown.
   *Screenshot this preview for the submission gallery.*
4. **Evaluation result:** open the **Evaluation** panel and read the
   latest run against the previous one. The figure to confirm is
   the **measured band: 27–28 of 30 (90–93%) across three live
   runs** — the submission presents the band, never the best run
   (QA-SLICE-3 gate flag). Disagreements RF-015/RF-017 (and RF-022
   in one run) are listed with reasons: live-model variance, not
   engine errors.
5. **Scorecard:** open **Scorecard — measured, not claimed** and
   skim the figures (all computed from stored events; on-device
   rows still show their honest no-data state until Part B).
6. **Gate decision (30 seconds):** Pintu confirms Slice 3, or names
   corrections. Two judgement calls ride on this gate:
   - a Privacy-Mode-refused evaluation records **no** route events
     (the panel explanation is the record) — confirm, or ask for
     blocked events instead (QA-SLICE-3, C-1 note);
   - accuracy is presented as the **27–28 band** — confirm.

## Part B — On-device proof (about 8 minutes; Pintu's own sign-in)

Sign out and sign in with **Pintu's Google account** — a clean
per-user partition, so the scorecard after this part reflects this
session only. The fixture loads automatically (30 of 30).

1. **Status panel:** confirm it reports the on-device model
   available (click **Enable on-device AI** first if it offers it —
   initialisation needs a user gesture).
2. **On-device triage × 4:** for **RF-001, RF-002, RF-003, RF-004**:
   open the ticket → **Run triage** → the route chip must read
   **On device**, with a latency. On **RF-003**, also open the
   redaction comparison: one e-mail address masked, count **1**.
   *Screenshot one triage card with its On device chip.*
3. **Privacy Mode:** turn **Privacy Mode** on.
   - Open a fresh simple ticket (e.g. RF-005) → **Run triage** →
     succeeds **On device** (device-only handle).
   - Open **RF-021** → **Run triage** → in the Escalation block,
     attempt to escalate → the card reads **Refused — Privacy
     Mode** and the refusal is recorded (an escalation is cloud by
     definition, so Privacy Mode refuses it).
   - Turn **Privacy Mode off** again.
4. **Offline ticket:** turn **Wi-Fi off**. Open a fresh simple
   ticket (e.g. RF-006) → **Run triage** → the amber card reads
   **Completed locally — awaiting sync** (finished work visible, no
   route chip, no route claimed). Click **Draft reply** — same
   awaiting-sync state. *Screenshot the amber card.* Turn **Wi-Fi
   back on** and wait a few seconds: both cards promote to proven
   successes with **On device** chips. That is one offline success
   for the scorecard.

## Part C — Evaluation run and figure capture (about 5 minutes)

1. **Run the evaluation:** Evaluation panel → **Run evaluation over
   all 30 tickets**. It paces itself against the free-tier quota and
   takes roughly 3–6 minutes; triages should report on-device for
   the device-labelled tickets. Note the headline: correct routes
   out of 30, the on-device / in-cloud / failed split, labelled
   redactions, surviving patterns (**0** expected).
2. **Read the scorecard:** **Scorecard — measured, not claimed** now
   shows, for this session's account: **Fully handled on-device**
   (share of completed tasks), **Median latency — on-device** (with
   its n), **Offline successes** (1 of 1 from Part B step 4),
   cloud calls avoided, and the device description — which must read
   as the real machine string from the prep step. If it still shows
   the generic constant, the prep edit did not reach this build;
   say so and do not publish figures from this run.
   *Screenshot the scorecard panel.*
3. **Write the figures down** (Muse does this straight after the
   session): replace the three **[REFRESH]** bullets in
   `submission/IMPACT.md` and the [REFRESH] line in the README
   scorecard section with the measured on-device share, median
   on-device latency, and offline successes — each with its sample
   size, the machine description above, and Chrome 155.0.8059.39.
   The stored `EvaluationRun` on Pintu's account is the durable
   record; the panel is a view of it.

## If something misbehaves

| Symptom | First move |
| --- | --- |
| Availability stuck on `downloadable`/`downloading` | Stay on an unmetered connection with the tab open; watch `chrome://on-device-internals`; do Part A meanwhile |
| Route chip reads **In cloud** on a Part B triage | That is the designed fallback, shown honestly — check the status panel's availability state before assuming a fault; record what the chip said, never re-run to shop for a better figure |
| Evaluation refuses under Privacy Mode | Privacy Mode was left on — turn it off and re-run (the refusal is QA-SLICE-3 C-1 working as designed) |
| Hosted page fails to load or triage errors immediately | Stop and report; check the prep smoke test result — do not debug App Check or console settings inside Pintu's session |
