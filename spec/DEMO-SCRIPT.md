# DEMO SCRIPT — ReplyForge Hybrid (#BuildHybridAI 2026)

> The full 2:45 voiceover + shot script for the submission video
> (hard cap 3:00; only the first 3 minutes are evaluated). Structure
> follows the win-research demo plan (research report §6.4): problem →
> on-device proof → PII / Privacy-Mode moment →
> cloud escalation from the redacted summary → measured scorecard +
> close.
>
> **Shot marks:** `[RECORD NOW — hosted build]` = footage recorded
> from https://replyforge-hybrid.web.app on the build VM (raw files in
> `video-scratch/`, see its README). `[NEEDS PINTU SESSION — his
> machine/screenshots]` = can only be captured on Pintu's Ubuntu VM,
> the only machine with Gemini Nano (RUNBOOK-ONDEVICE.md Parts B–C);
> his runbook screenshots are the stills fallback. `[CARD]` = a
> generated graphic, no app footage.
>
> **Honesty rules baked into this script (do not edit them away):**
> - Routing accuracy is spoken as the **measured band, 27–28 of 30
>   (90–93%)** across four live runs (three cloud, one fully
>   on-device) — never the best run
>   (QA-SLICE-3 gate flag; the NFR-5 bar is 90%, so the band sits
>   exactly on it and the script says what the disagreements were).
> - On-device figures were measured in Pintu's 13 Nov session and
>   are filled in below (scorecard screenshot:
>   `spec/evidence/ondevice-scorecard.png`). Nothing on-device is
>   quoted from the build VM, which cannot run Gemini Nano.
> - **No claim that the cloud can never see a raw ticket.** The
>   scoped, true claim (QA-SLICE-2 C-1; IMPACT.md): drafts and
>   escalations are built only from the redacted summary — the
>   payload type has no raw-body field — while triage itself may
>   run in the cloud on a machine without Gemini Nano, and the app
>   shows which route ran on every card. Privacy Mode is the
>   answer for operators who cannot accept cloud triage.
> - Route proof is always `inferenceSource` as shown on the app's
>   own route chip — never the requested mode.
>
> Voiceover pace: ≈150 words/minute; total ≈410 words ≈ 2:45.
> The `[FIGURES]` values are final (filled 13 Nov from Pintu's
> session). **Final cut assembled 13 Nov 2026** (2:35.5;
> `video-final/replyforge-hybrid-demo.mp4`, timings and sources in
> `video-final/MANIFEST.md`). Beat 2 uses the stills fallback with
> reworded VO — the network-off capture never materialised — see
> Beat 2 below.

---

## Beat 1 — Problem + audience + claim · 0:00–0:20

| | |
| --- | --- |
| **On-screen action** | Title card (2 s) → cut to the seeded inbox loading and filling with 30 tickets; slow push over the ticket list. End on the inbox, full. |
| **Footage** | `[CARD]` title card: "ReplyForge Hybrid — support replies that keep customer data on the device." · `[RECORD NOW — hosted build]` `video-scratch/beat1-inbox-load.webm` (tail of the recording: inbox rendered, status panel visible). |
| **Voiceover** | "If you run support for a small product, this is your morning: a wall of customer e-mail, and every reply starts from a blank box. Sending all of it to a cloud model is fast — but it means your customers' personal data leaves with every message. ReplyForge is built for that operator. It redacts personal data where it lives — on the device — and the cloud only ever drafts from the redacted summary." |

## Beat 2 — On-device proof (stills fallback, as recorded) · 0:20–0:55

