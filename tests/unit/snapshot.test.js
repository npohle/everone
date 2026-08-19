import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSnapshot, findByRole, findButton } from "../e2e/lib/snapshot.js";
import * as fx from "./fixtures/snapshots.js";

test("parses role, accessible name and ref from a snapshot line", () => {
  const nodes = parseSnapshot(fx.LOGIN_EMAIL);
  const textbox = nodes.find((n) => n.role === "textbox");
  assert.equal(textbox.name, "Email or phone number");
  assert.equal(textbox.ref, "@e7");
});

test("keeps every node, including ones without an accessible name", () => {
  const nodes = parseSnapshot(fx.APP_SIGNED_IN);
  const combobox = nodes.find((n) => n.role === "combobox");
  assert.ok(combobox, "combobox with no name should still be parsed");
  assert.equal(combobox.ref, "@e5");
  assert.equal(combobox.name, "");
});

test("parses nested (indented) nodes", () => {
  const nodes = parseSnapshot(fx.APP_SIGNED_IN);
  const options = nodes.filter((n) => n.role === "option");
  assert.equal(options.length, 2);
  assert.equal(options[0].name, "Name (Z→A)");
});

test("exposes bracket attributes", () => {
  const nodes = parseSnapshot(fx.LOGIN_TOTP);
  assert.equal(nodes.find((n) => n.role === "checkbox").attrs.checked, "true");
  assert.equal(nodes.find((n) => n.role === "heading").attrs.level, "1");
});

test("returns an empty list for the no-elements placeholder", () => {
  assert.deepEqual(parseSnapshot(fx.EMPTY), []);
  assert.deepEqual(parseSnapshot(""), []);
});

test("findByRole matches on a name pattern", () => {
  const nodes = parseSnapshot(fx.LOGIN_PASSWORD);
  assert.equal(findByRole(nodes, "textbox", /^password$/i).ref, "@e7");
  assert.equal(findByRole(nodes, "textbox", /nope/), null);
});

test("findButton matches button-like roles by name", () => {
  const nodes = parseSnapshot(fx.LOGIN_STAY_SIGNED_IN);
  assert.equal(findButton(nodes, /^no$/i).ref, "@e8");
  assert.equal(findButton(nodes, /^yes$/i).ref, "@e7");
});
