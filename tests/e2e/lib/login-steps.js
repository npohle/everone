// Pure classifier for the Microsoft sign-in flow.
//
// Sign-in is not a fixed sequence: Microsoft skips or inserts steps depending on
// what it remembers about the account and the device (account picker, "stay
// signed in?", consent, ...). So the driver loops — classify the page, take the
// one action that step needs, re-snapshot — instead of following a script.
// Keeping the classifier pure means every branch is testable without a browser.

import { findButton, findByRole, snapshotText } from "./snapshot.js";

export const STEP = {
  ACCOUNT_PICKER: "account-picker",
  USERNAME: "username",
  PASSWORD: "password",
  TOTP: "totp",
  STAY_SIGNED_IN: "stay-signed-in",
  CONSENT: "consent",
  COMPLETE: "complete",
  ERROR: "error",
  UNKNOWN: "unknown",
};

const SUBMIT = /^(next|sign in|verify|submit|continue|yes, continue)$/i;
const ERROR_HEADING =
  /unable to complete your request|something went wrong|didn't work|couldn't (find|sign)|that account doesn't exist|sign-?in is blocked/i;
const ERROR_TEXT = /\b(invalid_request|invalid_client|unauthorized_client|AADSTS\d+)\b/;

const step = (name, extra = {}) => ({ name, input: null, submit: null, message: "", ...extra });

/**
 * @param {object} page
 * @param {string} page.url        current popup URL
 * @param {Array}  page.nodes      parsed snapshot nodes
 * @param {string} page.appOrigin  origin the SPA is served from
 * @param {string} page.username   account being signed in
 */
export function classifyStep({ url = "", nodes = [], appOrigin = "", username = "" }) {
  // The popup navigates back to the app's redirect URI once the flow is done.
  if (appOrigin && url.startsWith(appOrigin)) return step(STEP.COMPLETE);

  const text = snapshotText(nodes);
  const errorHeading = nodes.find((n) => n.role === "heading" && ERROR_HEADING.test(n.name));
  if (errorHeading) return step(STEP.ERROR, { message: errorHeading.name });
  if (ERROR_TEXT.test(text)) return step(STEP.ERROR, { message: text });

  // Order matters: later pages reuse the labels of earlier ones, so match the
  // most specific prompt first.
  const codeBox = findByRole(
    nodes,
    ["textbox", "spinbutton"],
    /^(code|verification code|one-time code|enter code)$/i
  );
  const codeHeading = nodes.some(
    (n) => n.role === "heading" && /authenticator app|enter the code|verification code/i.test(n.name)
  );
  if (codeBox && (codeHeading || /code/i.test(codeBox.name))) {
    return step(STEP.TOTP, { input: codeBox.ref, submit: findButton(nodes, SUBMIT)?.ref ?? null });
  }

  const passwordBox = findByRole(nodes, "textbox", /^password$/i);
  if (passwordBox) {
    return step(STEP.PASSWORD, {
      input: passwordBox.ref,
      submit: findButton(nodes, SUBMIT)?.ref ?? null,
    });
  }

  if (nodes.some((n) => n.role === "heading" && /stay signed in/i.test(n.name))) {
    const decline = findButton(nodes, /^(no|don't show this again)$/i);
    return step(STEP.STAY_SIGNED_IN, { submit: decline?.ref ?? null });
  }

  const accept = findButton(nodes, /^(accept|allow|yes)$/i);
  if (accept && findButton(nodes, /^(deny|cancel|no)$/i)) {
    return step(STEP.CONSENT, { submit: accept.ref });
  }

  if (nodes.some((n) => n.role === "heading" && /pick an account|choose an account/i.test(n.name))) {
    const known = username ? findButton(nodes, username) : null;
    return step(STEP.ACCOUNT_PICKER, {
      submit: (known ?? findButton(nodes, /use another account/i))?.ref ?? null,
    });
  }

  const userBox = findByRole(nodes, "textbox", /email|phone|username|someone@|account/i);
  if (userBox) {
    return step(STEP.USERNAME, {
      input: userBox.ref,
      submit: findButton(nodes, SUBMIT)?.ref ?? null,
    });
  }

  return step(STEP.UNKNOWN, { message: text });
}