| | |
| --- | --- |
| **On-screen action** | Routing diagram card full-screen. Cut to the app's own Scorecard panel from Pintu's session (still, slow push-in): 100% of 30 completed tasks on-device, median latency 9,662 ms (n = 30), 28 of 30 routes correct, 27 redactions / 0 surviving. Then the RF-003 redaction still (e-mail masked, count 1) on a captioned canvas. No network-off moment is shown or narrated — none was captured. |
| **Footage** | `[CARD]` routing diagram: `Ticket → [On device: classify · redact · draft if simple] → simple? → reply / complex, angry, long, low-confidence? → [Cloud: draft from redacted summary] → human approves`. · `[STILLS — Pintu's session]` `spec/evidence/ondevice-scorecard.png` and `spec/evidence/ondevice-rf003-redaction.png`, presented on themed canvases with captions. **Changed 13 Nov 2026 for the final cut:** the planned network-off live capture (Wi-Fi off on camera → On device chip → RF-006 awaiting-sync → promotion) never materialised — the session produced the scorecard + RF-003 stills only (tab-level offline did not trigger the app; the OS-level retry is still open) — so the stills fallback was used and the VO reworded to match exactly what is shown, per the honesty rule below. If the capture is ever recorded, this beat can be re-cut with the original VO. |
| **Voiceover** | "Watch the route, not the promise. This machine has Gemini Nano, so triage runs on the device — and the proof is the route each result reports, from Firebase AI Logic itself. On this machine, the full thirty-ticket evaluation ran on the device: thirty of thirty triages, at a median of 9,662 milliseconds, on a CPU-only machine with no GPU. The scorecard on screen is the app's own record of that run. Work finished offline waits, honestly labelled 'awaiting sync', until it can prove its route." |

## Beat 3 — PII / Privacy-Mode moment · 0:55–1:30

