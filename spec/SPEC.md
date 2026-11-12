# SPEC — ReplyForge Hybrid

> Requirements for the #BuildHybridAI 2026 Web (Chrome) entry. Testable and implementation-free. Research basis: `research.md` (sources read 12 November 2026).

## Problem

Solo founders and small support teams answer repetitive customer tickets under time pressure, but the messages routinely contain names, addresses, telephone numbers, and order details. Sending every ticket to a cloud model is slow for simple cases, weakens the privacy story, and wastes cloud calls; keeping everything local is impossible when a thread is angry, long, or multi-issue. ReplyForge Hybrid splits the work: short, sensitive, single-turn work happens on-device where possible, and only a redacted summary of a genuinely hard ticket reaches the cloud.

## Users

- **Support operator (primary):** a solo founder or small-team agent who triages tickets, edits drafts, and approves a simulated send.
- **Judge or evaluator:** a reviewer who may never run the app and must be able to verify the hybrid claim from the video, images, description, and scorecard.
- **Privacy-conscious ticket owner:** the support lead who enables Privacy Mode for sensitive tickets and inspects exactly what would leave the device.

## Functional Requirements

- **FR-1:** The system SHALL present a seeded support inbox of exactly 30 labelled fixture tickets and SHALL allow a ticket to be added by pasting its subject and message text.
- **FR-2:** The system SHALL show the on-device model state as one of available, downloadable, downloading, or unavailable, and SHALL provide a user-activated control to initialise or download the on-device model with visible progress or failure state.
- **FR-3:** The system SHALL, for a selected ticket, produce a structured triage result containing category, urgency, sentiment, confidence, detected personal-data count, and a redacted version of the ticket content.
- **FR-4:** The system SHALL draft a reply for a simple ticket using a device-preferred route and SHALL display the draft for human editing before any send action is available.
- **FR-5:** The system SHALL escalate a ticket to a cloud-preferred route when any configured trigger is present: excessive length or complexity, negative sentiment, refund or legal intent, multiple issues, low triage confidence, or a language unsupported on-device.
- **FR-6:** The system SHALL build every cloud escalation payload from the redacted summary and ticket metadata only, and SHALL provide a “What the cloud sees” preview that displays the exact payload before escalation is confirmed.
- **FR-7:** The system SHALL block a cloud escalation if a labelled personal-data pattern remains in the proposed payload, and SHALL tell the operator whether the payload was minimised or held for review.
- **FR-8:** The system SHALL provide a Privacy Mode in which AI processing is device-only; if the device route is unavailable, it SHALL refuse processing, make no cloud call, and explain the refusal.
- **FR-9:** The system SHALL display, for every completed AI task, the actual route taken (on-device or in-cloud), the latency, the requested mode, and any escalation reason; it SHALL never derive the displayed route from the requested mode.
- **FR-10:** The system SHALL allow the operator to edit a draft and mark it as sent through a clearly labelled simulation; it SHALL NOT send a real e-mail or external message.
- **FR-11:** When the network is disabled and the device route is actually available, the system SHALL complete triage and a simple draft and SHALL label queued sends as simulated and pending; when neither route is available, it SHALL preserve the ticket in a queued or failed state with an actionable message.
- **FR-12:** The system SHALL record one route event for every AI task attempt, containing task type, requested mode, actual route or explicit failure, latency, outcome, escalation trigger, redaction count, online state, and browser/Chrome version, and SHALL record no ticket or prompt text in that event.
- **FR-13:** The system SHALL present a scorecard computed from recorded route events and the gold labels showing percentage fully handled on-device, median latency per actual route, offline successes out of attempts, cloud calls avoided, escalation accuracy, and labelled redactions caught, together with sample size, device, and Chrome version.
- **FR-14:** The system SHALL run a repeatable evaluation over all 30 fixture tickets that compares the selected route with each ticket’s gold route label and reports the aggregate result without changing the fixture labels.
- **FR-15:** The system SHALL keep each signed-in user’s tickets, drafts, and route events separate from every other user’s, and SHALL require authentication before private ticket data is shown.
- **FR-16:** The submission package SHALL include a public repository with an open-source licence, run instructions, a one-view routing diagram, a hosted demonstration, and a public English video of no more than three minutes (target: 2 minutes 45 seconds).

