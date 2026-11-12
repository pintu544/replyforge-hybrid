# Set up Gemini Nano (on-device AI) in Chrome on your PC

**Why:** ReplyForge Hybrid (our #BuildHybridAI 2026 entry) runs support-ticket triage and redaction on-device using Gemini Nano in Chrome, and escalates hard tickets to the cloud. To prove the on-device route — and later to film it — your PC needs Chrome's built-in on-device model set up and verified. This guide takes you from zero to a verified `available` result. Total hands-on time is about 10 minutes, plus waiting for a one-time model download of several GB.

---

## Part 1 — Check your PC meets the requirements

Gemini Nano in Chrome needs **all** of these:

| Requirement | Minimum | How to check |
|---|---|---|
| Operating system | Windows 10 or 11 (or macOS 13+, Linux, Chromebook Plus) | Settings → System → About |
| Chrome | **Desktop Chrome 139 or higher** (latest is best). Mobile Chrome does not count | Chrome menu ⋮ → Help → About Google Chrome |
| Free disk space | **At least 22 GB free** on the drive where your Chrome profile lives (usually C:) | File Explorer → This PC → look at C: |
| Hardware | **Either** a GPU with **more than 4 GB VRAM**, **or** **16 GB RAM and a CPU with 4 or more cores** | Task Manager → Performance tab: Memory shows RAM, CPU shows the processor and core count, GPU shows "Dedicated GPU memory" |
| Network | Unmetered Wi-Fi for the first download | The model is several GB, downloaded once |

Write down what you find — you will send these back at the end:

- Windows version:
- Chrome version:
- RAM:
- CPU (name + cores):
- GPU dedicated memory (VRAM):
- Free space on C::

If a requirement is clearly not met (for example 8 GB RAM and a weak GPU, or under 22 GB free), do not fight it — stop, send the figures back, and we will use the cloud-fallback path for demos instead. That is a designed path in the app, not a failure.

---

## Part 2 — Set it up, step by step

### Step 1 — Update Chrome

1. Open Chrome → menu ⋮ → Help → **About Google Chrome**.
2. Let it update to the latest version, then click **Relaunch** when offered.
3. Confirm the version shown is **139 or higher** (it will normally be much newer).

### Step 2 — Turn on the two Chrome flags

1. In the address bar, open: `chrome://flags/#optimization-guide-on-device-model`
2. Find **"Enables optimization guide on device"** and set it to **Enabled BypassPerfRequirement**.
   (This is the setting Chrome's own Prompt API documentation tells developers to use. "BypassPerfRequirement" only skips Chrome's conservative performance gate — it does not change your hardware, and a genuinely weak machine will still be slow.)
3. In the address bar, open: `chrome://flags/#prompt-api-for-gemini-nano`
4. Find **"Prompt API for Gemini Nano"** and set it to **Enabled**.
5. Click **Relaunch** / restart Chrome when prompted. Both flags must survive the restart — if you re-open the flags page, both should still show your chosen values.

### Step 3 — Check the model's availability state

1. Open any normal website (for example https://example.com).
2. Press **F12** to open DevTools, and click the **Console** tab.
3. Click into the console, paste this line exactly, and press Enter:

```js
await LanguageModel.availability()
```

4. Read the result:
   - `"available"` — the model is already on your machine. Skip to Step 5.
   - `"downloadable"` — your PC qualifies; the model is not downloaded yet. Go to Step 4.
   - `"downloading"` — a download is already in progress. Go to Step 4 and wait.
   - `"unavailable"` — Chrome currently thinks this machine cannot run it. Work through Part 3 before giving up.

> If the console refuses to let you paste ("Warning: Don't paste code into the DevTools Console..."), type the words `allow pasting` and press Enter, then paste again. This is a standard Chrome self-protection prompt.

### Step 4 — Trigger the model download and wait

1. Stay on the same page with DevTools Console open.
2. Paste this block and press Enter:

```js
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', e => {
      console.log('Downloaded ' + Math.round(e.loaded * 100) + '%');
    });
  }
});
console.log('Model session created.');
```

3. You should see download progress percentages. The download is several GB:
   - Keep the laptop **plugged in** and **Chrome open** until it finishes.
   - Do not clear browsing data or "site data" while it downloads.
   - Depending on your connection it can take a while. If progress stalls completely for a long time, fully close Chrome, reopen it, and run Step 3 again — the download normally resumes.
4. When the console prints `Model session created.`, the model is on your machine.

You can also watch status any time at `chrome://on-device-internals` (model status section), and at `chrome://components` — the component **"Optimization Guide On Device Model"** should show a real version number, not `0.0.0.0`, once the model is installed.

### Step 5 — Verify with a real on-device prompt

1. In the same DevTools Console, paste:

```js
const s = await LanguageModel.create();
console.log(await s.prompt('Reply with exactly one short friendly sentence.'));
s.destroy();
```

2. Run the availability check once more:

```js
await LanguageModel.availability()
```

3. Success means: the sentence prints, and availability now returns `"available"`. Your PC is ready — on-device inference genuinely works on it.

---

## Part 3 — Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| `LanguageModel is not defined` | Flags not applied, or Chrome too old | Re-check both flags in Part 2, Step 2; confirm Chrome 139+; fully restart Chrome (close all windows) |
| Availability says `"unavailable"` | Hardware, disk space, or OS below the bar, or flags not set | Free up disk to 22 GB+; re-check flags; confirm specs from Part 1. If specs are genuinely below the bar, stop and report back — we use the cloud path |
| Stuck on `"downloadable"` even after Step 4 | Download never actually started, or was interrupted | Restart Chrome, stay on a normal https page, run Step 4 again; check `chrome://on-device-internals` for an error message |
| Download restarts from 0% | Chrome was closed mid-download or storage was cleared | Plug in, keep Chrome open, let it finish in one sitting |
| Progress is extremely slow | Large model on a slow connection | Leave it running on unmetered Wi-Fi; it is a one-time download |
| Flags reverted to "Default" | Chrome updated and reset them | Set both flags again and relaunch |
| Everything works but answers are slow | Normal on modest hardware — first prompt also warms the model up | Run the test prompt twice; judge speed from the second run |

Security notes: only ever paste console code from this guide (or code Muse gives you in chat). Never paste console code from a random website or video — that is a known scam pattern. The flags above are Chrome's official developer settings for the Prompt API; they do not install anything from outside Chrome itself.

---

## Part 4 — Send this back to Muse

Copy, fill in, and send:

```
PC check for Gemini Nano:
- Windows version:
- Chrome version:
- RAM:
- CPU (name + cores):
- GPU dedicated memory:
- Free space on C::
- availability() BEFORE setup:
- availability() AFTER setup:
- Test prompt worked? (yes/no + the sentence it printed, if yes)
- Any error text, copied exactly:
```

---

## Part 5 — Or hand the whole job to an AI on your PC

If you would rather have an AI assistant on your PC (ChatGPT, Claude, Copilot — any of them) walk you through it live, paste it the prompt below. It contains everything it needs; you just follow its steps one at a time and paste back whatever your screen shows when it asks.

```text
You are helping me set up Gemini Nano, Chrome's built-in on-device AI model, on my Windows PC. I need this for a hackathon project that uses Chrome's Prompt API (the LanguageModel API) with Firebase AI Logic hybrid inference. Walk me through it ONE step at a time: give me a step, wait for me to tell you what I see or paste the result, then give the next step. Never give me more than one step at a time, and never ask me to paste code into the browser console from anywhere except the exact snippets in your instructions below.

Ground rules:
- Before changing anything, first check my machine against these requirements and tell me honestly if it does not qualify: Windows 10 or 11; desktop Chrome version 139 or higher; at least 22 GB free disk space on C:; and either a GPU with more than 4 GB of VRAM, or at least 16 GB of RAM plus a CPU with 4 or more cores.
- Tell me exactly where to click to find each figure (Settings → System → About for OS/RAM/CPU; Task Manager → Performance for CPU cores and GPU dedicated memory; File Explorer → This PC for free disk space; Chrome menu → Help → About Google Chrome for the Chrome version).
- If my PC does not meet a requirement, stop the setup, explain which requirement failed in plain words, and summarise what I should report back. Do not try workarounds that could harm the machine.

If my PC qualifies, guide me through this sequence:
1. Update Chrome to the latest version and relaunch it.
2. Set two flags, then relaunch Chrome: at chrome://flags/#optimization-guide-on-device-model set "Enables optimization guide on device" to "Enabled BypassPerfRequirement"; at chrome://flags/#prompt-api-for-gemini-nano set "Prompt API for Gemini Nano" to "Enabled".
3. On a normal website, open DevTools (F12) → Console and run: await LanguageModel.availability() — explain what each possible result (available, downloadable, downloading, unavailable) means and what we do next for the result I actually get. If the console blocks pasting, tell me to type "allow pasting" first.
4. If the model needs downloading, run this exact snippet and help me wait for the download to complete (advise: plugged in, Chrome left open, unmetered Wi-Fi; the model is several GB):
   const session = await LanguageModel.create({ monitor(m) { m.addEventListener('downloadprogress', e => { console.log('Downloaded ' + Math.round(e.loaded * 100) + '%'); }); } }); console.log('Model session created.');
   If it stalls or errors, troubleshoot using chrome://on-device-internals and chrome://components (the "Optimization Guide On Device Model" component should not be version 0.0.0.0 once installed).
5. Verify by running: const s = await LanguageModel.create(); console.log(await s.prompt('Reply with exactly one short friendly sentence.')); s.destroy(); — then run await LanguageModel.availability() again and confirm it returns "available".

At the end, produce a short filled-in report in exactly this format for me to send back:
PC check for Gemini Nano:
- Windows version:
- Chrome version:
- RAM:
- CPU (name + cores):
- GPU dedicated memory:
- Free space on C::
- availability() BEFORE setup:
- availability() AFTER setup:
- Test prompt worked? (yes/no + the sentence it printed, if yes)
- Any error text, copied exactly:

Start now with the requirements check: tell me the first figure to find and exactly where to find it.
```
