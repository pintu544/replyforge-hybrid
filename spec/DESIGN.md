# DESIGN — ReplyForge Hybrid

> Architecture for `SPEC.md`. One hosted web application; Firebase is the only AI and data platform. No custom model backend exists.

## Architecture

**Diagram in words:** `Ticket → on-device pipeline (classify · detect and redact personal data · draft if simple) → routing decision → simple: operator edits and simulated-sends / complex: cloud draft built from the redacted summary only → route event written → scorecard`. A one-view graphic of that sentence is a submission asset and appears in the README, Devpost gallery, and video.

Components and how they talk:

- **Inbox and ticket workspace (React + TypeScript, Vite):** renders the seeded or pasted tickets, ticket detail, triage result, redacted text, draft editor, payload preview, Privacy Mode toggle, hybrid status panel, and scorecard. It calls only the application services below; it never calls a model API directly.
- **Firebase service boundary:** initialises Firebase, Authentication, Firestore, Remote Config, and App Check. App Check is active for AI Logic; its debug token is provided through local environment configuration for development and submission testing and is never treated as application data.
- **Hybrid inference service:** owns two Firebase AI Logic model handles — a device-preferred handle (`PREFER_ON_DEVICE`) and a cloud-preferred handle (`PREFER_IN_CLOUD`) — plus a device-only handle (`ONLY_ON_DEVICE`) created only for Privacy Mode. Every call returns the generated value together with the actual `response.inferenceSource` and measured latency. Structured output uses the route-appropriate configuration described in the Firebase hybrid documentation.
- **Availability controller:** reads the Chrome/Firebase availability state (`available`, `downloadable`, `downloading`, `unavailable`). Only a user gesture may call `initializeDeviceModel()`; progress and failure are surfaced in the status panel.
- **Routing engine (application code):** applies the escalation rules in GRILL Q5 to the triage result and ticket metadata. It chooses the next task and records a human-readable reason. It does not claim a route; it only requests a mode. The actual route always comes from the inference result.
- **Redaction pipeline:** produces the redacted artefact before any cloud payload can exist. Deterministic pattern checks run before and after the on-device redaction task. The cloud payload builder accepts a `RedactedEscalation` object and has no access to the raw ticket body.
- **Route-event writer and scorecard:** after each AI attempt, writes a text-free event to Firestore and derives the scorecard from those events plus fixture gold labels.

Internal contracts (there are deliberately **no custom HTTP endpoints**):

| Contract | Input | Output |
|---|---|---|
| `runTriage(ticket)` | Ticket subject/body, requested mode, online state | Structured category, urgency, sentiment, confidence, personal-data entities, redacted artefact, actual route, latency |
| `draftSimple(redactedTicket)` | Redacted subject/body, tone and prompt version | Draft text, actual route, latency |
| `buildEscalation(ticket, redacted)` | Redacted summary, category, urgency, sentiment, trigger, length and issue count | Exact cloud payload, or blocked result if a labelled pattern survives |
| `draftEscalated(payload)` | The previewed `RedactedEscalation` payload only | Draft text, actual route, latency, escalation reason |
| `writeRouteEvent(event)` | Task and route metadata only; no ticket or prompt text | Stored event identifier |

## Data Model

All private records live under the authenticated user’s Firestore partition. Timestamps on fixture records are offsets from the fixture reference time, not the moment of loading.

- **Ticket:** `id` (stable), `ownerUid`, `source` (`fixture` or `manual`), `subject`, `bodyRaw` (working copy only), `receivedAt`, `status` (inbox, triaged, draft-ready, escalated, sent-simulated, queued, blocked, failed), `triage` (category, urgency, sentiment, confidence, issueCount), `redactedSummary`, `redactionCount`, `language`, `privacyMode` (boolean), `fixture` (version and gold labels; present only for fixture tickets).
- **Personal-data entity:** `type`, `maskedValue`, `count`, and character span within the working ticket. The raw value is not duplicated outside the ticket body, and no entity value is written to a route event.
- **RedactedEscalation:** `redactedSummary`, `category`, `urgency`, `sentiment`, `escalationTrigger`, `issueCount`, `bodyCharacterCount`, `redactionCount`. This is the complete cloud payload contract; a raw-body field does not exist on the type.
- **Draft:** `id`, `ticketId`, `text`, `requestedMode`, `actualSource`, `latencyMs`, `escalationReason` (nullable), `state` (draft, edited, sent-simulated), `updatedAt`.
- **RouteEvent:** `id`, `ticketId`, `taskType` (triage, redaction, simple-draft, escalation-draft, evaluation), `requestedMode`, `actualSource` (`ON_DEVICE`, `IN_CLOUD`, or null on failure), `latencyMs`, `outcome` (success, fallback, blocked, failed), `escalationTrigger` (nullable), `redactionCount`, `online`, `browserFamily`, `chromeVersion`, `createdAt`. **No text fields from the ticket or prompt are permitted.**
- **EvaluationRun:** `id`, `fixtureVersion`, `ticketCount`, `correctRoutes`, `accuracy`, `labelledRedactions`, `survivingLabelledPatterns`, `deviceDescription`, `chromeVersion`, `createdAt`. Individual comparisons remain reproducible from fixture labels and route events.

