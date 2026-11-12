# TASKS — ReplyForge Hybrid

> Ordered checklist. One task is no more than half a day of work. A task is checked off only when its “done means” evidence exists. Slices run in order: a slice is not started until the previous slice has passed adversarial QA and Pintu’s confirmation gate.
>
> **Hard deadline:** 30 November 2026 at 2:00 PM PT (1 December 2026 at 3:30 AM IST). **Submission target:** 29 November 2026, keeping the final day as buffer.

## Gate 0 — Approval

- [x] **T-0.1 — Pintu approves the spec pack** ✅ Approved by Pintu in chat, 12 Nov 2026 ~21:06 IST.
      Done means: SPEC.md, DESIGN.md, and TASKS.md are explicitly approved, or every requested change has been made in the spec first and the revised pack re-presented. No implementation code exists before this gate.
      Unblocks: all slices.

## Slice 1 — Hybrid proof, fixture inbox, and day-one instrumentation

*End-to-end outcome: a signed-in operator opens a seeded ticket, runs device-preferred triage, and sees the actual route and latency, with a text-free route event already recorded.*

- [x] **T-1.1 — Throwaway hybrid SDK spike (prototype the question, not the feature)**
      Done means: on the real development machine, a disposable spike records the Chrome version, the model availability state, one structured-output result, and an observed `inferenceSource`; the spike is then deleted and a short verdict is filed under `spec/` notes. If the device route cannot be observed, the exact blocker and cloud-fallback evidence are recorded instead of assumed.
      Unblocks: T-1.5, T-1.7.
- [x] **T-1.2 — Scaffold the web app and Firebase boundary**
      Done means: the React + TypeScript + Vite app runs locally on a checked, free port; Firebase AI Logic (SDK v12.5.0+), Authentication, Firestore, and App Check are initialised from environment configuration; a signed-in and a signed-out state are both visible; no secret or debug token is committed.
      Unblocks: T-1.5, T-1.6.
- [x] **T-1.3 — Create the 30-ticket fixture with its documented contract**
      Done means: `fixtures/tickets.json` (fixture version 1) contains exactly 30 records with stable IDs `RF-001` to `RF-030`; the fixed reference time is **2026-11-12T10:00:00+05:30**, and every `receivedAt` is an offset from it; each record carries subject, synthetic body, category, urgency, sentiment, issue count, language, `expectedRoute` (`device` or `cloud`), escalation trigger where applicable, and labelled personal-data types and counts. The set contains 18 device-labelled and 12 cloud-labelled tickets, at least eight with synthetic personal data, and coverage of angry, refund/legal, long multi-issue, ambiguous, and unsupported-language cases. All personal data in the fixture is synthetic.
      Unblocks: T-1.6, T-3.4.
- [x] **T-1.4 — Implement the fixture loader and refresh semantics**
      Done means: loading the fixture creates exactly 30 fixture tickets for the signed-in user; loading or refreshing it again creates zero duplicates, preserves gold labels, and changes zero operator-created (`manual`) tickets, as shown by an automated fixture test.
      Unblocks: T-1.6.
- [x] **T-1.5 — Define and write route events from day one**
      Done means: a typed route-event writer is the only metrics path; an automated test proves that an event contains task type, requested mode, actual route or explicit failure, latency, outcome, escalation trigger, redaction count, online state, and browser/Chrome version, and contains no ticket or prompt text.
      Unblocks: T-1.7, T-3.5.
- [x] **T-1.6 — Build the availability controller and hybrid status panel**
      Done means: the panel displays one of available, downloadable, downloading, or unavailable; the enable control only initialises the device model after a user gesture; download progress and failure are visible; ordinary navigation and ticket work are not blocked by any availability state.
      Unblocks: T-1.7, T-2.6.
- [x] **T-1.7 — Build the inbox and ticket workspace** ✅ Live-verified 12 Nov 2026: QA account signed in against the live project, fixture inbox shows "30 of 30" with no duplicates on reload, tickets open in the workspace (spec/LIVE-VERIFICATION.md; spec/evidence/).
      Done means: the operator can browse and search the 30 fixture tickets, open one ticket with its gold labels hidden from the normal workflow, and add a manual ticket by pasting a subject and message; manual and fixture tickets are visibly distinguished.
      Unblocks: T-1.8.
