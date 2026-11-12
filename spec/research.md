# RESEARCH — ReplyForge Hybrid

> Condensed capture from `~/workspace/research_notes/buildhybridai-how-to-win-2026-20261112-1508/report.md`. All web sources were read on **12 November 2026**. “Official” means Devpost, Firebase, or Chrome documentation; tournament scores and the recommendation are research inference, not organiser rules.

## Contest facts (official)

- **Event:** #BuildHybridAI 2026, sponsored by Google LLC and administered by Devpost. Submission period: **11 November 2026, 1:30 PM PT to 30 November 2026, 2:00 PM PT** — 1 December 2026, 3:30 AM IST. Judging: 10–16 December. Winners expected on or around 21 December.
- **Eligibility:** Individuals, teams, and organisations may enter; entrants must be above the age of majority. India is not on the exclusion list (excluded places include Brazil, Italy, Quebec, Russia, Iran, and North Korea), so a solo entry from India is eligible.
- **Prizes (total US$30,000, six prizes):** Grand Prize US$10,000; 1st Runner-Up US$7,000; 2nd Runner-Up US$4,000; Best iOS, Best Android, and Best Web/Chrome US$3,000 each. A submission may win a top prize and up to one Best-of prize, so the theoretical maximum for this web entry is US$13,000. No separate bonus categories were published in the rules or prize list checked on 12 November.
- **Field:** The live Devpost page showed **1,605 participants** on 12 November. Registrations are not submissions; the report’s low-hundreds estimate for actual submissions is inference from earlier contests, not a published figure for this contest.

