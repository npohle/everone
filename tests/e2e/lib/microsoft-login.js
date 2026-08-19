// Drives Microsoft's sign-in popup.
//
// The flow is a loop, not a script: Microsoft varies which pages appear based on
// what it remembers about the account and device. Each pass classifies the
// current page (see login-steps.js) and performs the single action that page
// needs, until the popup navigates back to the app's redirect URI and closes.

import { STEP, classifyStep } from "./login-steps.js";
import { generateFreshCode } from "./totp.js";

const SETTLE_MS = 600;
const MAX_REPEATS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The sign-in popup is any tab that is not the app itself. */
async function findPopup(browser, appOrigin) {
  const tabs = await browser.tabs();
  return tabs.find((t) => t.url.startsWith("http") && !t.url.startsWith(appOrigin)) ?? null;
}

async function findAppTab(browser, appOrigin) {
  const tabs = await browser.tabs();
  return tabs.find((t) => t.url.startsWith(appOrigin)) ?? tabs[0] ?? null;
}

async function submit(browser, step) {
  if (step.submit) await browser.click(step.submit);
  else await browser.press("Enter");
}

/**
 * Complete the Microsoft sign-in popup.
 *
 * @param {import("./browser.js").Browser} browser
 * @param {object} config  loaded test config (username/password/totpSeed/appOrigin)
 * @param {{log?: (msg: string) => void, timeoutMs?: number}} [options]
 * @returns {Promise<string[]>} the steps that were actually shown
 */
export async function completeSignIn(browser, config, { log = () => {}, timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  let previous = null;
  let repeats = 0;

  while (Date.now() < deadline) {
    const popup = await findPopup(browser, config.appOrigin);
    if (!popup) break; // popup closed — the flow is finished
    if (!popup.active) await browser.switchTab(popup.id);

    const url = await browser.url();
    const nodes = await browser.snapshot();
    const step = classifyStep({
      url,
      nodes,
      appOrigin: config.appOrigin,
      username: config.username,
    });

    if (step.name === STEP.COMPLETE) break;
    if (step.name === STEP.ERROR) {
      throw new Error(`Microsoft sign-in failed at ${url}\n  ${step.message}`);
    }
    if (step.name === STEP.UNKNOWN) {
      // Microsoft's pages render client-side; an unrecognised page is usually
      // one that has not painted yet.
      if (++repeats > MAX_REPEATS) {
        throw new Error(
          `Unrecognised sign-in page at ${url}\n  ${step.message || "(no visible controls)"}`
        );
      }
      await sleep(1_000);
      continue;
    }

    if (step.name === previous && ++repeats > MAX_REPEATS) {
      throw new Error(`Sign-in stuck on step "${step.name}" at ${url}`);
    }
    if (step.name !== previous) repeats = 0;
    previous = step.name;
    seen.push(step.name);
    log(`sign-in: ${step.name}`);

    switch (step.name) {
      case STEP.ACCOUNT_PICKER:
        await browser.click(step.submit);
        break;
      case STEP.USERNAME:
        await browser.typeInto(step.input, config.username);
        await submit(browser, step);
        break;
      case STEP.PASSWORD:
        await browser.typeInto(step.input, config.password);
        await submit(browser, step);
        break;
      case STEP.TOTP: {
        const code = await generateFreshCode(config.totpSeed);
        await browser.typeInto(step.input, code);
        await submit(browser, step);
        break;
      }
      case STEP.STAY_SIGNED_IN:
        // Decline, so each run exercises the full flow instead of a cached one.
        await submit(browser, step);
        break;
      case STEP.CONSENT:
        await browser.click(step.submit);
        break;
      default:
        throw new Error(`No action defined for sign-in step "${step.name}"`);
    }

    await sleep(SETTLE_MS);
  }

  if (Date.now() >= deadline) throw new Error(`Sign-in did not complete within ${timeoutMs}ms`);

  const appTab = await findAppTab(browser, config.appOrigin);
  if (appTab && !appTab.active) await browser.switchTab(appTab.id);
  return seen;
}