- [x] **T-1.8 — Run device-preferred structured triage** ✅ Live-verified 12 Nov 2026: RF-001 triage (cloud model gemini-3.5-flash-lite) rendered the full result card with route chip "In cloud · 5752 ms" (actual route `in_cloud` from the inference result); matching Firestore route event has outcome `fallback` and zero ticket text; the failed-state-with-retry path was also proven live (spec/LIVE-VERIFICATION.md; spec/evidence/09-triage-RF-001-success.png).
      Done means: selecting “Run triage” produces category, urgency, sentiment, confidence, issue count, and personal-data count; the result card shows latency and the actual route from the inference result; a matching route event exists in Firestore; a forced error ends in a visible failed state with retry.
      Unblocks: Slice 2.
- [x] **T-1.9 — Adversarial QA for Slice 1** ✅ Completed 12 Nov 2026: fresh-agent adversarial QA (spec/QA-SLICE-1.md; evidence spec/evidence/qa-*.png) found 2 criticals — status panel falsely claiming "On-device model available" after Enable, and offline triage never settling because the route-event write pends offline — plus 4 warnings (cross-account triage-state bleed, no in-flight triage guard, whitespace-only tickets saved empty, side-column layout blowout from manual-ticket IDs); all fixed, re-tested live, and covered by regression tests (24/24). Route-chip truthfulness spot-checked 5/5 exact against Firestore events; PII leakage scan zero hits; cross-user REST isolation 403 in both directions.
      Done means: a fresh QA agent, testing as a real user with no console or database workarounds, reports critical, warning, and informational findings covering sign-in boundaries, repeated fixture loads, malformed pasted tickets, every availability state it can reach, failed inference, and route-chip truthfulness. Every critical is fixed (spec first if the fix changes design) and re-tested.
      Unblocks: T-1.10.
- [x] **T-1.10 — Pintu confirmation gate for Slice 1** ✅ Confirmed by Pintu in chat, 12 Nov 2026 ~22:30 IST; he chose the STRICT success-path rule (a success displays only after its route event is durably saved) over the bounded-proceed alternative — applied to the success path in src/services/triage.ts, failure path unchanged; 26/26 tests including 2 new regression tests, typecheck/lint/build clean; live re-test passed (RF-020: chip "In cloud · 8280 ms", Firestore route event b102e9c4 with identical route + latency, created before the card appeared). Decision and its Slice 2 offline implication recorded in spec/QA-SLICE-1.md.
      Done means: Pintu is given click-by-click review steps for the live local flow and confirms the slice, or his corrections are recorded and completed before Slice 2 starts.
      Unblocks: Slice 2.

## Slice 2 — Privacy boundary, simple drafts, and simulated send

*End-to-end outcome: personal data is redacted on-device, a simple reply is drafted and edited, Privacy Mode refuses cloud fallback, and the exact cloud payload can be inspected before any escalation exists.*

- [x] **T-2.1 — Implement deterministic personal-data pattern checks**
      Done means: automated tests cover labelled e-mail, telephone, order-identifier, payment-reference, and postal-address patterns from the fixture, including values split by spaces or punctuation; each check returns a type, masked value, and count without duplicating the raw value into a log.
      Evidence (12 Nov 2026): src/services/redaction.ts + redaction.test.ts — 8 tests; per-type counts match the fixture labels for all 30 tickets in both directions (nothing missed, nothing invented); split/punctuation variants covered (phone dashes/dots/no-space, "ORD 78451", comma-less postal address); masked values asserted to never contain the raw value.
      Unblocks: T-2.2, T-2.3.
- [x] **T-2.2 — Produce the redacted artefact on-device**
      Done means: running a fixture ticket produces a redacted subject, body, and summary in which every labelled entity is masked; the original and redacted versions can be compared in the workspace; the redaction count matches the fixture label.
      Evidence (12 Nov 2026): produceRedactedArtefact returns branded redacted subject/body/summary; workspace shows the original-vs-redacted comparison with the entity table; automated test asserts the redaction count equals the label total for all 30 fixture tickets and no labelled raw value survives; live pass recorded in LIVE-VERIFICATION.md.
      Unblocks: T-2.3, T-2.5.