| | |
| --- | --- |
| **On-screen action** | RF-003 on Pintu's machine: open the redaction comparison — e-mail address masked, count 1. Cut to the RF-021 "What the cloud sees" preview: the redacted summary only, redaction count 5, gate chip **Held for review**; slow scroll over the payload fields. Then Privacy Mode **on**: attempt the RF-021 escalation → the card reads **Refused — Privacy Mode**; hold on the refusal card ("No model call was made"). |
| **Footage** | `[NEEDS PINTU SESSION — his machine/screenshots]` RF-003 redaction comparison (RUNBOOK Part B step 2). · `[RECORD NOW — hosted build]` the payload-preview scroll inside `video-scratch/beat4b-rf021-escalation.webm` (the preview segment is reused here; in the final cut it appears once, in this beat, and Beat 4 picks up at the confirm click). · `[RECORD NOW — hosted build]` `video-scratch/beat3b-privacy-escalation-refusal.webm` (recorded on the no-Nano build VM, where the refusal is the live behaviour: with Privacy Mode on, the escalation is refused before any model call — on Pintu's machine the same refusal fires for a ticket that must escalate; if his session captures it live, prefer his clip). |
| **Voiceover** | "Here is the part we cared about most. Personal data — e-mail addresses, phone numbers, order IDs, addresses, names — is found and masked by deterministic checks on the device, before any drafting or escalation is built. This panel is the whole of what the cloud would receive: the redacted summary, and nothing else; the payload has no field that could carry the raw ticket. And for the operator who cannot accept cloud processing at all, there is Privacy Mode: device-only, or the task is refused. This escalation is refused — recorded, explained, and no model call was made." |

## Beat 4 — Cloud escalation from the redacted summary · 1:30–2:15

| | |
| --- | --- |
| **On-screen action** | RF-021 (long, angry, multi-issue): triage completes (chip: In cloud on the build VM; on a Nano machine this triage may run on-device — the chip shows whichever ran); the routing decision reads **Escalation recommended — Long or complex ticket**; gate held for review because the triage model counted more personal-data items than the deterministic redaction caught, so the button reads **I reviewed the payload — confirm and escalate**; click it; the escalation result card lands: route chip **In cloud**, escalation reason shown; the draft sits in the reply editor for the human to edit before the simulated send. |
| **Footage** | `[RECORD NOW — hosted build]` `video-scratch/beat4b-rf021-escalation.webm` (full flow on the hosted build; the preview segment is shared with Beat 3 — see the note there). |
| **Voiceover** | "Some tickets should not be answered by the smallest model. This one is long, angry, and about more than one problem, so the routing engine escalates it — and it shows its reason. Notice the gate: the triage model counted more personal-data items than the redaction checks caught, so the payload is held for review, and my click on this button is that review. Only then does the cloud model draft — from the redacted summary you just saw, exactly that object — and the finished draft lands back in the editor, where a human still approves every word before anything is sent." |

## Beat 5 — Measured scorecard + close · 2:15–2:45

| | |
| --- | --- |
| **On-screen action** | Scorecard card full-screen with the figures below (the app's own Scorecard panel from Pintu's session as the background still). Quick 3-second insert: RF-001 triage completing with the **In cloud** chip (the hosted-build recording). End card: hosted URL + repo + "ReplyForge Hybrid — built with Firebase AI Logic". |
| **Footage** | `[CARD]` scorecard graphic (figures below; background still = Pintu's Part C scorecard screenshot). · `[RECORD NOW — hosted build]` `video-scratch/beat4a-rf001-triage-cloud.webm` (3-second insert for the fallback line). · `[CARD]` end card. |
| **Voiceover** | "And the numbers are measured, not claimed. Across four live runs over a labelled thirty-ticket set, the routing engine agreed with the labels twenty-seven to twenty-eight times — the misses are listed in the app, with reasons. Twenty-seven of twenty-seven labelled personal-data items were redacted; zero survived into a cloud payload. In the on-device run, all thirty of thirty triages ran entirely on the device at a median of 9,662 milliseconds, against a measured cloud median of about one second; and the same scorecard shows its offline line as zero of zero attempts on that machine — we'd rather show you the zero than stage it. And the honest fallback: on a machine without Gemini Nano — like the one this clip was recorded on — everything you just saw still works, via the cloud route, with the route shown on every card. ReplyForge Hybrid: on-device when it can, in the cloud when it should, and it shows you which — every time." |

**Scorecard figures for the card** (measured; sources in
`submission/IMPACT.md` and the app's evaluation panel):

| Figure | Value | Source |
| --- | --- | --- |
| Routing accuracy | **27–28 of 30 (90–93%)**, four live runs (three cloud, one on-device) | Evaluation runs, 13 Nov 2026 |
| Labelled personal-data items redacted | 27 of 27 | Evaluation run |
| Labelled patterns surviving into a cloud payload | 0 | Evaluation run + payload gate |
| Median latency, in cloud | 1,048 ms (n = 75 completed tasks) | Stored route events |
| Fully handled on-device | 100% — 30 of 30 completed tasks | Pintu's session scorecard |
| Median latency, on-device | 9,662 ms (n = 30) | Pintu's session scorecard |
| Offline successes | 0 of 0 attempts — not measured on the reference machine (shown as the zero, never staged) | Pintu's session scorecard |
| Cloud calls avoided | 30 (on-device completions + attempts blocked before any call) | Pintu's session scorecard |

---

## Assembly notes

- **Order:** Beat 1 → 2 → 3 → 4 → 5 as above; total 2:45, inside
  the 3:00 cap with headroom for the VO to breathe.
- **Shared segment:** the RF-021 payload preview appears in Beat 3;
  Beat 4 resumes at the confirm click. Do not show the preview
  twice.
- **Still fallbacks:** if any `[NEEDS PINTU SESSION]` clip is
  missing, use Pintu's runbook screenshots (On-device triage card,
  amber awaiting-sync card, scorecard panel) as held stills.
  Exception, applied in the final cut: where a VO line narrates a
  specific filmed action (Beat 2's network-off sequence), the VO
  MUST be reworded to match the stills actually shown — never
  narrate an unfilmed moment.
- **VO status (13 Nov):** recorded for the final cut (ElevenLabs,
  Sarah; details in `video-final/MANIFEST.md`). All `[FIGURES]`
  values are filled from Pintu's session; Beat 2's VO is the
  reworded stills-fallback text in its cell above.
