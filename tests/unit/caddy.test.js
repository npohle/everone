import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readCaddyState } from "../e2e/lib/caddy.ts";

function artefactsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "caddy-state-"));
}

test("readCaddyState reads the state written for a run", () => {
  const dir = artefactsDir();
  fs.writeFileSync(
    path.join(dir, ".caddy-server-state.json"),
    JSON.stringify({ pid: 42, port: 1443 }),
  );

  assert.deepEqual(readCaddyState(dir), { pid: 42, port: 1443 });
});

test("readCaddyState explains itself when no Caddy is running for the run", () => {
  const dir = artefactsDir();

  assert.throws(() => readCaddyState(dir), /caddy/i);
});