- [x] **T-2.3 — Build the cloud-payload safety gate**
      Done means: the payload builder accepts only the redacted artefact and metadata; the pre-send pattern check blocks a payload containing a labelled surviving pattern in an automated negative test; the operator sees whether the payload was blocked, minimised, or held for review.
      Evidence (12 Nov 2026): payload.ts brand-checks the artefact at runtime and by type (a raw ticket is refused — tested); the negative test reintroduces a labelled e-mail into a tampered artefact and the gate reports blocked with the surviving type; held-for-review fires when triage's model count exceeds the redaction count; the workspace shows the gate chip (Blocked / Minimised / Held for review).
      Unblocks: T-2.4, T-3.3.
- [x] **T-2.4 — Build the “What the cloud sees” preview**
      Done means: for any triaged ticket, the preview displays the complete proposed escalation payload — redacted summary, category, urgency, sentiment, trigger, issue count, character count, and redaction count — and an automated comparison proves the previewed payload and the payload object used by the escalation path are identical.
      Evidence (12 Nov 2026): prepareEscalation is the single path behind the preview; a test proves the previewed payload deep-equals and serialises identically to the payload built by the escalation-side builder call with the same artefact and metadata; the workspace displays summary, category, urgency, sentiment, trigger, issue count, body character count and redaction count.
      Unblocks: Slice 3.
- [x] **T-2.5 — Draft and edit a simple reply**
      Done means: a device-labelled ticket produces a single-turn draft through the device-preferred handle; the card shows actual route and latency; the operator can edit the text; an empty, failed, or incoherent result can be regenerated or written manually without losing the ticket state.
      Evidence (12 Nov 2026): drafts.ts runDraft builds its prompt from the redacted artefact only (test asserts no raw personal data in the prompt); tests cover route+latency display data, cloud drafts labelled fallback, empty-result failure, strict-rule pending/rejection behaviour and manual drafts carrying no route; the workspace offers edit, Regenerate and Write-manually without losing ticket state.
      Unblocks: T-2.7.
- [x] **T-2.6 — Implement Privacy Mode**
      Done means: with Privacy Mode on, triage, redaction, and drafting use the device-only handle; with the device route made unavailable in testing, the app makes zero cloud calls, records the refusal, and displays the reason and the non-private alternative. With Privacy Mode off, normal fallback resumes.
      Evidence (12 Nov 2026): taskRouting.ts refuses before any handle is invoked when Privacy Mode is on and the device route is not available — CountingAdapter tests prove zero structured/text/initialise calls on both handles; the refusal is recorded as a blocked route event with the reason and the non-private alternative displayed; device-only success and cloud-result-discard are tested; normal fallback resumes with Privacy Mode off (tested).
      Unblocks: T-2.8.
- [x] **T-2.7 — Add simulated send and offline queue states**
      Done means: an edited draft can be marked “Send (simulated)” and the ticket becomes sent-simulated with no external request to a mail or messaging service; with the network disabled and a device route available, triage and a simple draft complete and the send remains visibly queued; with no route available, the ticket is preserved as queued or failed with a next action.
      Evidence (12 Nov 2026): sendSimulated performs only the two Firestore-partition writes (draft + ticket) — no external request exists in the path; tests cover sent, queued (save never settles offline → visibly queued, ticket preserved) and failed (next action shown); the workspace shows sent/queued/failed states and reloads on reconnect.
      Unblocks: T-2.8.
- [x] **T-2.8 — Adversarial QA for Slice 2**
      Done means: a fresh QA agent reports critical, warning, and informational findings after attacking the privacy boundary with fixture and hand-written edge cases: unusual personal-data formats, a deliberately surviving pattern, Privacy Mode with no device route, offline use, repeated sends, and attempts to reach a cloud payload without a redacted artefact. Every critical is fixed and re-tested.
      Evidence (13 Nov 2026): spec/QA-SLICE-2.md — 1 Critical (UI copy over-claim) + 2 Warnings (detector separator gaps; 4 app state-integrity defects) all fixed (6f8b24f, 2a8abdd, 53ab966) and re-tested; 72/72 tests; live re-verification of all three fixes passed (LIVE-VERIFICATION.md).
      Unblocks: T-2.9.
