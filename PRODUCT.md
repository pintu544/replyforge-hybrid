# PRODUCT — ReplyForge Hybrid

> Captured from the approved spec pack (`spec/SPEC.md`, `spec/GRILL.md`, approved by Pintu Kumar 12 November 2026). Assumptions are labelled as such; nothing here overrides the spec.

## What it is

A web support-reply studio for solo founders and small support teams. Short, sensitive, single-turn work — triage, personal-data redaction, simple drafts — happens on-device where the browser supports it. Genuinely hard tickets (angry, long, multi-issue, refund/legal, unsupported language) escalate to a cloud model, and the cloud receives only a redacted summary, never the raw ticket.

## Who it serves

- **Support operator (primary):** a solo founder or small-team agent triaging email-style tickets under time pressure.
- **Judge or evaluator:** may never run the app; must be able to verify the hybrid claim from the video, images, description, and scorecard.
- **Privacy-conscious ticket owner:** enables Privacy Mode and inspects exactly what would leave the device.

## The claim it must prove

Personal data is redacted where it lives, the actual route of every AI task is shown from the inference result itself (never from the requested mode), and every published figure is measured on a labelled 30-ticket fixture — sample size, device, and browser version stated.

## Surface

One Operate-mode desktop web app (Chrome first): inbox → ticket workspace → triage → (later slices: draft, payload preview, scorecard). Quiet, exact, instrument-like chrome; the route evidence is the product's signature detail.

## Assumptions (labelled)

- Fixture tickets stand in for a real inbox in this hackathon build; sending is simulated by design, not omission.
- The median judge machine has no on-device model; cloud fallback is a first-class, labelled path, not an error.