Sources: [Devpost overview](https://firebasehybridaihackathon.devpost.com/) · [Official Rules](https://firebasehybridaihackathon.devpost.com/rules) · [Resources](https://firebasehybridaihackathon.devpost.com/resources)

## Judging (official, Rules §8)

- **Stage One** is pass/fail: submission requirements met and the challenge reasonably addressed.
- **Stage Two** uses four **equally weighted** criteria, each scored 1–5 and averaged: **Technological Implementation**, **Design**, **Potential Impact**, and **Quality of the Idea**.
- Ties are broken in the order listed, which makes Technological Implementation the effective tie-breaker. Judging may involve expert panels, peer review, automated AI-driven analysis, or a combination.
- **Judges are not required to test the project** and may judge solely from the text description, images, and video. The video and write-up are therefore primary evidence, not supporting material.

Source: [Official Rules](https://firebasehybridaihackathon.devpost.com/rules)

## Deliverables (official, overview and Rules §6)

- Select at least one platform. This entry selects **Web (Chrome)**.
- Provide a text description covering the use of Firebase AI Logic, features and functionality, and the value proposition.
- Provide a public GitHub or GitLab repository with all source, assets, and instructions. Firebase AI Logic must be imported and **actually called at runtime**, not merely named in the README.
- Include an open-source licence file detectable at the top of the repository page; Apache is preferred, but any open-source licence is accepted.
- Provide a public YouTube demo video in English or with English subtitles. It must be **no longer than three minutes**; only the first three minutes may be evaluated.
- The project must be available free of charge and all submission materials must be in English. A hosted project is highly encouraged, not required.
- Do not place production keys, live Google Cloud secrets, confidential data, or personal data in the repository or submission.

Sources: [Devpost overview](https://firebasehybridaihackathon.devpost.com/) · [Official Rules](https://firebasehybridaihackathon.devpost.com/rules)

## Hybrid mandate and Firebase surface (official)

- All AI inference must go through **Firebase AI Logic**; direct calls to other model APIs are prohibited. For Web, the on-device route is Gemini Nano via Firebase AI Logic in a web app or Chrome extension.
- The expected pattern is: run on-device when a local model is available and fall back to the cloud when it is not. Multi-platform entries receive “strong consideration” for the Grand Prize, but the official text also says an outstanding single-platform app can still win.
- **App Check is required** for Firebase AI Logic; debug tokens are accepted in submissions. Authentication, Firestore, and Remote Config are encouraged supporting products.

Sources: [Devpost overview](https://firebasehybridaihackathon.devpost.com/) · [Resources](https://firebasehybridaihackathon.devpost.com/resources)

## Firebase AI Logic hybrid: technical reality (official docs)

- Web hybrid inference requires Firebase AI Logic **SDK v12.5.0+** and **Chrome Desktop 139+**. On-device inference uses Chrome’s Prompt API.
- Modes are `PREFER_ON_DEVICE` (fall back to cloud), `ONLY_ON_DEVICE` (throw if unavailable), `PREFER_IN_CLOUD` (fall back on-device), and `ONLY_IN_CLOUD` (throw if unavailable).
- `result.response.inferenceSource` reports the actual route as `ON_DEVICE` or `IN_CLOUD`. This is the source for the route chip and scorecard.
- The default cloud fallback model is `gemini-3.5-flash-lite` from JS SDK v13.0.0, overridable through `inCloudParams`. Structured output is supported on both routes but configured differently for cloud and on-device calls.
- `initializeDeviceModel()` must be called on or after a user interaction and before a prompt request. A first request can start a multi-gigabyte background model download.
- Chrome availability states are `available`, `downloadable`, `downloading`, and `unavailable`.
- Chrome hardware conditions include Windows 10/11, macOS 13+, Linux, or Chromebook Plus; at least **22 GB** of free space on the Chrome profile volume; a GPU with **more than 4 GB VRAM**, or **16 GB RAM and four CPU cores**; and an unmetered connection for download. Mobile Chrome is not supported for these foundation-model APIs.
- On-device generation is **single-turn text generation only, not chat**. It supports text and JPEG/PNG image input and structured output. It does not support multi-turn chat, tools/function calling, code execution, URL context, Search or Maps grounding, image generation, or audio/video/PDF input.
- Gemini Live API, server prompt templates, and reliable `countTokens` are not supported for hybrid implementations. Firebase console AI monitoring shows **no on-device data**, so route and latency must be self-logged if a scorecard is wanted.
- Prompt API input/output languages are English, Japanese, Spanish, German, and French. Hindi is not in the on-device list.
- The Firebase web pages do not publish a numeric on-device context limit; Chrome exposes the running session’s context window at runtime. No official Nano-versus-cloud latency benchmark was found; latency must be self-measured.

Sources: [Firebase hybrid on-device inference](https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference) · [Firebase hybrid web configuration](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options) · [Firebase structured output for hybrid web](https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output) · [Chrome Prompt API](https://developer.chrome.com/docs/ai/prompt-api) · [Chrome: hybrid AI with Firebase AI Logic](https://developer.chrome.com/docs/ai/firebase-ai-logic)

## Official example patterns

- **Friendly Meals** models the split: quick suggestions run offline on-device; live world information uses separate cloud features. Its implementation lessons are to hold model names and prompts in Remote Config, let AI actions change application state, use Firestore-backed data, and treat App Check as a production step. The report cautions that Live API and Maps grounding in Friendly Meals are separate cloud-only features, **not** routes available inside hybrid on-device mode.
- Firebase’s hybrid-inference article creates two model instances for translation: short sentences use a device-preferred model and longer text uses a cloud-preferred model. ReplyForge copies that app-level routing pattern: short and simple goes device-first; long and complex goes cloud-first.

Sources: [Firebase blog: understanding hybrid inference](https://firebase.blog/posts/2025/10/understand-ai-logic-hybrid-inference/) · [Firebase blog: cooking assistant with AI Logic](https://firebase.blog/posts/2026/05/building-cooking-assistant-ai-logic) · [Build Session listing](https://luma.com/bapqqd3n)

## Winner patterns (official winner announcements; interpretation is inference)

- The **Chrome Built-in AI Challenge 2025** had more than 14,000 registrations and more than 1,300 submissions. Its Best Hybrid citation required a seamless client/server combination and “a clear reason why the submission benefits from a hybrid AI approach.” Winners included **Trail**, an offline web trail companion, and **Mentelo**, an extension for on-page support. Source: [Chrome Built-in AI Challenge 2025 winners](https://developer.chrome.com/blog/ai-challenge-winners-2025), published 5 December 2025.
- The **Gemini API Developer Competition** rewarded named professional or underserved audiences and AI that acts in an application rather than merely returning text: Jayu, Vite Vere, Gaze Link, Prospera, and ViddyScribe. Source: [Gemini API competition winners](https://developers.googleblog.com/announcing-the-winners-of-the-gemini-api-developer-competition/), published 21 November 2024.
- The **Gemini Live Agent Challenge** reported 11,878 participants and 1,536 submitted projects; its Grand Prize winner, ORION, served a specific high-stakes professional workflow. Source: [Gemini Live Agent Challenge winners](https://cloud.google.com/blog/topics/developers-practitioners/winners-and-highlights-of-the-gemini-live-agent-challenge), published 15 May 2026.
- The recurring pattern used for this entry: make hybrid load-bearing, name one real audience, have the AI change application state, prove claims with a measured scorecard, and explain the routing in one view.

## Idea tournament (research inference)

| Concept | Score /30 | Research conclusion |
|---|---:|---|
| Support-reply studio with on-device triage, redaction, and simple drafts; cloud escalation from redacted summaries | **27** | **Winner.** Best fit for single-turn on-device work, the entrant’s strength, and a measurable scorecard. |
| Privacy-first document/note assistant | 26 | Strong technical fit, but it is the organiser’s own example and is likely to be heavily copied. Retained as the fallback concept. |
| Offline-first field-service/inspection assistant | 24 | Differentiated, but desktop-Chrome is an awkward field form factor and the build is largest. |
| Study tutor | 23 | Feasible, but the category and easy/hard routing split are crowded and obvious. |
| Accessibility communication aid | 22 | Appeals in prior contests, but credibility needs real user testing and a near-identical aid won in 2025. |
| Recipe/meal planner | 21 | Easiest demo, but it recreates the sponsor’s own Friendly Meals sample. Learning exercise only. |

## Winning concept and demo (research recommendation)

ReplyForge Hybrid is a web support-reply studio for solo founders and small support teams. On-device processing classifies a ticket, detects and redacts personal data, and drafts simple replies. App-level rules escalate angry, long, multi-issue, refund/legal, low-confidence, or unsupported-language tickets to the cloud, sending the redacted summary only. Privacy Mode uses `ONLY_ON_DEVICE` and refuses rather than falling back. Every result shows the actual route, and a Firestore-backed scorecard self-logs route and latency.

The video is planned at **2 minutes 45 seconds**, inside the three-minute limit:

1. **0:00–0:20** — Problem, named audience, one-sentence privacy claim.
2. **0:20–0:55** — Network switched off on camera; a simple ticket is triaged and drafted with the ON_DEVICE chip and latency visible.
3. **0:55–1:30** — Personal data is redacted on-device; Privacy Mode refuses cloud processing for a sensitive ticket.
4. **1:30–2:15** — An angry, long, multi-issue ticket escalates; the cloud receives the redacted summary only, with the escalation reason labelled.
5. **2:15–2:45** — Measured scorecard, live URL and repository, plus the honest close: without Gemini Nano, the same work still completes by the cloud route.

## Known unknowns

No published bonus categories, complete judge panel, official latency benchmark, numeric on-device context-window size, detailed Gemini Nano 4 specification, or contest submission count was found. Those gaps are carried into SPEC and DESIGN as approval-gate flags, not filled by assumption.