## Non-Functional Requirements

- **NFR-1 — Inference boundary:** 100% of AI inference calls SHALL pass through Firebase AI Logic; the number of direct calls to any other model API SHALL be zero.
- **NFR-2 — Route evidence:** 100% of completed AI tasks SHALL show the actual route returned by the inference result; a task whose route cannot be established SHALL be shown as failed, not guessed.
- **NFR-3 — Privacy of logs:** 0 route events SHALL contain ticket text, prompt text, or unmasked personal data.
- **NFR-4 — Redaction gate:** In the labelled fixture set, 100% of cloud payloads generated during evaluation SHALL be free of the labelled personal-data patterns after redaction; any failure SHALL block that payload rather than send it.
- **NFR-5 — Routing quality:** The repeatable fixture evaluation SHALL reach at least 90% escalation accuracy (at least 27 of 30 tickets routed as labelled) before submission.
- **NFR-6 — Idempotent fixtures:** Loading or refreshing the fixture set SHALL produce exactly 30 fixture tickets with stable identifiers and SHALL create zero duplicates and zero changes to operator-created tickets.
- **NFR-7 — Honest degradation:** Every AI task SHALL end in a visible success, queued, blocked, or failed state; no task SHALL remain in an unexplained loading state after its result or error is known.
- **NFR-8 — Compatibility statement:** Full hybrid behaviour SHALL be specified for desktop Chrome meeting the documented Firebase and Chrome requirements; on any other environment the system SHALL state the actual availability and SHALL still complete ordinary work by cloud fallback unless Privacy Mode is enabled.

## Out of Scope

- Real e-mail, helpdesk, CRM, chat, or social-media integrations; real sending of any message.
- Android, iOS, Chrome extension, or any second platform.
- Attachments and PDF, audio, video, or image-message processing.
- Multi-turn on-device chat, on-device tools/function calling, grounding, or Live API features.
- On-device processing in Hindi or any language outside the documented on-device language list.
- Team inboxes, roles, assignment, approval chains, service-level timers, and billing.
- A custom Node/PostgreSQL model backend or any model API outside Firebase AI Logic.
- A Google Account Quota dependency or any billing-required model.
- Invented pilot users, testimonials, market figures, latency figures, or accuracy figures.

## Judging Criteria → Requirements

The four Stage Two criteria are **equally weighted**, scored 1–5 and averaged. Technological Implementation is first in the tie-break order.

| Judging criterion | Requirements that win it | Evidence the judge can inspect |
|---|---|---|
| **Technological Implementation** | FR-2, FR-3, FR-5, FR-6, FR-7, FR-8, FR-9, FR-12; NFR-1, NFR-2, NFR-3, NFR-4 | Three meaningfully used inference modes; app-level escalation rules; actual-route logging for every task; redaction as a payload boundary; repository code in which Firebase AI Logic is imported and called. |
| **Design** | FR-1, FR-2, FR-4, FR-6, FR-9, FR-10, FR-11; NFR-7, NFR-8 | A complete inbox → triage → draft → preview → simulated-send flow, with designed available, downloading, unavailable, offline, blocked, and failed states and a persistent scorecard. |
| **Potential Impact** | FR-1, FR-4, FR-5, FR-10, FR-13, FR-14; NFR-5, NFR-6 | A named audience and one repeatable job; measured time, route-share, offline, and cloud-call results on the same labelled 30-ticket set rather than unsupported market claims. |
| **Quality of the Idea** | FR-3, FR-6, FR-7, FR-8, FR-9, FR-13 | The non-obvious claim — personal data is redacted where it lives, and the cloud sees only the redacted escalation — shown in one routing diagram, the payload preview, Privacy Mode, and the video. |
