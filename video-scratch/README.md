# Video scratch — ReplyForge Hybrid rough demo package

Raw material for the submission video. The script is
[`spec/DEMO-SCRIPT.md`](../spec/DEMO-SCRIPT.md) (2:45, five beats).
**Nothing here is a finished video, and nothing has been uploaded or
published.** All recordings are the real hosted app
(https://replyforge-hybrid.web.app) driven in headless Chromium at
1280×800, signed in as QA account A — no staged or faked output.

## What exists (recorded 13 Nov 2026)

| File | Duration | Beat(s) | What it shows (verified from the takes) |
| --- | --- | --- | --- |
| `beat1-inbox-load.webm` | 21.4 s | 1 (tail) | Signed-out app (status panel honestly reads "On-device model unavailable" on this machine) → email sign-in → inbox renders. Note: the count reads **41 of 41** — QA account A holds the 30 fixture tickets plus 11 manual artefacts from earlier QA passes. If the final cut wants a clean "30 of 30", re-record this shot on a fresh account. |
| `beat4a-rf001-triage-cloud.webm` | 23.3 s | 5 (3-second insert) | RF-001 → Run triage again → fresh result card, route chip **In cloud · 2355 ms**, labels match gold (Delivery / Normal / Neutral / 95% / 1 issue / 0 personal-data items). This is the honest-fallback clip for the close. |
| `beat4b-rf021-escalation.webm` | 41.0 s | 3 (preview segment) + 4 | RF-021 → fresh triage (In cloud · 1306 ms) → Original-vs-Redacted comparison (order ID, name, e-mail, phone, address all masked) → **What the cloud sees** preview: redacted summary only, redaction count 5, gate **Held for review** (model counted 8 items, checks redacted 5) → button **I reviewed the payload — confirm and escalate** → click → escalation result card **In cloud · 1538 ms**, reason **Long or complex ticket**. |
| `beat3b-privacy-escalation-refusal.webm` | 32.6 s | 3 | RF-021 prepared (fresh triage + redaction) → Privacy Mode switched **On** → confirm-and-escalate clicked → **Refused — Privacy Mode** card held on screen ("The refusal was recorded as a route event. No model call was made."). Recorded on the no-Nano build VM, where the refusal is the live behaviour. |

Recorder: `record-shots.mjs` (Playwright; usage in its header).
Re-running a shot overwrites its file. Recording gotcha, already
handled in the script: a stored result card from an earlier run can
sit on screen, so a fresh completion is only accepted when the card
text changes and it is not the amber awaiting-sync state — the first
RF-001 take caught the stale card and was re-recorded.

## What is missing (Pintu's session — RUNBOOK-ONDEVICE.md Parts B–C)

- **Beat 2 footage (the core on-device proof):** on Pintu's Ubuntu
  VM only — status panel reporting the model available, Wi-Fi off,
  RF-001 triage completing with the **On device** chip, and the
  RF-006 offline sequence (amber awaiting-sync card → promotion
  after reconnect). Stills fallback: his runbook screenshots (On
  device triage card, amber card, scorecard panel).
- **Beat 3 close-up:** RF-003 redaction comparison on his machine
  (one e-mail masked, count 1); his screenshot works as a held
  still.
- **The `[FIGURES]` values** for `spec/DEMO-SCRIPT.md` and the
  scorecard card: fully-handled-on-device share, median on-device
  latency (with n), offline successes of attempts — read off his
  session's scorecard (Part C). Until these land, **do not record
  the voiceover** (Beat 2 and Beat 5 lines contain the
  placeholders).
- **Cards to generate at assembly:** title card, the one-view
  routing diagram (full-screen at ~0:25), the scorecard graphic
  (figures table in DEMO-SCRIPT.md; Pintu's scorecard screenshot as
  background still), end card (hosted URL + repo).

## Assembly order for the final cut

1. **Beat 1 (0:00–0:20):** title card → `beat1-inbox-load.webm`
   (use the tail: inbox rendered).
2. **Beat 2 (0:20–0:55):** routing-diagram card (~0:25) → Pintu's
   on-device clips (network off → On device chip → offline
   awaiting-sync → promotion).
3. **Beat 3 (0:55–1:30):** Pintu's RF-003 redaction still/clip →
   the preview segment of `beat4b-rf021-escalation.webm` →
   `beat3b-privacy-escalation-refusal.webm` (end on the refusal
   card).
4. **Beat 4 (1:30–2:15):** `beat4b-rf021-escalation.webm` resumed
   at the confirm click → escalation result card. **Do not show
   the payload preview twice** — it plays in Beat 3 only.
5. **Beat 5 (2:15–2:45):** scorecard card → 3-second insert from
   `beat4a-rf001-triage-cloud.webm` (the In cloud chip, for the
   honest-fallback line) → end card.
6. Record the voiceover from `spec/DEMO-SCRIPT.md` only after the
   `[FIGURES]` placeholders are filled; total runtime target
   2:45, hard cap 3:00.
