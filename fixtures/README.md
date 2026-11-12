# Fixture contract — tickets.json (version 1)

The gold set every measured claim in ReplyForge Hybrid is made against.

- **File:** `fixtures/tickets.json`, `fixtureVersion: 1`.
- **Records:** exactly 30, stable IDs `RF-001` to `RF-030`. IDs never change and are never reused.
- **Reference time:** `2026-11-12T10:00:00+05:30`. Each record stores `receivedOffsetMinutes` (negative: minutes before the reference time); the loader derives `receivedAt = referenceTime + offset`. Loading time never affects fixture timestamps.
- **Fields per record:** `subject`, `body`, `category`, `urgency`, `sentiment`, `issueCount`, `language` (ISO code), `expectedRoute` (`device` or `cloud`), `escalationTrigger` (null for device-labelled tickets), and `personalData` (labelled types with item counts).
- **Distribution:** 18 device-labelled, 12 cloud-labelled; 17 records contain synthetic personal data. Cloud coverage: angry/negative sentiment, refund/legal intent, long or complex, multiple issues, ambiguous (low-confidence), and unsupported on-device languages (Hindi `hi`, Bengali `bn`).
- **Personal data:** every name, address, telephone number, e-mail address, order identifier, and payment reference in this fixture is **synthetic** — invented for evaluation, belonging to no real person. Label counts count distinct items in the ticket (subject plus body), not repeated mentions.
- **Refresh semantics:** loading creates only missing fixture IDs. A reload creates zero duplicates, never modifies an existing ticket (including its gold labels and any triage result), and never touches operator-created (`manual`) tickets.
- **Changing the fixture** means a new `fixtureVersion` and a note in this file; evaluation runs record the version they used.
