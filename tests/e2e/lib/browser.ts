// Launch options for every browser the suite drives (tests/e2e/fixtures.ts's
// `browser` fixture, and tests/explorative/authenticatedBrowserSession.ts's
// playwright-cli config).
//
// Caddy serves the app bound to the real deployed hostname (see lib/caddy.ts),
// so the browser has to resolve that hostname to the local Caddy instead of to
// GitHub Pages — that's what --host-resolver-rules does.

import type { LaunchOptions } from "@playwright/test";

/** The hostname the app is deployed under, and the one Caddy impersonates. */
export const APP_HOST = "npohle.github.io";

/** Chrome flag pointing APP_HOST at the local Caddy instance on `port`. */
export function hostResolverRule(port: number): string {
  return `--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1:${port}`;
}

/**
 * The configured launch options (Playwright's `use.launchOptions`) plus the
 * host resolver rule for this run's Caddy port. Returns a copy — Playwright
 * hands the same `launchOptions` object to every worker.
 */
export function browserLaunchOptions(port: number, launchOptions: LaunchOptions = {}): LaunchOptions {
  return {
    ...launchOptions,
    args: [...(launchOptions.args ?? []), hostResolverRule(port)],
  };
}
