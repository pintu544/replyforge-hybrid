# QA — Slice 3 Adversarial Report (T-3.7)

> Fresh-agent adversarial QA of Slice 3 (Remote Config, the routing
> engine, cloud escalation, the evaluation runner, the scorecard),
> carried out against HEAD `ba3c9ea` on 13 November 2026. Method: code
> trace of every Slice 3 service and its App wiring, a 20-case probe
> suite written against the attack surface (threshold boundaries,
> conflicting triggers, Remote Config failure, payload tampering,
> mask-token-shaped inputs, evaluation accounting, scorecard edge
> states), and live runs against the real Firebase project with both QA
> accounts, including REST-level verification of stored documents.
>
> **Result: 1 Critical finding — fixed. 3 Warning findings — all fixed.
> 7 Informational notes. Zero Criticals or Warnings remain open, so
> T-3.7 is checked off.** Final gates: `npm test` **114/114** (105 at
> handover + 9 new regression tests, plus one assertion added to the
> routing priority test), `npm run typecheck` clean, `npm run lint`
> clean, `npm run build` succeeds. Every new regression test was also
> run against the pre-fix code: the C-1, W-1 and W-3 tests fail there
> (7 failures), the W-2 test passes both ways for the reason stated in
> its finding. Fix commits: `e84d778` (W-1), `afafa0d` (C-1, W-2, W-3).

## Critical

### C-1 — The evaluation runner bypassed Privacy Mode entirely — FIXED (`afafa0d`)

- **Finding:** `handleRunEvaluation` called `runEvaluation` with the
  device-preferred adapter directly — it never went through
  `resolveTaskRoute`, the one place Privacy Mode is enforced for triage
  and drafts. The triage prompt carries the **raw** ticket text, so with
  Privacy Mode on and no device route available, clicking "Run
  evaluation" sent all 30 raw tickets to the cloud — while the Privacy
  Mode panel beside the button says that with the mode on, tasks "run
  on-device only" and "nothing is sent to the cloud". SPEC FR-8 covers
  "AI processing" without carving out evaluation, and DESIGN.md's
  Privacy Mode note governs "the AI tasks (triage, drafting) that have
  a route" — an evaluation is 30 triage tasks. This is the Slice 3
  instance of the failure class Slice 2's C-1 was about, except
  behavioural rather than copy: the mode's promise was false for the
  largest batch action in the app.
- **Live demonstration (before the fix, QA account B):** Privacy Mode
  ON (panel state verified), evaluation clicked, run completed 30/30.
  Firestore REST: 30 new triage route events, all
  `requestedMode: prefer_on_device`, `outcome: fallback`,
  `actualSource: in_cloud`; an EvaluationRun document stored (28/30).
  No refusal, no warning, nothing in the UI mentioned Privacy Mode.
- **Fix:** the evaluation now resolves its route exactly like triage
  and drafts. Privacy Mode + no device route → the run is **refused
  before any model call**, and the EvaluationPanel shows the refusal
  with the same reason/alternative wording as the per-task refusals.
  Privacy Mode + device route → the device-only adapter and
  `only_on_device` requested mode flow through `runEvaluation` into
  `runTriage`, whose existing guard discards any result that reports a
  cloud route. Privacy Mode off → unchanged (device-preferred).
  Deliberate scoping: a refused batch records no route event — it is
  not 30 task attempts, and minting 30 blocked events for one click
  would inflate the scorecard's "cloud calls avoided" by 30; the panel
  explanation is the record, mirroring the escalation
  needs-confirmation state, which also records nothing. Flagged for
  the T-3.8 gate in case Pintu wants the other convention.
- **Regression tests:** App level — Privacy Mode on in the jsdom rig,
  evaluation clicked: refusal copy appears, `structuredCalls` stays 0,
  no run is stored. Service level — `runEvaluation` with
  `requestedMode: 'only_on_device'` and a cloud-reporting adapter:
  30 honest failures, 0 counted cloud routes. Both fail on the
  pre-fix code.
- **Live re-test (after the fix, account B, identical steps):**
  refusal rendered immediately; REST shows zero new route events and
  the stored-run count unchanged. Screenshot:
  `spec/evidence/qa3-privacy-eval-refused.png`.

## Warnings

### W-1 — The detector's mask-token guard let real names through redaction and the gate — FIXED (`e84d778`)

- **Finding:** commit `9c29815` exempted a quoted from/to name change
  when **either** quoted side merely *started with* `[`. Three
  consequences, all reproduced by probes: `from "[name masked]" to
  "Priya Nair"` detects nothing (the real name survives); the mirror
  form likewise; and any bracketed quoted name
  (`from "[Admin] John Mathew" to "Jane Doe"`) is exempted. End to
  end: a manual ticket with the mixed form produced an artefact whose
  body **and summary** contained the raw name, and the payload gate —
  whose scan hits the same exemption — passed it as usable, so the
  name would have gone to the cloud in an escalation payload. That is
  NFR-4's enforcement failing for a labelled pattern type.
