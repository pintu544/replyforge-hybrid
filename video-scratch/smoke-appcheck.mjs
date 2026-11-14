// App Check production-provider smoke test (2026-11-14).
// Drives the PRODUCTION build (Fraud Defense / reCAPTCHA Enterprise
// provider) served on localhost:4173 — localhost is on the site key's
// domain list. Signs in with QA account A (credentials read from the
// repo-root qa-test-account.txt, never printed), runs RF-021 through
// triage -> redact -> escalation preview -> confirm escalation, which
// forces a cloud AI Logic call guarded by App Check. PASS = escalation
// completes with a stored draft and no App Check / reCAPTCHA errors.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/home/hatch/workspace/qa3-harness/package.json');
const { chromium } = require('playwright-core');

const EXEC = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell';
const BASE = 'http://localhost:4173';

function readAccountA() {
  const text = readFileSync('/home/hatch/workspace/replyforge-hybrid/qa-test-account.txt', 'utf8');
  const first = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)[0];
  return {
    email: /email:\s*(\S+)/.exec(first)[1],
    password: /password:\s*(\S+)/.exec(first)[1],
  };
}
const account = readAccountA();

const browser = await chromium.launch({
  executablePath: EXEC,
  args: [
    '--proxy-server=http://127.0.0.1:8888',
    '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
    '--no-sandbox',
  ],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
const badResponses = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
});
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + String(err).slice(0, 300)));
page.on('response', (res) => {
  const u = res.url();
  if (res.status() >= 400 && (u.includes('googleapis.com') || u.includes('recaptcha') || u.includes('firebase'))) {
    badResponses.push(res.status() + ' ' + u.slice(0, 160));
  }
});

const dwell = (ms) => page.waitForTimeout(ms);
let stage = 'load';
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  stage = 'sign-in';
  const emailInput = page.locator('.auth-panel input[type="email"], .auth-panel input').first();
  await emailInput.waitFor({ timeout: 45000 });
  await emailInput.fill(account.email);
  await page.locator('.auth-panel input[type="password"]').fill(account.password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await page.getByRole('button', { name: 'Run evaluation over all 30 tickets' }).waitFor({ timeout: 90000 });
  await page.locator('.ticket-row').first().waitFor({ timeout: 60000 });
  console.log('SIGNIN_OK inbox loaded');

  stage = 'open RF-021';
  const row = page.locator('.ticket-row', { hasText: 'RF-021' }).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click();
  await page.getByRole('button', { name: /Run triage/ }).waitFor({ timeout: 30000 });

  stage = 'triage';
  const cardSel = '.triage-result[aria-label="Triage result"]';
  const beforeCard = page.locator(cardSel).first();
  const before = (await beforeCard.count()) ? (await beforeCard.innerText()).trim() : null;
  await page.getByRole('button', { name: /Run triage/ }).click();
  const deadline = Date.now() + 240000;
  let triageOk = false;
  while (Date.now() < deadline) {
    if (await page.locator('.triage-result--failed').count()) throw new Error('triage ended in failed state');
    const card = page.locator(cardSel).first();
    if (await card.count()) {
      const syncing = await page.locator('.triage-result--sync').count();
      const text = (await card.innerText()).trim();
      if (!syncing && text !== before) { triageOk = true; break; }
    }
    await dwell(2500);
  }
  if (!triageOk) throw new Error('triage did not reach a proven result in 240s');
  console.log('TRIAGE_OK');

  stage = 'redact + preview';
  const workspace = page.locator('.workspace-panel');
  const redactBtn = page.getByRole('button', { name: 'Redact personal data' });
  if (await redactBtn.count()) await redactBtn.click();
  await workspace.getByText('What the cloud sees', { exact: false }).first().waitFor({ timeout: 60000 });
  console.log('PREVIEW_OK');

  stage = 'escalate';
  if (await page.getByRole('button', { name: /Escalation blocked by the payload gate/i }).count()) {
    throw new Error('payload gate shows BLOCKED for RF-021 in this run');
  }
  const confirmBtn = page.getByRole('button', { name: /confirm and escalate|confirm payload and escalate/i }).first();
  await confirmBtn.waitFor({ timeout: 30000 });
  console.log('CONFIRM_LABEL: ' + (await confirmBtn.innerText()).trim());
  await confirmBtn.click();
  const escResult = page.locator('.triage-result[aria-label="Escalation result"]');
  await escResult.waitFor({ timeout: 240000 });
  if (await page.locator('.triage-result--failed').count()) throw new Error('escalation ended in failed state');
  const chip = escResult.locator('.route-chip').first();
  console.log('ESCALATION_CHIP: ' + ((await chip.count()) ? (await chip.innerText()).trim() : '(none)'));
  console.log('ESCALATION_TEXT: ' + (await escResult.innerText()).replace(/\s+/g, ' ').slice(0, 220));
  console.log('ESCALATION_OK');
  console.log('SMOKE_PASS');
} catch (err) {
  console.log('SMOKE_FAIL at stage "' + stage + '": ' + String(err).slice(0, 300));
} finally {
  const appCheckErrors = consoleErrors.filter((e) => /app.?check|recaptcha|enterprise|token/i.test(e));
  console.log('CONSOLE_ERRORS_TOTAL=' + consoleErrors.length);
  for (const e of consoleErrors.slice(0, 6)) console.log('CONSOLE_ERR: ' + e);
  console.log('APPCHECK_RELATED=' + appCheckErrors.length);
  for (const e of appCheckErrors.slice(0, 4)) console.log('APPCHECK_ERR: ' + e);
  console.log('BAD_RESPONSES=' + badResponses.length);
  for (const r of badResponses.slice(0, 6)) console.log('BAD_RESP: ' + r);
  await browser.close();
}