**Remote Config parameters:** `escalation_length_chars`, `escalation_confidence_min`, `escalation_keywords_version`, `device_model_name`, `cloud_model_name`, `triage_prompt`, `draft_prompt`, and `escalation_prompt`. Safe defaults ship in code so the app remains usable if Remote Config cannot be fetched.

## Key Decisions

- **Decision:** React + TypeScript + Vite single-page web app — **Rationale:** matches the Web (Chrome) category, the entrant’s strength, and a short frozen build. _(Rejected: Next.js or a Node service — extra infrastructure with no judging benefit, and a model-calling backend would risk the “all inference through Firebase AI Logic” rule.)_
- **Decision:** Firestore for tickets, drafts, and route events — **Rationale:** it is a named, encouraged Firebase product and gives per-user persistence without a second platform. _(Rejected: PostgreSQL — familiar, but it fragments the Firebase story and adds hosting and secrets.)_
- **Decision:** Two standing model handles plus application routing rules — **Rationale:** copies Firebase’s published short/simple versus long/complex pattern and makes routing inspectable. _(Rejected: a single `PREFER_ON_DEVICE` call for everything — the SDK fallback alone would not demonstrate escalation judgement or win the tie-breaking Technology criterion.)_
- **Decision:** Redaction artefact as the only bridge to the cloud — **Rationale:** privacy becomes a type and data-flow property that tests can enforce, rather than wording in a prompt. _(Rejected: sending the raw ticket with an instruction to ignore personal data; also rejected: redaction after the cloud draft, which is too late.)_
- **Decision:** Privacy Mode is opt-in and uses `ONLY_ON_DEVICE` — **Rationale:** refusal is the honest behaviour for device-only processing. _(Rejected: making device-only the global default — most judges’ machines would then appear broken; also rejected: silently falling back to cloud in Privacy Mode, which would falsify the mode’s promise.)_
- **Decision:** Seeded fixture plus paste-in, with simulated send — **Rationale:** a complete, repeatable demonstration without integration risk. _(Rejected: Gmail/helpdesk integration and real sending — high setup cost, credential risk, and no additional hybrid evidence.)_
- **Decision:** Self-logged Firestore scorecard — **Rationale:** Firebase monitoring shows no on-device data, so self-logging is the only route to measured claims. _(Rejected: Firebase console metrics and token-based cost estimates — the first is blind on-device and the second is unreliable across routes.)_
- **Decision:** Web only — **Rationale:** a polished single platform can win Best Web/Chrome; splitting 18 part-time days across platforms weakens every criterion. _(Rejected: adding Android or iOS for the Grand Prize “strong consideration” — scope risk outweighs the upside for a solo entry.)_

## Risks

1. **The judge’s machine has no Gemini Nano.** Hardware, disk, browser, flags, or an unfinished multi-gigabyte download may make the device route unavailable. **De-risking:** cloud fallback is a designed, labelled route for all ordinary work; the status panel explains each availability state; the video proves the on-device route with the network off; testing instructions state the Chrome and hardware requirements. No core flow depends on `ONLY_ON_DEVICE` except opt-in Privacy Mode.
2. **A redaction miss destroys the central claim.** A model-only redaction step can overlook a personal-data pattern, and one surviving pattern in a cloud payload contradicts the product’s premise. **De-risking:** deterministic pattern checks before and after redaction; the payload builder cannot access the raw body; the preview shows the exact payload; the 30-ticket evaluation fails on any surviving labelled pattern and blocks that escalation.
3. **The on-device capability ceiling breaks an over-ambitious design.** On-device generation is single-turn text only, with no chat, tools, grounding, or PDF/audio/video input, a runtime-only context limit, and no Hindi support. **De-risking:** every device task is a short, single-turn structured generation over an app-assembled summary; long, multi-turn, or unsupported-language work is a designed cloud escalation; the throwaway SDK spike in TASKS verifies availability, structured output, and `inferenceSource` on the real development machine before the full build commits to the flow, and is deleted rather than promoted into the implementation.