- **Fix:** the exemption is per side and exact: only a quoted value
  that **is** the mask token counts as already masked. A mixed match
  still fires and masks just the real side; the fully-redacted form
  (`from "[name masked]" to "[name masked]"`) stays exempt, so the
  9c29815 regression (detector flagging its own output, all 30
  tickets pattern-free) is preserved.
- **Regression tests:** five in `redaction.test.ts` — both mixed
  directions detected, bracketed non-token name detected, mixed
  artefact masked and pattern-free, both-token still exempt. All
  four detection cases fail on the pre-fix code.

### W-2 — Preview/escalation "identical object" was identity by rebuild, not by reference — FIXED (`afafa0d`)

- **Finding:** DESIGN.md states "the escalation consumes the identical
  `BuiltEscalation` object the preview produced", and the escalation
  service docstring repeats it. At the App level it did not:
  `handleEscalate` rebuilt a fresh preview via `prepareEscalation`
  from the freshest ticket, a recomputed decision, and the stored
  artefact, and consumed *that*. The rebuild is deterministic, so the
  sent payload was content-identical to the previewed one in every
  reachable state — this is a claim-vs-construction gap, not an
  observed divergence — but the invariant the design promises (what
  the operator confirmed is, object-for-object, what is sent) held
  only as long as every rebuild input happened to match what was on
  screen. Any future edit to either computation could silently split
  them.
- **Fix:** the workspace's confirm button now passes the very
  `EscalationPreview` object it rendered into `handleEscalate`, which
  hands it to `runEscalation` untouched; the downstream rebuild is
  deleted. The handler still reads the freshest ticket for the draft
  record and status updates, which are bookkeeping, not payload.
- **Regression test:** an App-level test drives the whole flow
  (angry triage → redact → "Confirm payload and escalate") and asserts
  the stored draft is the escalation draft for the previewed payload
  (reason "Negative sentiment", `prefer_in_cloud`, the adapter's
  text). It passes on the pre-fix code too — stated plainly, because
  the defect was structural; the test pins the end-to-end behaviour
  the construction now guarantees by reference.

### W-3 — Evaluation redaction figures silently skipped triage failures — FIXED (`afafa0d`)

- **Finding:** in `runEvaluation`'s failed-triage branch, the
  per-ticket result hardcoded `redactionCount: 0` and
  `survivingPatterns: 0`, and the run's surviving-pattern total never
  saw the ticket. Redaction is deterministic local code and does not
  depend on triage, so a run with failures (the builder's first live
  run had 12) reported redaction figures measured over fewer tickets
  than the panel's "Labelled redactions caught" line implies. The
  headline run was unaffected (0 failures), which is why this is a
  Warning rather than a scorecard discrepancy: no displayed figure
  was wrong, but the measurement contract was.
- **Fix:** the failed branch now produces the artefact anyway and
  records its real count plus the same summary scan the payload gate
  performs.
- **Regression test:** a run with the third ticket's triage failed
  asserts that ticket's `redactionCount` equals its labelled count
  (and is not zero). Fails on the pre-fix code.

## Held under attack (no finding)

- **Remote Config:** per-field merge verified — one bad value never
  poisons the rest; zero/negative length and out-of-range confidence
  fall back per field; an unusable app object resolves
  `loadAppConfig` to the defaults (it never rejects); the defaults
  still reproduce the pre-Slice-3 prompts byte for byte (builder's
  tests, re-run).
- **Routing engine:** boundaries exact — length *at* 400 stays simple,
  confidence *at* 0.6 stays simple; keyword matching is
  word-boundaried (`courteous` does not trip `court`) and
  case-insensitive; the bare word "refund" still does not select
  refund/legal. Priority probed for every adjacent pair in the
  documented order, including language over keywords and keywords
  over length (probes pass; the multiple-issues-over-sentiment pair
  was unpinned by the builder's tests and is now asserted there).
  Keyword checks receive only redacted text at every call site
  (App decision, App escalation path, evaluation) — code-traced and
  consistent with the Slice 2 invariant.
- **Escalation:** prompt is rendered from payload fields only; the
  payload's key set is exactly the contract (no raw-body field
  exists); tampered artefacts with a surviving e-mail (builder) or a
  phone mid-summary (QA probe) are blocked with zero model calls;
  held-for-review and minimised both refuse to run unconfirmed;
  Privacy Mode refuses before any handle call with a blocked event.
  Strict rule probed directly: a route-event writer that *rejects*
  on the success path surfaces the escalation as failed (the
  awaiting-sync hook fired first, as designed) — never as a success.
