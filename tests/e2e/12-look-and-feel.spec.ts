import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import {
  BUTTON_PROPS,
  DIALOG_CONTENT_CLASS,
  DIALOG_PROPS,
  DIALOG_TITLE_CLASS,
  INPUT_CLASS,
  INPUT_PROPS,
  TITLE_PROPS,
  buttonClass,
  differencesFromExtendUi,
  type ButtonSize,
  type ButtonVariant,
} from "./lib/extend-ui.ts";
import { selectFolder } from "./lib/listing.ts";

// The page's own controls (plain HTML, styled by styles.css) are compared
// with extend-ui's primitives, as rendered by vendor/extend-ui/file-system.css,
// in both color schemes.
const SCHEMES = ["light", "dark"] as const;

type ButtonSpec = [selector: string, variant: ButtonVariant, size: ButtonSize, attributes?: Record<string, string>];

// Nothing is selected in the listing yet, so the folder actions are disabled.
const PAGE_BUTTONS: ButtonSpec[] = [
  ["#up-btn", "outline", "default", { disabled: "" }],
  ["#new-folder-btn", "outline", "default", { disabled: "" }],
  ["#delete-folder-btn", "outline", "default", { disabled: "" }],
  ["#upload-btn", "outline", "default", { disabled: "" }],
  ["#auth-btn", "outline", "sm"],
  ["#cf-auth-btn", "outline", "sm"],
  ["#viewer-scribe", "outline", "sm"],
  ["#viewer-extract", "outline", "sm", { disabled: "" }],
  ["#viewer-download", "outline", "sm"],
  ["#viewer-open", "outline", "sm"],
];

const DIALOGS: [selector: string, buttons: ButtonSpec[]][] = [
  ["#new-folder-dialog", [
    ["#new-folder-cancel", "outline", "default"],
    ["#new-folder-create", "default", "default"],
  ]],
  ["#delete-folder-dialog", [
    ["#delete-folder-cancel", "outline", "default"],
    ["#delete-folder-confirm", "destructive", "default"],
  ]],
  ["#upload-dialog", [
    ["#upload-select", "outline", "default"],
    ["#upload-cancel", "outline", "default"],
    ["#upload-start", "default", "default"],
  ]],
  ["#scribe-dialog", [["#scribe-close", "default", "default"]]],
  ["#extract-dialog", [["#extract-close", "default", "default"]]],
];

async function expectButtonsLikeExtendUi(page: Page, buttons: ButtonSpec[]) {
  for (const [selector, variant, size, attributes] of buttons) {
    await expect
      .poll(
        () => differencesFromExtendUi(page, selector, "button", buttonClass(variant, size), BUTTON_PROPS, attributes),
        { message: `${selector} looks like Button (${variant}, ${size})` },
      )
      .toEqual({});
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(`https://rubisco.io/`);
  await expect(page.getByText("Loading")).not.toBeVisible();
  await expect(page.locator("#listing [role=treeitem]").first()).toBeVisible();
});

