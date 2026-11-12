# ReplyForge Hybrid — impact draft

*Draft for the Devpost submission (feeds T-4.4). Every figure below is
measured and traces to a stored route event or an evaluation run in the
app — none is typed in from memory. Figures marked [REFRESH] must be
re-measured in the Slice 4 on-device session on the operator's own
machine (the only machine available to this project with Gemini Nano)
before the submission is filed.*

## Who it is for

Small support teams and solo operators who answer customer e-mail
themselves: people who cannot send raw customer messages to a cloud
model in good conscience, but who also cannot spend their day writing
every reply from scratch. ReplyForge is built for that operator. It
triages each message, removes the customer's personal data on the
device with deterministic checks, drafts the straightforward replies
with the smallest sufficient model call, and escalates the hard ones —
angry, long, multi-issue, refund-or-legal, low-confidence, or written
in a language the on-device model does not support — to the cloud with
a named reason, using the redacted summary only.

## The measured scorecard (13 November 2026)

Measured in headless Chromium 140.0.7339.16 on a machine with no
on-device model, against fixture version 1 (the labelled 30-ticket
set), with all AI inference through Firebase AI Logic
(`gemini-3.5-flash-lite` in cloud):

| Figure | Measured value | Source |
| --- | --- | --- |
| Routing accuracy | 28 of 30 tickets (93.3%) | Evaluation run, 13 Nov 2026 |
| Labelled personal-data items redacted | 27 of 27 | Evaluation run |
| Labelled patterns surviving into a cloud payload | 0 | Evaluation run + payload gate |
| Triage routes in that run (actual) | 0 on-device · 30 in cloud · 0 failed | `inferenceSource` per call |
| Median latency, in cloud | 1,048 ms (n = 75 completed tasks) | Stored route events |
| Fully handled on-device | 0% of 75 completed tasks | Stored route events |
| Median latency, on-device | No on-device completions yet (n = 0) | Stored route events |
| Offline successes | 0 of 3 attempts | Stored route events |
| Cloud calls avoided | 2 (attempts blocked before any call) | Stored route events |

How to read the two honest zeroes: this machine cannot run Gemini
Nano, so every task fell back to the cloud — visibly, with the actual
route on every result card — and Privacy Mode attempts were refused
rather than sent anywhere. The on-device figures below are the ones
the Slice 4 session exists to measure:

- [REFRESH] Fully handled on-device (share of completed tasks) — after
  the on-device session on the operator's machine.
- [REFRESH] Median latency, on-device — same session.
- [REFRESH] Offline successes out of attempts — same session, with the
  network off.

## What the disagreements were

Accuracy is the routing engine's agreement with the fixture labels,
given the triage the live model actually produced. The two
disagreements in the 28/30 run (RF-015, RF-017) were model variance:
the model counted two issues in tickets labelled as single-issue, so
the engine escalated them. They are listed, with their reasons, in the
app's evaluation panel — the scorecard shows its workings, not just
its headline.

A first evaluation run scored 17 of 30 because the free tier's
15-requests-per-minute limit quota-failed twelve triages. That run is
kept in the app as the previous run; the runner now paces itself and
retries a quota failure once, and both attempts keep their route
events.

## The claim, scoped precisely

Drafts and escalations are built only from the redacted summary —
that is a property of the code path (the payload type has no raw-body
field), verified by tests that assert the exact payload shape. The
redaction guarantee covers the labelled pattern types of the
evaluation set: e-mail addresses, telephone numbers, order identifiers,
payment references, postal addresses, and names in common
introduction, delivery, and sign-off forms. Triage classifies the
ticket itself, so on a machine with no on-device model triage runs in
the cloud and the ticket text goes to Firebase AI Logic; the app says
so on the triage card and in its header copy. Privacy Mode exists for
the operator who cannot accept that: with it on, a task that cannot
run on-device is refused and the refusal recorded — nothing is sent.

## Testimonials

None. No pilot user feedback has been supplied, so this draft contains
no testimonials and no invented user claims.