- **Evaluation accounting:** input tickets are not mutated (a run
  over `Object.freeze`d tickets completes); a quota failure that
  repeats is scored once as failed with both attempts' events kept
  (6 events for 3 tickets); a single flipped triage field produces
  exactly one disagreement naming the right ticket and trigger;
  per-ticket results carry exactly the nine contract keys.
- **Scorecard:** blocked-only event sets produce null shares and
  honest empty states; the even-count median averages the middle
  pair; and the live audit (LIVE-VERIFICATION.md) recomputed all 133
  of account A's stored events with independent arithmetic — every
  figure identical to the shipped computation. No hand-typed figure
  exists in the panel code.
- **Isolation:** evaluation runs and route events saved under one
  account are invisible to the other in the repository tests, and
  live REST returns 403 cross-account in both directions (controls
  200) — the same per-user partition as every other record type.

## Informational (documented, not fixed)

1. **Language codes are matched bare.** `en-US` (or an empty string)
   escalates as unsupported-language; matching is case-insensitive
   (`EN` is fine). Fixture and manual tickets only ever carry bare
   codes today, so nothing misroutes now; if a language ever comes
   from model output, normalise region tags first.
2. **Remote Config cannot set the confidence minimum to 0** — the
   merge treats 0 as invalid and keeps the 0.6 default, so the
   low-confidence trigger cannot be disabled from the console. The
   length value is rounded (`12.9` → 13). Both fail safe toward the
   defaults; recorded so a future operator is not surprised.
3. **"Surviving patterns" is a detector count, not a gold-label
   count**: when the gate blocks, the run counts what the detector
   still finds in the payload summary. With the pattern-free
   artefact invariant this is 0 unless redaction genuinely fails —
   which is the event the figure exists to catch.
4. **Scorecard run selection ties:** two runs with identical
   `createdAt` resolve by input order (stable sort). Repository
   order is newest-first, so the panel's "latest" is the newest run
   in practice.
5. **Run provenance is thin:** `deviceDescription` stored on every
   run is the constant "The operator's machine, in this browser
   session". Honest, but Slice 4's on-device session should record
   the real machine description when the [REFRESH] figures are
   captured for the impact pack.
6. **Evaluation triages re-run the raw-ticket triage prompt** — by
   design (the runner measures the real pipeline), and the same
   cloud exposure as a manual triage. Under Privacy Mode it is now
   refused (C-1); with the mode off this is the disclosed median
   behaviour, not a leak.
7. **The pre-fix C-1 screenshot was overwritten** by the post-fix
   re-test (same harness filename). The REST record quoted in
   LIVE-VERIFICATION.md is the durable evidence, and it is stronger
   than the screenshot.

## Builder's gate flags — QA position

1. **Live accuracy variance: confirmed and sharpened.** Builder:
   28/30 (93.3%). QA demonstration run (account B): 28/30. QA re-run
   (account A): **27/30 (90.0%)** — exactly the NFR-5 minimum.
   RF-015/RF-017 disagreed in every run (model issue-count variance);
   the third disagreement, RF-022, flipped because the model
   reported confidence ≥ 0.6 for a ticket whose gold label assumes
   low confidence. Three runs give a 27–28/30 band with **zero
   headroom** below the bar on an unlucky run. Nothing was tuned.
   This is the single most important item for the T-3.8 gate: the
   submission story should present the measured band, not the best
   run.
2. **Quota pacing stands:** observed run times 175 s (account A
   re-run) to ~5 min (account B, slower triages). `paceMs` in
   App.tsx remains the knob.
3. **Remote Config console publish** remains a Slice 4 step; the
   app is proven identical on defaults.

## Closure verification (13 November 2026, this pass)

- **Gates:** `npm test` **114/114**, `npm run typecheck` clean,
  `npm run lint` clean, `npm run build` succeeds (the pre-existing
  informational chunk-size warning only).
- **Count note:** 105 at handover; new tests — redaction +5 (19 in
  file), evaluation +2, App +2 (9 in file) = 114; the routing
  priority addition is an assertion inside an existing test.
- **Live re-verification** (real Firebase, both QA accounts; full
  record in LIVE-VERIFICATION.md): C-1 refused live with zero new
  events; independent evaluation re-run 27/30 with 0 surviving
  patterns; stored-run hygiene scan 0 hits across all 3 runs;
  cross-account REST isolation 403 both ways; scorecard audit over
  133 stored events identical on every figure.
- **Verdict:** no Critical or Warning remains open. T-3.7 is checked
  off. T-3.8 (Pintu's gate) should present: one simple route, one
  escalation with its payload preview, the evaluation result *as a
  measured band (27–28 of 30)*, and the scorecard — plus the two
  judgement calls flagged above (evaluation-refusal event
  convention, C-1 fix note; run-provenance description,
  Informational 5).