for (const scheme of SCHEMES) {
  test(`LOOK-001: buttons look like extend-ui's Button (${scheme})`, async ({ page }) => {
    const artefactsDir = process.env.ARTEFACTS_DIR;
    await page.emulateMedia({ colorScheme: scheme });
    await expectButtonsLikeExtendUi(page, PAGE_BUTTONS);
    // Once the scheme's transitions are over.
    await page.screenshot({ path: `${artefactsDir}/12-01-buttons-${scheme}.png` });
  });

  test(`LOOK-002: inputs look like extend-ui's Input (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => differencesFromExtendUi(page, "#search", "input", INPUT_CLASS, INPUT_PROPS), { message: "#search" })
      .toEqual({});

    await selectFolder(page, "Documents");
    await page.getByRole("button", { name: "New Folder" }).click();
    await expect(page.getByRole("dialog", { name: "New Folder" })).toBeVisible();
    await expect
      .poll(() => differencesFromExtendUi(page, "#new-folder-name", "input", INPUT_CLASS, INPUT_PROPS), {
        message: "#new-folder-name",
      })
      .toEqual({});

    // Textareas share the Input's look, apart from their size and font.
    const textareaProps = INPUT_PROPS.filter((p) => !["height", "font-family", "font-size"].includes(p));
    await page.evaluate(() => document.querySelector<HTMLDialogElement>("#scribe-dialog")!.showModal());
    await expect
      .poll(() => differencesFromExtendUi(page, "#scribe-text", "input", INPUT_CLASS, textareaProps), {
        message: "#scribe-text",
      })
      .toEqual({});
  });

  test(`LOOK-003: dialogs look like extend-ui's Dialog (${scheme})`, async ({ page }) => {
    const artefactsDir = process.env.ARTEFACTS_DIR;
    await page.emulateMedia({ colorScheme: scheme });

    for (const [selector, buttons] of DIALOGS) {
      await page.evaluate((s) => document.querySelector<HTMLDialogElement>(s)!.showModal(), selector);

      await expect
        .poll(() => differencesFromExtendUi(page, selector, "div", DIALOG_CONTENT_CLASS, DIALOG_PROPS), {
          message: `${selector} looks like DialogContent`,
        })
        .toEqual({});
      await expect
        .poll(() => differencesFromExtendUi(page, `${selector} h2`, "h2", DIALOG_TITLE_CLASS, TITLE_PROPS), {
          message: `${selector} h2 looks like DialogTitle`,
        })
        .toEqual({});
      await expectButtonsLikeExtendUi(page, buttons);
      await page.screenshot({ path: `${artefactsDir}/12-03-${selector.slice(1)}-${scheme}.png` });

      await page.evaluate((s) => document.querySelector<HTMLDialogElement>(s)!.close(), selector);
    }
  });

  test(`LOOK-004: the page uses extend-ui's font and colors (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // Body and listing side by side; equal once the scheme has switched.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const [body, listing] = [document.body, document.querySelector("#listing.extend-ui")!].map((el) => {
            const s = getComputedStyle(el);
            return { fontFamily: s.fontFamily, color: s.color, backgroundColor: s.backgroundColor };
          });
          return Object.keys(body).filter((p) => body[p] !== listing[p]).map((p) => `${p}: ${body[p]} != ${listing[p]}`);
        }),
      )
      .toEqual([]);
  });

  test(`LOOK-005: upload list buttons look like extend-ui's icon Button (${scheme})`, async ({ page }) => {
    const artefactsDir = process.env.ARTEFACTS_DIR;
    await page.emulateMedia({ colorScheme: scheme });
    await selectFolder(page, "Documents");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("dialog", { name: "Upload Files" })).toBeVisible();
    // Buttons are inline-flex, but [hidden] ones stay hidden.
    await expect(page.locator("#upload-close")).toBeHidden();
    await page.locator("#upload-input").setInputFiles({
      name: "look-and-feel.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("extend-ui"),
    });
    await expect(page.locator(".upload-remove")).toBeVisible();

    // Like the File System's own toolbar icons, these are muted.
    const ghostIcon = `${buttonClass("ghost", "icon-sm")} text-muted-foreground`;
    for (const [selector, attributes] of [[".upload-suggest", { disabled: "" }], [".upload-remove", {}]] as const) {
      await expect
        .poll(() => differencesFromExtendUi(page, selector, "button", ghostIcon, BUTTON_PROPS.filter((p) => p !== "opacity"), attributes), {
          message: `${selector} looks like Button (ghost, icon-sm)`,
        })
        .toEqual({});
    }
    await expectButtonsLikeExtendUi(page, [["#upload-start", "default", "default"]]);
    await page.screenshot({ path: `${artefactsDir}/12-05-upload-list-${scheme}.png` });
  });
}
