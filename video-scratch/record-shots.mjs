// Rough-demo footage recorder for ReplyForge Hybrid (demo package prep).
// Records the REAL hosted app at 1280x800, one shot per invocation:
//   node record-shots.mjs inbox|rf001|rf021|refusal
// Recipe per spec/LIVE-VERIFICATION.md: Chromium proxy flags, proxy env
// stripped at launch, ignoreHTTPSErrors. Credentials are read from the
// repo-root qa-test-account.txt and never printed.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/qa3-harness/package.json');
const { chromium } = require('playwright-core');

const EXEC = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell';
const HOSTED_URL = 'https://replyforge-hybrid.web.app';
const HERE = dirname(fileURLToPath(import.meta.url));

const SHOTS = {
  inbox: 'beat1-inbox-load.webm',
  rf001: 'beat4a-rf001-triage-cloud.webm',
  rf021: 'beat4b-rf021-escalation.webm',
  refusal: 'beat3b-privacy-escalation-refusal.webm',
};

function readAccountA() {
  const text = readFileSync('/home/hatch/workspace/replyforge-hybrid/qa-test-account.txt', 'utf8');
  const first = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)[0];
  return {
    email: /email:\s*(\S+)/.exec(first)[1],
    password: /password:\s*(\S+)/.exec(first)[1],
  };
}

const shot = process.argv[2];
if (!SHOTS[shot]) {
  console.error(`usage: node record-shots.mjs ${Object.keys(SHOTS).join('|')}`);
  process.exit(2);
}

