# SPIKE VERDICT — T-1.1 Throwaway Hybrid SDK Spike

> Date: 12 November 2026. The spike was a disposable Playwright script run on this development VM and deleted after the verdict was recorded. Nothing from the spike was promoted into the implementation.

## Question

On the real development machine, can the on-device route be observed: Chrome version, model availability state, one structured-output result, and an observed `inferenceSource`?

## What was probed

| Target | Version | `LanguageModel` (Prompt API) | Availability state |
|---|---|---|---|
| Playwright headless shell (Chromium) | 140.0.7339.16 | **Not present** (`window.LanguageModel` and `window.ai` both undefined) | Cannot be queried — the API is not exposed in the headless shell |
| Muse Browser (managed Chromium) | 157.0.8103.77 | Not scriptable from this VM (managed browser refuses external automation launch) | Not observable from here |

Machine facts: Linux VM, 4 CPU cores, ~7.9 GB total RAM, **no GPU device** (`/dev/dri` absent), 118 GB free disk on the home volume.

## Verdict: on-device route is UNAVAILABLE on this machine

- The documented Gemini Nano hardware bar is a GPU with more than 4 GB VRAM **or** 16 GB RAM with at least 4 CPU cores, plus 22 GB free disk. This VM passes only the disk test. It fails the memory/GPU test outright, so even a full desktop Chrome here would be expected to report `unavailable`.
- In the scriptable Chromium (headless shell 140), the Prompt API surface does not exist at all, so no availability state, structured-output result, or `inferenceSource` could be observed on-device. **No on-device observation is claimed anywhere in this project from this machine.**
- The Firebase-side observation (a structured triage call through Firebase AI Logic returning `response.inferenceSource`) could not be run during the spike because the live web-app configuration and AI Logic enablement were still being set up in the Firebase console in parallel. That observation is deferred to the first live-config verification and will be recorded here when it happens. Until then, `IN_CLOUD` evidence from this machine is expected — cloud fallback is the designed median path (GRILL Q7), not a failure.

## Addendum — 12 November 2026, live-config verification

The live web configuration arrived and the app was run locally against the real project (`replyforge-hybrid`, AI Logic enabled on the Gemini Developer API free tier):

- The app boots with the real configuration; the status panel truthfully reports the on-device model as **unavailable** in the probe browser (HeadlessChrome 140), with the signed-in and signed-out states both rendering.
- The App Check SDK printed its debug token in the browser console on first run. The token value is a secret: it was relayed to the parent agent for registration in the console (App Check → Apps → Manage debug tokens) and pinned in the local, gitignored `.env`; it is not recorded in this repository.
- A raw structured call through the app's own Firebase adapter **did not complete within 45 seconds** and returned no `inferenceSource`. All Google API hosts involved (App Check, Generative Language, Identity Toolkit, Firestore) answer through this VM's egress in ~1.3–1.9 s, so plain connectivity is not the cause. The open blocker is the App Check token exchange for the not-yet-registered debug token, which the SDK retries without a prompt error. **No cloud-route observation is claimed yet either** — the first observed `inferenceSource` will be recorded here after the debug token is registered and the repo's Firestore rules are deployed.

## Consequences locked into the build

1. The availability controller must treat a missing `LanguageModel` object as `unavailable`, not as an error.
2. All Slice 1 route evidence produced on this machine will be cloud-route evidence; on-device proof requires Pintu's PC (see the PC specification checklist already sent) or another qualifying machine.
3. Structured output is requested through Firebase AI Logic's schema support, with a parse-and-validate step and a visible failed state — never an assumption that the first response parses.