- [x] **T-2.9 — Pintu confirmation gate for Slice 2**
      Done means: Pintu reviews the redaction comparison, payload preview, Privacy Mode refusal, and simulated send using supplied steps and confirms the slice, or corrections are completed first.
      Confirmed by Pintu 13 Nov 2026 (awaiting-sync state, distinct-value counting, held-for-review rule accepted as built); QA (T-2.8) ran after confirmation at his direction.
      Unblocks: Slice 3.

## Slice 3 — Cloud escalation, evaluation, and the scorecard

*End-to-end outcome: hard tickets escalate for labelled reasons using the redacted payload only, and the 30-ticket evaluation produces the measured scorecard used in the video and write-up.*

- [x] **T-3.1 — Move routing thresholds and prompts to Remote Config**
      Done means: escalation length, minimum confidence, keyword set version, model names, and the triage, draft, and escalation prompts are read from Remote Config; with Remote Config unavailable in testing, documented in-code defaults produce identical routing behaviour on the fixture spot checks.
      Evidence (13 Nov 2026): src/services/appConfig.ts loads Remote Config over in-code defaults per field and never rejects; the default prompts reproduce the pre-Slice-3 prompts byte-for-byte (test-asserted); remoteconfig.template.json is generated from the code defaults with a test asserting template↔code agreement; the console publish step is documented in DESIGN.md as a Slice 4 deploy step and the app runs end-to-end on defaults.
      Unblocks: T-3.2.
- [x] **T-3.2 — Implement the app-level routing engine**
      Done means: automated tests show each trigger — length or complexity, negative sentiment, refund or legal intent, multiple issues, low confidence, and unsupported on-device language — selects escalation with the correct reason label, and a ticket with no trigger remains on the simple path.
      Evidence (13 Nov 2026): src/services/routing.ts with 9 engine tests (one per trigger + no-trigger + priority); fixture spot check — engine fed the gold triage inputs agrees with the gold route on all 30 tickets, and on the trigger label for 28 (RF-021/RF-030 name the higher-priority of two matching triggers, documented in the test); keyword checks run on redacted text only (code + test enforced).
      Unblocks: T-3.3, T-3.4.
- [x] **T-3.3 — Draft escalations in the cloud from the redacted payload only**
      Done means: a cloud-labelled ticket produces a draft through the cloud-preferred handle after the operator confirms the previewed payload; network and code-path tests prove the escalation call receives no raw-body field; the result card shows the escalation reason, actual route, and latency.
      Evidence (13 Nov 2026): src/services/escalation.ts + 9 tests — the payload's exact key set is asserted (no raw-body field exists), the prompt is proven free of raw personal data, blocked payloads make no call, held-for-review and minimised both require the preview confirmation, Privacy Mode refuses before any handle call, and the strict success rule holds; live: RF-021 escalated through the held-for-review confirmation to a draft with route in_cloud · 1388 ms and reason "Long or complex ticket", REST-verified (LIVE-VERIFICATION.md).
      Unblocks: T-3.4.
- [x] **T-3.4 — Build the repeatable 30-ticket evaluation runner**
      Done means: one action evaluates all 30 fixture tickets without changing their labels and produces an EvaluationRun with correct routes out of 30, accuracy, labelled redactions, and surviving labelled patterns; the run can be repeated with the same fixture version and compared with the previous run.
      Evidence (13 Nov 2026): src/services/evaluation.ts stores EvaluationRuns per user with per-ticket results (labels/counts/reasons only); tests cover aggregation, repeatability, failure accounting, quota retry and pacing; live: run 1 measured the free-tier rate limit (17/30, preserved as the previous run), the paced run 2 recorded 28/30 (93.3%), 27 labelled redactions, 0 surviving patterns, actual split 0 on-device / 30 in cloud / 0 failed, shown with the previous-run delta (LIVE-VERIFICATION.md).
      Unblocks: T-3.5.
