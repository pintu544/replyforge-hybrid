# Demo video — final cut manifest

**File:** `replyforge-hybrid-demo.mp4`
**Assembled:** 13 November 2026 · **Not uploaded or published.**
**Runtime:** 155.5 s (2:35.5) — target 2:45, hard cap 3:00
**Format:** 1280×720, 30 fps, H.264 (CRF 20) + AAC 160 kbps · 16.4 MB
**Script:** `spec/DEMO-SCRIPT.md` (Beat 2 adapted to the stills
fallback — see its Footage cell; all other beats verbatim).

## Beats as recorded

| Beat | In final cut | Sources (in order) | Treatment |
| --- | --- | --- | --- |
| 1 — Problem + claim | 0:00.0–0:19.9 | Title card (generated) → `video-scratch/beat1-inbox-load.webm` (6.0–21.4 s) | Card hold 3.0 s with slow push-in; clip at 0.92× |
| 2 — On-device proof (stills) | 0:19.9–0:48.5 | Routing-diagram card (generated) → `spec/evidence/ondevice-scorecard.png` → `spec/evidence/ondevice-rf003-redaction.png` | Stills on themed canvases, slow push-in (7.0 s / 13.0 s / 8.6 s). **No network-off footage exists; none is shown or narrated.** |
| 3 — PII / Privacy Mode | 0:48.5–1:18.6 | RF-003 still canvas → `beat4b-rf021-escalation.webm` preview segment (25.0–32.0 s) → `beat3b-privacy-escalation-refusal.webm` (24.0–32.6 s) | Preview slowed to 0.72×; refusal at 0.85× ending on a freeze-hold of the **Refused — Privacy Mode** card. The RF-021 preview appears **once**, here. |
| 4 — Cloud escalation | 1:18.6–1:46.1 | `beat4b-rf021-escalation.webm` resumed at the confirm click (32.3–41.0 s) → freeze-hold of the final frame (In cloud · 1538 ms result card) | Clip at 0.70×; hold with slow push-in to 1.10× |
| 5 — Scorecard + close | 1:46.1–2:35.5 | Scorecard card (generated; figures from DEMO-SCRIPT + the session scorecard still inset) → `beat4a-rf001-triage-cloud.webm` insert (17.0–20.5 s, In cloud · 2355 ms) → end card (generated) | Card 33.0 s; insert at 1.0×; end card 12.9 s |

`spec/evidence/hosted-smoke.png` was available but not used — no
beat in the script calls for it.

The end card shows the live demo URL (replyforge-hybrid.web.app).
It does not print a repository URL: the public repo has not been
created yet, and the card will be regenerated when it exists.

## Voiceover as recorded

ElevenLabs TTS, voice **Sarah** (EXAVITQu4vr4xnSDxMaL), model
`eleven_turbo_v2_5`, speed 1.2 (the 1.0 pass measured 3:22 — over
the cap; 1.2 lands the narration at demo pace). Per-beat audio:
19.6 s / 28.3 s / 29.7 s / 27.1 s / 49.1 s. Each beat's picture is
timed to its narration + 0.35 s.

- **Beat 1:** "If you run support for a small product, this is your morning: a wall of customer e-mail, and every reply starts from a blank box. Sending all of it to a cloud model is fast — but it means your customers' personal data leaves with every message. ReplyForge is built for that operator. It redacts personal data where it lives — on the device — and the cloud only ever drafts from the redacted summary."
- **Beat 2 (reworded for the stills fallback):** "Watch the route, not the promise. This machine has Gemini Nano, so triage runs on the device — and the proof is the route each result reports, from Firebase AI Logic itself. On this machine, the full thirty-ticket evaluation ran on the device: thirty of thirty triages, at a median of 9,662 milliseconds, on a CPU-only machine with no GPU. The scorecard on screen is the app's own record of that run. Work finished offline waits, honestly labelled 'awaiting sync', until it can prove its route."
- **Beat 3:** "Here is the part we cared about most. Personal data — e-mail addresses, phone numbers, order IDs, addresses, names — is found and masked by deterministic checks on the device, before any drafting or escalation is built. This panel is the whole of what the cloud would receive: the redacted summary, and nothing else; the payload has no field that could carry the raw ticket. And for the operator who cannot accept cloud processing at all, there is Privacy Mode: device-only, or the task is refused. This escalation is refused — recorded, explained, and no model call was made."
- **Beat 4:** "Some tickets should not be answered by the smallest model. This one is long, angry, and about more than one problem, so the routing engine escalates it — and it shows its reason. Notice the gate: the triage model counted more personal-data items than the redaction checks caught, so the payload is held for review, and my click on this button is that review. Only then does the cloud model draft — from the redacted summary you just saw, exactly that object — and the finished draft lands back in the editor, where a human still approves every word before anything is sent."
- **Beat 5:** "And the numbers are measured, not claimed. Across four live runs over a labelled thirty-ticket set, the routing engine agreed with the labels twenty-seven to twenty-eight times — the misses are listed in the app, with reasons. Twenty-seven of twenty-seven labelled personal-data items were redacted; zero survived into a cloud payload. In the on-device run, all thirty of thirty triages ran entirely on the device at a median of 9,662 milliseconds, against a measured cloud median of about one second; and the same scorecard shows its offline line as zero of zero attempts on that machine — we'd rather show you the zero than stage it. And the honest fallback: on a machine without Gemini Nano — like the one this clip was recorded on — everything you just saw still works, via the cloud route, with the route shown on every card. ReplyForge Hybrid: on-device when it can, in the cloud when it should, and it shows you which — every time."

## Cards

Rendered locally as 1280×720 HTML → PNG (headless Chromium), light
theme matching the app: title card, routing diagram, Beat 2
still canvases (captioned), scorecard card (figures table from
DEMO-SCRIPT + session scorecard still), end card.

## Verification (13 Nov 2026)

- `ffprobe`: duration 155.53 s; video H.264 1280×720 @ 30 fps;
  audio AAC; size 16,370,662 bytes.
- One frame extracted and viewed from every beat (14 frames):
  title, inbox, routing card, session scorecard still, RF-003
  still (both beats), payload preview, refusal card, escalation
  click segment, result-card hold (In cloud · 1538 ms), scorecard
  card, In-cloud insert (2355 ms), end card — no black frames,
  stills correct, card text legible.
- The refusal freeze-hold frame was checked at full resolution:
  the **Refused — Privacy Mode** card is fully readable, including
  "The refusal was recorded as a route event. No model call was
  made."
- Audio: no silence ≥ 2.5 s anywhere (`silencedetect` −45 dB);
  mean volume −17.5 dB, max −3.4 dB.
