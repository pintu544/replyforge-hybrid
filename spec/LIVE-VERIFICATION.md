# LIVE VERIFICATION — Slice 1 (12 November 2026)

> What was actually observed running the app against the live Firebase project `replyforge-hybrid`, and what remains pending on console-side steps. Secrets (including the App Check debug token value) are never recorded here.

## Observed

- Dev server: Vite on **http://localhost:5173** (port checked free before start, per the dev-server protocol; bound to `localhost`, PID recorded in the run report).
- The app boots with the real web configuration (env placeholders replaced locally; `.env` is gitignored).
- Signed-out state renders: header, hybrid status panel, Google + email sign-in panel, and the explainer panel. Signed-in/signed-out states are both implemented; the signed-in inbox click-through is Pintu's step at the T-1.10 gate (his credentials are never entered by the agent).
- The hybrid status panel truthfully reports **"On-device model unavailable"** in the probe browser (HeadlessChrome 140.0.7339.16), with browser, network, and route-proof facts shown. This matches the spike verdict for this machine.
- App Check initialises in debug mode and the SDK printed its debug token in the browser console. The token was relayed to the parent agent for console registration and pinned in the local `.env` so this machine reuses the same token.
- A raw structured AI Logic call through the app's own adapter did not complete within 45 s (see `SPIKE-VERDICT.md` addendum). Google API hosts are reachable through this VM's egress (~1.3–1.9 s each), so the blocker is the unregistered debug token's App Check exchange, not connectivity.

## Pending (console-side, sequenced by the parent agent)

1. Deploy this repo's `firestore.rules` (final — per-user partition, default deny) over the console's deny-all placeholder. Until then, live Firestore reads/writes return permission errors and the app shows its inbox error banner after sign-in.
2. Register the App Check debug token in the console. Until then, AI Logic calls cannot complete, so T-1.8's live route event in Firestore cannot be observed.
3. After 1 and 2: re-run the live verification — sign in (Pintu), confirm the fixture loads 30 tickets, run triage on one ticket, and confirm the route event and the observed `inferenceSource` in Firestore. Then T-1.7 and T-1.8 can be checked off and this file updated.

## Automated evidence (not live-dependent)

- `npm test`: 22/22 passed — fixture contract (T-1.3), loader idempotency (T-1.4), route-event shape and no-text rule (T-1.5), availability mapping/controller (T-1.6), triage success/fallback/no-route/forced-error paths (T-1.8).
- `npm run typecheck`, `npm run lint`: clean. `npm run build`: succeeds (one informational chunk-size warning for the Firebase SDK bundle; code-splitting is a Slice 4 polish item).
- Impeccable detector over the UI files: zero findings.