- [x] **T-3.5 — Build the scorecard**
      Done means: the scorecard displays percentage fully handled on-device, median latency per actual route, offline successes out of attempts, cloud calls avoided, escalation accuracy, and labelled redactions caught, each with sample size, device description, and Chrome version; every figure can be traced to route events or an EvaluationRun, and no figure is typed in by hand.
      Evidence (13 Nov 2026): src/services/scorecard.ts is a pure computation over stored events + the latest run, proven by seeded-event tests including the honest empty states; live panel (screenshot slice3-scorecard.png): 0% on-device of 75 completed, median in-cloud 1048 ms (n=75), on-device n=0 shown as no-data, offline 0 of 3, cloud calls avoided 2, accuracy 28 of 30, redactions 27 caught / 0 surviving, device + Chrome 140.0.7339.16 recorded.
      Unblocks: Slice 4.
- [x] **T-3.6 — Prepare the impact evidence pack**
      Done means: the Devpost impact draft states the named audience and the measured scorecard only; if Pintu supplies real pilot feedback, the person, context, and wording are recorded with permission, and if none is supplied the draft contains no testimonial or invented user claim.
      Evidence (13 Nov 2026): submission/IMPACT.md — audience named per SPEC (small support teams / solo operators answering customer e-mail), the measured 13 Nov scorecard only, the two disagreements and the quota-limited first run explained, the redaction claim scoped to the labelled patterns, and the on-device share/latency/offline figures explicitly marked [REFRESH] for the Slice 4 on-device session; no testimonials (none supplied).
      Unblocks: T-4.4.
- [x] **T-3.7 — Adversarial QA for Slice 3**
      Done means: a fresh QA agent reports critical, warning, and informational findings after testing threshold boundaries, conflicting triggers, unsupported language, Remote Config failure, payload tampering, repeated evaluation runs, and scorecard arithmetic against raw route events. Every critical is fixed and re-tested; scorecard discrepancies are treated as critical.
      Evidence (13 Nov 2026): spec/QA-SLICE-3.md — 1 Critical (the evaluation runner bypassed Privacy Mode: under Privacy Mode all 30 triages fell back to the cloud, demonstrated live on QA account B and REST-proven; fixed by routing the run through resolveTaskRoute with a panel refusal, re-tested live with zero new events) + 3 Warnings (the 9c29815 mask-token guard let real names beside a token through redaction and the gate; preview/escalation object identity held only by rebuild — now threaded by reference; evaluation redaction figures skipped triage failures) all fixed (e84d778, afafa0d) with regression tests that fail on the pre-fix code; 114/114 tests; scorecard audited against all 133 stored route events with independent arithmetic — identical on every figure, no discrepancy; independent evaluation re-run measured 27/30 (90.0%), against the builder's 28/30 — the band and its zero headroom are flagged for T-3.8.
      Unblocks: T-3.8.
- [ ] **T-3.8 — Pintu confirmation gate for Slice 3**
      Done means: Pintu reviews one simple route, one escalation with its payload preview, the evaluation result, and the scorecard using supplied steps and confirms the slice, or corrections are completed first.
      Prep (13 Nov 2026): the review steps are Part A of spec/RUNBOOK-ONDEVICE.md, folded into the joint on-device session on Pintu's machine (his Slice 4 proof machine) so the gate is reviewed once, on the real figures. The two QA judgement calls (evaluation-refusal event convention; accuracy as the 27–28 band) are explicit checkpoints in that part.
      Unblocks: Slice 4.

## Slice 4 — Product polish, demonstration, and submission

*End-to-end outcome: the hosted product, repository, video, and Devpost submission all tell the same measured routing story and pass the Stage One checklist before the target submission date.*

- [ ] **T-4.1 — Complete the product experience and designed states**
      Done means: inbox, ticket, draft, preview, Privacy Mode, status panel, evaluation, and scorecard form one coherent flow; empty, loading, downloading, unavailable, offline, blocked, queued, and failed states are all reachable and labelled; keyboard focus, form labels, and text contrast pass the project’s accessibility checks on desktop Chrome.
      Unblocks: T-4.3.
