// Thin wrapper around the agent-browser CLI.
//
// Every command is scoped to one session and one CDP endpoint so parallel runs
// never share a browser. Methods return parsed values (snapshot nodes, tab
// records, JSON from eval) rather than raw stdout, which keeps the specs
// readable and the parsing unit-testable.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseSnapshot } from "./snapshot.js";

const run = promisify(execFile);

/** Parse `agent-browser tab` output into tab records. */
export function parseTabs(stdout) {
  const tabs = [];
  for (const line of String(stdout).split("\n")) {
    const match = /^(.?)\s*\[(t\d+)\]\s+(.*)$/.exec(line.trimEnd());
    if (!match) continue;
    const [, marker, id, rest] = match;
    const split = /^(.*) - (\S+)$/.exec(rest);
    tabs.push({
      id,
      title: split ? split[1] : rest,
      url: split ? split[2] : "",
      active: marker === "→",
    });
  }
  return tabs;
}

export class AgentBrowserError extends Error {
  constructor(args, detail) {
    super(`agent-browser ${args.join(" ")} failed: ${detail}`);
    this.name = "AgentBrowserError";
  }
}

export class Browser {
  constructor({
    session,
    cdpPort = null,
    bin = "agent-browser",
    timeoutMs = 30_000,
    verbose = false,
  } = {}) {
    this.session = session;
    this.cdpPort = cdpPort;
    this.bin = bin;
    this.timeoutMs = timeoutMs;
    this.verbose = verbose;
  }

  buildArgs(args) {
    const prefix = ["--session", this.session];
    if (this.cdpPort !== null && this.cdpPort !== undefined) {
      prefix.push("--cdp", String(this.cdpPort));
    }
    return [...prefix, ...args];
  }

  async exec(args, { timeoutMs = this.timeoutMs, input = null } = {}) {
    const full = this.buildArgs(args);
    if (this.verbose) console.error(`$ ${this.bin} ${full.join(" ")}`);
    const child = run(this.bin, full, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (input !== null) child.child.stdin.end(input);
    try {
      const { stdout } = await child;
      return stdout;
    } catch (err) {
      throw new AgentBrowserError(args, (err.stderr || err.stdout || err.message).trim());
    }
  }

  // --- navigation -----------------------------------------------------------
  open(url) { return this.exec(["open", url]); }
  reload() { return this.exec(["reload"]); }

  // --- reading --------------------------------------------------------------
  async snapshot({ interactive = true, selector = null } = {}) {
    const args = ["snapshot"];
    if (interactive) args.push("-i");
    if (selector) args.push("-s", selector);
    return parseSnapshot(await this.exec(args));
  }

  async get(what, target = null) {
    const out = await this.exec(target ? ["get", what, target] : ["get", what]);
    return out.trim();
  }

  url() { return this.get("url"); }
  title() { return this.get("title"); }
  text(selector) { return this.get("text", selector); }
  async count(selector) { return Number(await this.get("count", selector)); }

  /**
   * Evaluate JS in the page and JSON.parse the result.
   *
   * Scripts share one execution context across calls, so each one must be
   * self-contained — wrap anything with declarations in an IIFE.
   */
  async evalJson(script) {
    const out = (await this.exec(["eval", "--stdin"], { input: script })).trim();
    if (!out) return null;
    // The CLI prints JS values JSON-encoded; these scripts return JSON strings,
    // so the payload arrives double-encoded.
    let value = JSON.parse(out);
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        /* a plain string result is fine */
      }
    }
    return value;
  }

  // --- interacting ----------------------------------------------------------
  async click(target) {
    // Sign-in pages routinely render their submit button below the fold.
    await this.exec(["scrollintoview", target]).catch(() => {});
    return this.exec(["click", target]);
  }

  /**
   * Replace an input's contents using real keystrokes.
   * `fill` sets the value directly, which some of Microsoft's inputs ignore —
   * their submit handler never sees the change and the form silently no-ops.
   */
  async typeInto(target, value) {
    await this.exec(["click", target]);
    await this.exec(["press", "Control+a"]);
    await this.exec(["keyboard", "type", value]);
  }

  press(key) { return this.exec(["press", key]); }
  select(target, value) { return this.exec(["select", target, value]); }
  screenshot(path) { return this.exec(["screenshot", path]); }

  // --- waiting --------------------------------------------------------------
  waitForFn(expression, timeoutMs = this.timeoutMs) {
    return this.exec(["wait", "--fn", expression], { timeoutMs: timeoutMs + 5_000 });
  }
  waitForText(text, timeoutMs = this.timeoutMs) {
    return this.exec(["wait", "--text", text], { timeoutMs: timeoutMs + 5_000 });
  }
  waitForLoad(state = "networkidle", timeoutMs = this.timeoutMs) {
    return this.exec(["wait", "--load", state], { timeoutMs: timeoutMs + 5_000 });
  }

  // --- tabs -----------------------------------------------------------------
  async tabs() { return parseTabs(await this.exec(["tab"])); }
  switchTab(id) { return this.exec(["tab", id]); }

  close() { return this.exec(["close"]).catch(() => {}); }
}
