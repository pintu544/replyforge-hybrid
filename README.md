# ReplyForge Hybrid

A hybrid on-device/cloud support-reply studio for the
[#BuildHybridAI 2026](https://devpost.com) hackathon (Google). Short,
sensitive, single-turn work — triage, personal-data redaction, simple
drafts — runs on-device with Gemini Nano where the browser supports
it. Genuinely hard tickets escalate to a cloud model, and the cloud
receives only a redacted summary, never the raw ticket. Every AI call
goes through **Firebase AI Logic**, and every result card shows the
route that *actually* ran, read from the inference result itself —
never from the mode that was requested.

**Hosted demonstration:** [HOSTED URL — added after the Slice 4 deploy]
**Status:** pre-submission draft. The measured figures below are
marked for a final refresh after the on-device measurement session on
the operator's own machine.

## Routing, in one view

```
Ticket
  → on-device pipeline: classify · detect and redact personal data · draft if simple
  → routing decision (application rules, each with a named reason)
      simple  → operator edits → simulated send
      complex → cloud draft built from the redacted summary ONLY
  → text-free route event written to Firestore
  → scorecard computed from those events
```

Privacy Mode is the strict variant: with it on, any task that cannot
run on-device is **refused and the refusal recorded** — nothing is
sent to the cloud, and an escalation (cloud by definition) is refused
too.

## Who it is for

Small support teams and solo operators who answer customer e-mail
themselves: people who cannot send raw customer messages to a cloud
model in good conscience, but who also cannot write every reply from
scratch. ReplyForge triages each message, removes the customer's
personal data on the device with deterministic checks, drafts the
straightforward replies with the smallest sufficient model call, and
escalates the hard ones — angry, long, multi-issue, refund-or-legal,
low-confidence, or written in a language the on-device model does not
support — to the cloud with a named reason, using the redacted
summary only.

## How Firebase AI Logic is used

All inference goes through the Firebase AI Logic JavaScript SDK
(`firebase/ai`, Gemini Developer API backend). There is no custom
model backend and no direct model-API call anywhere in the codebase.

- `src/lib/firebase.ts` initialises the app, Authentication,
  Firestore, App Check, and the AI handle (`getAI` with
  `GoogleAIBackend`).
- `src/services/inference.ts` owns the three model handles, one per
  Firebase `InferenceMode`:
  - `PREFER_ON_DEVICE` — the standing handle for triage and simple
    drafts (Gemini Nano in Chrome when available, cloud fallback
    otherwise);
  - `ONLY_ON_DEVICE` — created only for Privacy Mode;
  - `PREFER_IN_CLOUD` — the escalation handle.
- Every call returns the generated value together with the actual
  `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) and the
  measured latency. That actual source — not the requested mode — is
  what the route chip on every result card displays and what the
  scorecard counts.
- App Check is active for AI Logic. Local development uses the SDK
  debug-token path (token supplied by local environment
  configuration, never committed); a production attestation
  registration (reCAPTCHA v3 / Fraud Defense) replaces it for the
  hosted build.
- Routing thresholds, keyword-set version, model names, and the
  triage, draft, and escalation prompts are **Firebase Remote Config**
  parameters (`src/services/appConfig.ts`), merged per field over
  in-code defaults that reproduce the same behaviour if Remote Config
  cannot be fetched. `remoteconfig.template.json` in this repository
  is generated from those defaults, and a test asserts template and
  code never drift apart.

## Hybrid routing design

The router is application code, not a prompt. Entry points:

| Concern | Code |
| --- | --- |
| Model handles and route evidence | `src/services/inference.ts` |
| Route resolution and Privacy Mode refusal | `src/services/taskRouting.ts` |
| Triage (structured, single-turn) | `src/services/triage.ts` |
| Deterministic personal-data detection and masking | `src/services/redaction.ts` |
| Cloud-payload safety gate and preview | `src/services/payload.ts` |
| Routing engine (escalation triggers) | `src/services/routing.ts` |
| Cloud escalation from the redacted payload | `src/services/escalation.ts` |
| Simple drafts (built from the redacted artefact only) | `src/services/drafts.ts` |
| Text-free route events | `src/services/routeEvents.ts` |
| 30-ticket evaluation runner | `src/services/evaluation.ts` |
| Scorecard (pure computation over stored data) | `src/services/scorecard.ts` |

**The redaction boundary is a type, not an instruction.** Redaction
is deterministic local code (`redaction.ts`): labelled patterns for
e-mail addresses, telephone numbers, order identifiers, payment
references, postal addresses, and names in common introduction,
delivery, and sign-off forms are masked before any cloud payload can
exist. The cloud payload type, `RedactedEscalation`, has **no
raw-body field**; the payload builder accepts only the branded
redacted artefact, and a pre-send scan blocks the payload if a
labelled pattern survives. The operator sees the exact payload in the
“What the cloud sees” preview before confirming an escalation, and
the escalation consumes the identical object that was previewed. If
the triage model's personal-data count exceeds the deterministic
redaction count, the gate holds the payload for review and the
operator's confirmation click is that review.

**Escalation triggers** (fixed priority, each with a human-readable
reason): unsupported on-device language → refund/legal keywords
(scanned on the *redacted* text only) → length/complexity (redacted
body over the configured character threshold) → multiple issues →
angry sentiment → confidence below the configured minimum.

**Instrumentation precedes claims.** After each AI attempt the app
writes a text-free route event (task type, requested mode, actual
route, latency, outcome, trigger, redaction count, online state,
browser and Chrome version — never ticket or prompt text) to the
user's own Firestore partition. Firebase's monitoring shows no
on-device data, so this self-logged record is the only source of the
published figures.

**The honest median case.** A machine without Gemini Nano is the
median judge machine, and the app is designed for it: ordinary work
falls back to the cloud *visibly*, with the actual route on the card.
Triage classifies the ticket itself, so on such a machine triage runs
in the cloud and the ticket text goes to Firebase AI Logic — the app
says so on the triage card and in its header copy. Only Privacy Mode
refuses to work that way.

## Measured scorecard

Measured against a labelled 30-ticket fixture (fixture version 1) of
synthetic tickets, with every figure computed from stored route
events or an evaluation run — no figure is typed in by hand.

- **Routing accuracy: 27–28 of 30 tickets (90–93%)** across three
  live evaluation runs (13 November 2026). We report the band, not
  the best run: the disagreements (RF-015, RF-017, and RF-022 in one
  run) are live-model variance in issue counts and confidence, listed
  with their reasons in the app's evaluation panel.
- **Labelled personal-data items redacted: 27 of 27**; labelled
  patterns surviving into a cloud payload: **0**.
- **Median latency, in cloud: 1,048 ms** (n = 75 completed tasks,
  headless Chromium on a machine with no on-device model).
- [REFRESH after the on-device session] Fully handled on-device,
  median on-device latency, and offline successes — to be measured on
  the operator's machine (Ubuntu, Chrome 155, Gemini Nano available),
  route-proven via `inferenceSource`, with sample size, device, and
  Chrome version stated alongside.

## Run it locally

Prerequisites: Node.js 20+ and npm. For the on-device route: desktop
Chrome 139+ on a machine meeting the Gemini Nano hardware bar
(≥ 22 GB free disk; GPU with > 4 GB VRAM, or ≥ 16 GB RAM with ≥ 4 CPU
cores), an unmetered connection for the one-time multi-gigabyte
model download, and the Prompt API flag enabled
(`chrome://flags/#prompt-api-for-gemini-nano`). Without Nano the app
still runs end-to-end on the labelled cloud fallback.

```sh
npm install
cp .env.example .env   # fill in your own Firebase web app config
npm run dev            # Vite dev server
```

The `.env` values are a Firebase **web** configuration (client
identifiers, not secrets) from the Firebase Console → Project
settings → Your apps → Web app. For local AI Logic calls, register
an App Check debug token as described in `.env.example`. Seeded
fixture tickets load per signed-in user; sending is simulated by
design — no real e-mail integration exists.

Checks:

```sh
npm test        # Vitest suite (114 tests)
npm run typecheck
npm run lint
npm run build   # production bundle in dist/
```

Deployment (Firebase Hosting) and the Remote Config console publish
are documented step-by-step in `spec/RUNBOOK-ONDEVICE.md`.

## Layout

- `src/` — the web app (React + TypeScript + Vite): components,
  services, and the Firebase boundary in `src/lib/`.
- `fixtures/tickets.json` — the labelled 30-ticket evaluation fixture
  (all personal data in it is synthetic).
- `spec/` — the spec pack (SPEC, DESIGN, TASKS), slice QA reports,
  live-verification records, and the on-device session runbook.
- `submission/` — the impact evidence pack feeding the Devpost draft.

## Licence

Apache License 2.0 — see [LICENSE](LICENSE). Copyright 2026 Pintu Kumar.