- [ ] **T-4.2 — Create the routing diagram and repository package**
      Done means: a public repository contains the source, Apache licence, run and test instructions, the one-view routing diagram at the top of the README, a “Hybrid routing” section naming the code entry points, and a secrets scan showing no production keys, live Google Cloud secrets, confidential data, or personal data. The code demonstrably imports and calls Firebase AI Logic at runtime.
      Prep (13 Nov 2026, local only — no push, no repository created): Apache-2.0 LICENSE at the repo root (canonical text, Copyright 2026 Pintu Kumar) and a README.md draft covering the product, Firebase AI Logic usage, the hybrid routing design with entry points, run/test instructions, and the measured scorecard with accuracy as the 27–28 of 30 band; its routing view is the DESIGN.md one-view diagram in text form. Remaining for this task: create the public repository and push (Pintu's word), render the one-view routing graphic, and run the pre-publish secrets scan.
      Unblocks: T-4.4.
- [ ] **T-4.3 — Deploy and test the hosted demonstration**
      Done means: the Firebase Hosting URL loads over HTTPS; a full simple, privacy, and escalation flow passes on a machine with the device route available; the same ordinary flows pass by cloud fallback on an environment without the device route; testing instructions state the Chrome, hardware, App Check, and first-download requirements.
      Prep (13 Nov 2026, local side complete): firebase.json Hosting config verified (public dist, SPA rewrite), .firebaserc created selecting project replyforge-hybrid, npm run build produces the deployable bundle, 114/114 tests green. NOT done: the deploy itself — firebase-tools is not installed on the build VM and no Firebase CLI login exists, so no deploy was attempted; the exact deploy sequence, the Remote Config console publish steps, a pre-session hosted smoke test, and the joint-session steps are in spec/RUNBOOK-ONDEVICE.md. Flag: the production build does not yet initialise App Check (dev-only debug path in src/lib/firebase.ts) while console enforcement for AI Logic is “Basic — Enforced” — the smoke test in the runbook decides whether the reCAPTCHA v3 registration step is needed before the joint session.
      Unblocks: T-4.5.
- [ ] **T-4.4 — Write the Devpost submission draft and gallery**
      Done means: the draft selects Web (Chrome), explains how Firebase AI Logic is used, summarises features and value, leads with the redaction claim, uses only measured scorecard figures, and orders the gallery as routing diagram, on-device proof, payload preview, and scorecard. Repository, hosted demonstration, and licence links all resolve.
      Unblocks: T-4.7.
- [ ] **T-4.5 — Script and produce the demo video (target 2 minutes 45 seconds)**
      Done means: a public YouTube video with English narration or subtitles runs no longer than three minutes and hits all five beats in order: (1) problem, audience, and claim, 0:00–0:20; (2) network off, on-device triage and draft with route chip and latency, 0:20–0:55; (3) on-device redaction and Privacy Mode refusal, 0:55–1:30; (4) cloud escalation from the redacted summary with reason label, 1:30–2:15; (5) measured scorecard, hosted URL, repository, and the honest no-Nano fallback close, 2:15–2:45. No screen shows a route, figure, or capability the live build cannot reproduce.
      Unblocks: T-4.6.
- [ ] **T-4.6 — Run the Stage One submission checklist**
      Done means: a dated checklist verifies platform selected; description complete; public repository and visible licence; Firebase AI Logic actually called in code; hosted demonstration reachable; video public and within the limit; English throughout; project free of charge; no secrets or personal data in the repository, video, or testing instructions; and the quota/bonus position rechecked on the live Devpost page in case unpublished items have appeared.
      Unblocks: T-4.7.
- [ ] **T-4.7 — Pintu pre-submission review**
      Done means: Pintu reviews the projected score against all four equally weighted criteria, the clarity of the routing diagram, video, scorecard, and description, and explicitly approves submission or sends the pack back for named changes. No submission is filed before this approval.
      Unblocks: T-4.8.
- [ ] **T-4.8 — Submit and verify**
      Done means: the verified submission is filed by **29 November 2026**; the confirmation state, final project URL, repository URL, hosted URL, and video URL are recorded; one final click-through proves every submitted link opens the intended public asset. The 30 November 2:00 PM PT deadline remains unused buffer unless a verified filing failure requires it.
      Unblocks: nothing; entry complete.