const account = readAccountA();
const tmpDir = `${HERE}/.raw-${shot}`;
mkdirSync(tmpDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXEC,
  args: [
    '--proxy-server=http://127.0.0.1:8888',
    '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
    '--no-sandbox',
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: tmpDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const facts = { shot };

const dwell = (ms) => page.waitForTimeout(ms);
async function moveTo(locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
}
async function clickDwell(locator, before = 900) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await moveTo(locator);
  await dwell(before);
  await locator.click();
}

async function signIn() {
  await page.goto(HOSTED_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const emailInput = page.locator('.auth-panel input[type="email"], .auth-panel input').first();
  await emailInput.waitFor({ timeout: 45000 });
  await dwell(1800); // signed-out state on camera (status panel + sign-in)
  await moveTo(emailInput);
  await emailInput.fill(account.email);
  await page.locator('.auth-panel input[type="password"]').fill(account.password);
  await clickDwell(page.getByRole('button', { name: 'Sign in with email' }), 600);
  await page.getByRole('button', { name: 'Run evaluation over all 30 tickets' }).waitFor({ timeout: 90000 });
  await page.locator('.ticket-row').first().waitFor({ timeout: 60000 });
  await dwell(1500);
}

async function openTicket(id) {
  const row = page.locator('.ticket-row', { hasText: id }).first();
  await clickDwell(row);
  await page.getByRole('button', { name: /Run triage/ }).waitFor({ timeout: 30000 });
  await dwell(800);
}

async function runTriage() {
  // A stored result card may already be on screen (from an earlier run);
  // a fresh completion is proven only when the card's text has changed
  // AND it is not the amber awaiting-sync state (strict route-event
  // rule: no route is claimed until the record lands).
  const cardSel = '.triage-result[aria-label="Triage result"]';
  const beforeCard = page.locator(cardSel).first();
  const before = (await beforeCard.count()) ? (await beforeCard.innerText()).trim() : null;
  const btn = page.getByRole('button', { name: /Run triage/ });
  await clickDwell(btn);
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (await page.locator('.triage-result--failed').count()) {
      throw new Error('triage ended in the failed state');
    }
    const card = page.locator(cardSel).first();
    if (await card.count()) {
      const syncing = await page.locator('.triage-result--sync').count();
      const text = (await card.innerText()).trim();
      if (!syncing && text !== before) return card;
    }
    await dwell(2500);
  }
  throw new Error('triage did not reach a proven result within 240 s');
}

// Triage + redact RF-021 until the escalation preview exists. Returns the
// workspace locator. Idempotent against state left by earlier runs.
async function prepareEscalationPreview() {
  const workspace = page.locator('.workspace-panel');
  const previewHeading = workspace.getByText('What the cloud sees', { exact: false }).first();
  const hasPreview = async () => (await previewHeading.count()) > 0;
  // Always run a fresh triage on camera, even if stored state exists.
  await runTriage();
  const redactBtn = page.getByRole('button', { name: 'Redact personal data' });
  if (await redactBtn.count()) {
    await clickDwell(redactBtn);
    await dwell(2500);
  }
  const deadline = Date.now() + 60000;
  while (!(await hasPreview()) && Date.now() < deadline) await dwell(2000);
  if (!(await hasPreview())) throw new Error('escalation preview never appeared');
  return workspace;
}

try {
  if (shot === 'inbox') {
    await signIn();
    facts.inboxCount = (await page.locator('.inbox-count').innerText()).trim();
    facts.rows = await page.locator('.ticket-row').count();
    await dwell(3000);
    const list = page.locator('.ticket-row').first();
    const box = await list.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 200, box.y + 120);
      await page.mouse.wheel(0, 420);
    }
    await dwell(2600);
    if (box) await page.mouse.wheel(0, -420);
    await dwell(2400);
  }

  if (shot === 'rf001') {
    await signIn();
    await openTicket('RF-001');
    const result = await runTriage();
    await result.scrollIntoViewIfNeeded();
    facts.chip = (await result.locator('.route-chip').innerText()).trim();
    await dwell(4500);
  }

  if (shot === 'rf021') {
    await signIn();
    await openTicket('RF-021');
    const workspace = await prepareEscalationPreview();
    const chip = workspace.locator('.route-chip').first();
    if (await chip.count()) facts.triageChip = (await chip.innerText()).trim();
    // Dwell on the payload preview (shared with Beat 3 in the final cut).
    const heading = workspace.getByText('What the cloud sees', { exact: false }).first();
    await heading.scrollIntoViewIfNeeded();
    await dwell(5000);
    await page.mouse.wheel(0, 300);
    await dwell(2800);
    const confirm = page.getByRole('button', { name: /confirm and escalate/ });
    await confirm.waitFor({ timeout: 30000 });
    facts.confirmLabel = (await confirm.innerText()).trim();
    await clickDwell(confirm, 1400);
    const escResult = page.locator('.triage-result[aria-label="Escalation result"]');
    await escResult.waitFor({ timeout: 180000 });
    await escResult.scrollIntoViewIfNeeded();
    facts.escalationChip = (await escResult.locator('.route-chip').innerText()).trim();
    facts.escalationText = (await escResult.innerText()).replace(/\s+/g, ' ').slice(0, 220);
    await dwell(5000);
  }

  if (shot === 'refusal') {
    await signIn();
    await openTicket('RF-021');
    await prepareEscalationPreview();
    const toggle = page.locator('.privacy-toggle input[type="checkbox"]');
    await toggle.scrollIntoViewIfNeeded();
    await dwell(1000);
    if (!(await toggle.isChecked())) await page.locator('.privacy-toggle').click();
    await dwell(1500);
    facts.privacyState = (await page.locator('.privacy-state').innerText()).trim();
    const confirm = page.getByRole('button', { name: /confirm and escalate/ });
    await confirm.waitFor({ timeout: 30000 });
    await clickDwell(confirm, 1400);
    const refusal = page.locator('.workspace-panel').getByText('Refused — Privacy Mode').first();
    await refusal.waitFor({ timeout: 60000 });
    await refusal.scrollIntoViewIfNeeded();
    facts.refusalVisible = true;
    await dwell(5000);
  }

  facts.ok = true;
} catch (err) {
  facts.ok = false;
  facts.error = String(err).slice(0, 400);
  await page.screenshot({ path: `${HERE}/.raw-${shot}-failure.png` }).catch(() => {});
} finally {
  const videoPath = await page.video().path().catch(() => null);
  await context.close();
  await browser.close();
  if (videoPath) {
    renameSync(videoPath, `${HERE}/${SHOTS[shot]}`);
    rmSync(tmpDir, { recursive: true, force: true });
    facts.file = SHOTS[shot];
  }
  console.log(JSON.stringify(facts, null, 2));
}
