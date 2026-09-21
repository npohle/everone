import test from "node:test";
import assert from "node:assert/strict";

import { APP_HOST, hostResolverRule, browserLaunchOptions } from "../e2e/lib/browser.ts";

test("hostResolverRule maps the app host at the given Caddy port", () => {
  assert.equal(
    hostResolverRule(4443),
    `--host-resolver-rules=MAP ${APP_HOST} 127.0.0.1:4443`,
  );
});

test("browserLaunchOptions adds the host resolver rule", () => {
  const { args } = browserLaunchOptions(1443);
  assert.deepEqual(args, [hostResolverRule(1443)]);
});

test("browserLaunchOptions keeps args and options coming from the config", () => {
  const configured = { args: ["--mute-audio"], slowMo: 50 };

  const options = browserLaunchOptions(2443, configured);

  assert.deepEqual(options.args, ["--mute-audio", hostResolverRule(2443)]);
  assert.equal(options.slowMo, 50);
  // The config's own object must not be mutated — Playwright hands the very
  // same `launchOptions` object to every worker's browser fixture.
  assert.deepEqual(configured.args, ["--mute-audio"]);
});
