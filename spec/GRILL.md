# GRILL — ReplyForge Hybrid

> Pre-build interrogation for the #BuildHybridAI 2026 entry. Ten hard questions, answers locked before implementation. Anything not decided here is out of scope, not “to be decided”.

## Q1 — What is the completion evidence?

**Answer:** One continuous demo proves the product. A simple seeded ticket is triaged and drafted with the network disabled, with an **ON_DEVICE** route chip and latency visible. A sensitive ticket has its personal data redacted on-device and, with Privacy Mode on, is refused cloud processing when the device route is unavailable. An angry, long, multi-issue ticket escalates to the cloud from the redacted summary only, with the reason shown. The closing scorecard reports measured results across the 30-ticket gold set. If any of those four beats cannot be shown truthfully, the build is not complete.

## Q2 — Who is it for, on which platform, and how narrow is the scope?

**Answer:** Solo founders and small support teams handling customer email-style tickets, especially indie SaaS and small commerce sellers. **Web on desktop Chrome only.** The frozen product is a seeded inbox plus paste-in tickets, human editing, and simulated send. There are no mailbox integrations, no real sending, no mobile app, no Chrome extension, and no second platform.

## Q3 — What stack and repository layout are locked?

**Answer:** One React + TypeScript web application built with Vite, using the Firebase AI Logic JavaScript SDK **v12.5.0 or later**. Firebase provides AI Logic, App Check, Authentication, Firestore, Remote Config, and Hosting. There is no Node model backend and no PostgreSQL: all AI inference goes through Firebase AI Logic. Layout is `src/` for the app, `fixtures/` for the versioned gold set, `spec/` for this pack, and a top-level README carrying the routing diagram and run instructions.

## Q4 — Where does data live, and what is the privacy boundary?

**Answer:** Firestore holds the signed-in user’s tickets, drafts, redacted artefacts, and route events. The raw ticket body exists only as the user’s working ticket in Firestore; it is **never** copied into route logs, metrics, the README, or the submission. The cloud escalation payload is built from a separate redacted-summary artefact, never from the raw body. Route events record route, task, latency, outcome, trigger, redaction count, online state, browser and Chrome version — never prompt or ticket text.

## Q5 — Who decides the route: the SDK or the app?

**Answer:** Both, explicitly. The app holds a device-preferred model handle (`PREFER_ON_DEVICE`) for short, single-turn triage, redaction support, and simple drafts, and a cloud-preferred handle (`PREFER_IN_CLOUD`) for escalation. App-level rules escalate on length or complexity, negative sentiment, refund or legal intent, multiple issues, low classification confidence, or a language unsupported on-device. The SDK decides availability and fallback inside each mode. The interface always displays the **actual** route from `response.inferenceSource`; the requested mode is never presented as proof.

## Q6 — How is redaction made trustworthy rather than a prompt instruction?

**Answer:** Redaction is a separate pipeline stage and a data-boundary rule, not a request to a model to “be careful”. Structured patterns for e-mail addresses, telephone numbers, order identifiers, payment references, postal addresses, and similar labelled entities are checked before and after the on-device redaction step. If a labelled pattern still appears in the escalation payload, escalation is blocked and the payload is minimised or the ticket is held for human review. The “What the cloud sees” preview shows the exact payload that will be sent. In the gold-set evaluation, a surviving labelled entity is a failing test, not a warning.

## Q7 — What happens on a judge’s machine without Gemini Nano?

**Answer:** That is the expected median case, not an error case. The status panel states one of `available`, `downloadable`, `downloading`, or `unavailable`. A user-gesture “Enable on-device AI” action calls `initializeDeviceModel()` and shows download progress. If Nano is absent, ordinary work continues through cloud fallback with an **IN_CLOUD** chip. Privacy Mode is the sole exception: with `ONLY_ON_DEVICE`, the app refuses AI processing and explains why. Core workflows are never silently blocked by the absence of Nano.

## Q8 — What Firebase and deployment decisions are locked?

**Answer:** Firebase AI Logic is the only inference path. App Check is enabled; a debug token is used only for local and submission testing and is supplied through local environment configuration, never committed as a secret. Authentication is Google sign-in, and Firestore data is partitioned by user. Remote Config owns escalation thresholds, model selection, and prompt text, with safe in-code defaults if configuration cannot load. The public demo is deployed to Firebase Hosting. No billing-required model and no Google Account Quota are part of the plan; text inference stays on the free route described in the research.

## Q9 — How will claims be measured without inventing numbers?

**Answer:** Instrumentation is built on day one, before the scorecard screen. Every AI task writes a route event containing the actual `inferenceSource`, latency, requested mode, task type, outcome, escalation trigger, redaction count, and online state. Published measures are: percentage fully handled on-device; median latency per actual route; offline successes out of attempts; cloud calls avoided; escalation accuracy against the 30 labelled tickets; and labelled redactions caught. Claims state the sample size, device, and Chrome version. Hybrid `countTokens` is not used for cost claims because the report says it is unreliable across routes; cloud *calls* are counted instead.

## Q10 — What is explicitly deferred, and what is the submission strategy?

**Answer:** Deferred: real e-mail or helpdesk integrations, real sending, attachments and PDF/audio/video input, multi-turn on-device chat, tools or grounding, non-English on-device processing, team roles, billing, analytics beyond the scorecard, iOS, Android, and any quota-account dependency. The target is **Best Web/Chrome and a Runner-Up placing**, not a multi-platform Grand Prize chase. Submission is targeted for **29 November 2026**, one day before the deadline, with the final day held as buffer. Pintu’s approval of SPEC, DESIGN, and TASKS is required before implementation code is written.
