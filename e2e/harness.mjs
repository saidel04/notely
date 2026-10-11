// Shared helpers for the end-to-end smoke tests.
//
// These drive the *running sandbox app* over the WebView2 remote-debugging
// protocol — they are not part of `npm test` (which is pure unit tests) and
// don't run in CI, because they need the built desktop app and a WebView.
//
// Usage: launch the sandbox with remote debugging, then run a spec. See README.md.

import { chromium } from "playwright-core";

const CDP_URL = process.env.NOTELY_CDP ?? "http://localhost:9222";

/** Connects to the running app and returns helpers bound to its page. */
export async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL).catch((e) => {
    console.error(`\nCould not connect to ${CDP_URL}.`);
    console.error("Start the app first:  npm run dev:sandbox  (with remote debugging — see e2e/README.md)\n");
    throw e;
  });
  // The app's page — not a browser surface like a permission prompt, which is
  // also exposed as a target.
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => /^https?:|^tauri:/.test(p.url()));
  if (!page) throw new Error("No page open in the app");

  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));

  const api = await page.evaluate(() => !!window.__notely);
  if (!api) throw new Error("window.__notely is missing — run a dev build (import.meta.env.DEV).");

  // Refuse to touch anything but a sandbox vault.
  const vault = await page.evaluate(() => window.__notely.useVault.getState().vaultPath ?? "");
  if (!/devvault/i.test(vault)) {
    throw new Error(`Refusing to run against a non-sandbox vault:\n  ${vault}\nUse npm run dev:sandbox.`);
  }

  return {
    page,
    vault,
    errors,
    /** Evaluate a function in the page. */
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    wait: (ms) => page.waitForTimeout(ms),
    /** Zustand store states, e.g. store("useVault"). */
    store: (name) => page.evaluate((n) => window.__notely[n].getState(), name),
  };
}

/** A tiny assertion collector so each spec returns a pass/fail tally. */
export function checks() {
  const results = [];
  return {
    ok(label, value) {
      results.push({ label, pass: !!value });
      console.log(`  ${value ? "✓" : "✗"} ${label}`);
    },
    results,
    get failed() {
      return results.filter((r) => !r.pass).length;
    },
  };
}
