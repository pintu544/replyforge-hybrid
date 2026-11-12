# QA — Slice 2 Adversarial Report (T-2.8)

> Fresh-agent adversarial QA of the Slice 2 privacy boundary. The attack
> pass, the fix pass, and this verification/closure pass were carried out by
> **separate agents**; the findings below are the attack agent's, graded by
> it, the fixes are the fix agent's (three commits on top of Slice 2's
> `d853951`), and the re-tests and gates recorded here were re-run
> independently at closure on 13 November 2026 against HEAD `53ab966`.
> Method, per the task: fixture and hand-written edge cases against the
> privacy boundary — unusual personal-data formats, a deliberately surviving
> pattern, Privacy Mode with no device route, offline use, repeated sends,
> and attempts to reach a cloud payload without a redacted artefact.
>
> **Result: 1 Critical finding — fixed. 2 Warning findings (the second with
> four sub-defects) — all fixed. 11 Informational notes. Zero Criticals or
> Warnings remain open, so T-2.8 is checked off.** Final gates at closure:
> `npm test` 72/72 passed, `npm run typecheck` clean, `npm run lint` clean,
> `npm run build` succeeds (the pre-existing informational chunk-size
> warning only).

## Critical

### C-1 — UI copy falsified the central claim — FIXED (`6f8b24f`)

- **Finding:** three strings claimed things that are false on the median
  machine (no on-device model → triage falls back to the cloud, and
  `buildTriagePrompt` sends the **raw** subject/body):
  - Header: *"The cloud sees a redacted summary, never the raw ticket."*
  - Welcome panel: *"Personal data is redacted on-device before anything
    else happens."*
  - Payload-preview note: *"The raw ticket never leaves the device."*
  All three are true of escalations and draft prompts, and false of triage
  itself — Slice 1's live evidence is in-cloud triage of personal-data-
  bearing tickets. For a product whose pitch is provable honesty, the
  header sentence alone would sink it.
- **Fix (copy only, no behaviour change):** the claims are re-scoped to say
  exactly what is true, prominently rather than buried. Header now reads:
  *"On-device first. Drafts and escalations are built only from the
  redacted summary. Triage may run in the cloud — when it does, the ticket
  text goes to Firebase AI Logic."* The welcome panel and preview note are
  scoped the same way, and two adjacent over-claims found in the same pass
  were scoped too: the comparison column no longer says the original
  *"stays on this device"* (tickets persist in the user's Firestore
  partition), and the sent note no longer says *"recorded locally only"*.
- **Re-test at closure (live):** the running app renders the corrected
  header verbatim — read from the live page and asserted by string match;
  the old *"never the raw ticket"* wording is absent. Evidence:
  `spec/evidence/qa2-slash-phone-draft.png` (header visible), and the
  closure run's recorded header text.

## Warnings

### W-1 — Detector separator gaps let labelled formats reach the draft prompt — FIXED (`2a8abdd`)

- **Reproduction (attack pass):** a ticket body containing `98200/11223`
  redacted with count **0**, and `buildDraftPrompt` output contained the
  raw number — on the cloud-fallback route (the median path) it would have
  been sent to the cloud model. The draft path had no second-line scan.
  Formats missed: phones with a slash separator, in parentheses, or split
  mid-group by space/newline; order identifiers with dot (`ORD.78451`) or
  slash (`ORD/78451`) separators; names with a middle initial inside the
  labelled anchor (*"My name is Priya S. Nair"*).
- **Fix:** (a) the phone and order-identifier separator classes are widened
  and the name anchors accept an optional middle initial. The loose phone
  form still demands exactly ten subscriber digits (plus an optional `91`)
  and refuses longer digit runs, so UPI-style references, PINs and dates
  are not newly swallowed — the 30-ticket label invariant still passes in
  both directions. (b) Defence in depth: `runDraft` now re-scans the
  redacted artefact with the detector **before** any prompt is built and
  blocks with a visible reason (surviving types named, never values), so a
  stale or hand-built artefact cannot leak a surviving pattern into a
  model call.
- **Regression tests:** five new redaction cases (slash/parenthesis/
  mid-group-split phones, dot/slash order IDs, middle-initial names,
  "widened formats no longer survive into a redacted artefact", and the
  over-masking guard for longer digit runs/PINs) plus a drafts test —
  "blocks generation before any model call when a labelled pattern
  survives in the artefact". All pass at closure.
- **Re-test at closure (live):** a manual ticket — *"Please call me back
  on 98200/11223…"* — now redacts with **count 2** (order identifier +
  telephone); the Redacted comparison column shows `[telephone masked]`
  and contains no raw digits; the draft was produced from the artefact
  (its text echoes the masked placeholders, never the number); Firestore
  REST confirms the stored ticket carries `redactionCount: 2` and a masked
  `redactedSummary`. Evidence: `spec/evidence/qa2-slash-phone-draft.png`.

### W-2 — App handler state integrity: four defects — FIXED (`53ab966`)

- **Defects (attack pass, code-traced):**
  (a) In-flight triage/draft completions called `setState`
  unconditionally, so a completion landing after an account switch painted
  account A's result — including draft **text** — into B's session (the
  async variant of Slice 1's W-1; the data layer itself stayed isolated).
  (b) Privacy Mode refusal display awaited `recordRefusal(...)` before
  setting the refused state, delaying it up to the 10 s bounded record —
  worst in exactly the Privacy Mode + offline case.
  (c) Cross-action in-flight guards were missing (manual draft vs AI
  draft, send vs regenerate).
  (d) Regenerate / Write-manually after a simulated send silently
  overwrote the sent draft record while the ticket stayed
  `sent-simulated` — an inconsistent, misleading state pair, reachable
  from the UI without forcing.
- **Fix:** a session epoch bumped on every account change, checked by
  every handler before painting post-await state (`refreshTickets`
  included); the refused state is set **before** the refusal is recorded;
  one shared per-ticket guard covers the whole draft lifecycle (AI draft,
  manual draft, send); starting a fresh draft on a sent ticket reverts the
  ticket to its pre-send status (`triaged` if triage exists, else
  `inbox`) and re-offers Send, while refused/failed attempts leave the
  sent pair untouched.
- **Evidence — a necessary substitution, stated plainly:** the attack
  agent's live, account-based browser reproductions of (a)/(b) were
  stopped by a safety refusal in its session and were not retried. The
  substitute is a deterministic jsdom component rig
  (`src/App.test.tsx`) with Firebase, Auth, the repository, the adapters
  and the route-event writer replaced by controllable doubles: **seven
  tests** — two for (a) (triage and draft completions after a switch),
  one for (b) (refusal displayed while its route-event write never
  settles), two for (c), two for (d). The fix commit records that all
  seven failed on the unfixed code and pass after it; at closure they were
  re-run and pass (7/7). Deterministic tests are arguably stronger
  evidence than the timing-dependent browser race they replace.

## Held under attack (no finding)

- The payload gate blocked every tampered artefact in which a labelled
  type was reintroduced in a **detected** format, naming the surviving
  types correctly.
- Privacy Mode refusal semantics, the one-`blocked`-event-per-refusal
  record, and toggling back to normal fallback all behaved as designed.
- Awaiting-sync honesty verified at service level: the amber card carries
  no route chip and no success wording; list rows read only persisted
  triage.
- An independent re-check of all 30 fixture tickets with a separately
  written detection table matched the labels in both directions under
  distinct-value counting; occurrences exceed labels only where the same
  value repeats (order IDs in subject + body: RF-005/007/008/016/021/024;
  RF-009's name chain).

## Informational (documented, not fixed)

1. Postal-address variants outside the labelled forms (Block/Sector
   suffix, no street suffix, city + PIN only) can survive redaction; the
   workspace already discloses that redaction "is not a guarantee for
   arbitrary free text".
2. Name phrasings outside the labelled anchors — sign-offs (*"Regards,
   Priya Nair"*), *"I am …"*, lowercase names — can survive. Observed live
   at closure: the sign-off "Kavita" in the W-1 re-test ticket stayed
   unmasked (and the draft greeted her by name) while the telephone number
   — the W-1 target — was masked. In scope of the labelled-pattern
   guarantee; disclosed by the same workspace note.
3. E-mail variants: spaces around `@`, Unicode look-alike `@`, dotless
   domains.
4. Payment-reference variants: `PAY_` uppercase, short `pay_` IDs,
   UPI-style 12-digit references. (The widened phone form deliberately
   refuses 12-digit runs, so these are not newly over-masked either.)
5. Over-masking, safe direction: *"call me, Customer Support"* is masked
   as a name; a bare 10-digit invoice number is masked as a phone.
6. The artefact brand is a programming-error guard inside client-side
   code, not a security boundary — a hand-forged branded artefact passes
   `assertArtefact`. The runtime checks are the payload gate's scan and,
   since W-1, the `runDraft` pre-generation scan.
7. The payload gate inherits the detector's blind spots exactly (gate and
   redaction share one detector): a detector-missed format passes the
   gate as *minimised*. The W-1 widening shrinks the blind spot; the
   residual is items 1–4 above.
8. One `blocked` route event per deliberate refused click is
   FR-12-conformant (each refusal is a real, recorded event), not spam.
9. Privacy Mode toggled mid-flight: each run records its own
   `requestedMode` honestly; no retroactive relabelling.
10. RF-021's gate state *Held for review* (model count > redaction count)
    is Pintu's accepted rule firing, not a defect.
11. The QA scratch probes (`qa2-scratch.test.ts`, `qa2-probe.test.ts`)
    were removed by the W-1 commit; their cases live on as the regression
    tests cited above. Verified absent from the tree at closure.

## Closure verification (13 November 2026, this pass)

- **Gates:** `npm test` **72/72** (Slice 2 baseline 59 + 13 new: redaction
  8→13, drafts 11→12, `App.test.tsx` +7); `npm run typecheck` clean;
  `npm run lint` clean; `npm run build` succeeds.
- **Live re-test** (real Firebase, QA account A, headless Chromium via the
  egress forwarder; full record appended to `LIVE-VERIFICATION.md`):
  (i) RF-021 redaction count still **5** in the UI ("matches the fixture
  label") and in Firestore (REST 200, stored `redactionCount: 5`) after
  the detector widening — no regression, no invented detections.
  (ii) The slash-phone manual ticket above: count 2, masked artefact,
  clean draft, clean stored record.
  (iii) Corrected header copy confirmed verbatim in the running app.
  One harness note: the first closure attempt waited for a "30 of 30"
  inbox count that no longer exists — the QA inbox holds 40 tickets (30
  fixture + 10 manual artefacts left by T-1.9) — a wait-target error in
  the test script, not the app; the corrected run passed every check.
- **Verdict:** no Critical or Warning remains open. T-2.8 is checked off.
  T-2.9 was confirmed by Pintu on 13 Nov 2026 — the awaiting-sync state,
  distinct-value counting, and the held-for-review rule accepted as built;
  this QA ran after that confirmation at his direction.
