import type { Page } from "@playwright/test";

// Class names of extend-ui's (shadcn's) primitives, copied verbatim from
// extend-ui/src/components/ui/. vendor/extend-ui/file-system.css is built
// from those sources, so it has every one of these utilities.
const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const BUTTON_VARIANTS = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive:
    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
  outline:
    "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
  ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
};

const BUTTON_SIZES = {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
  "icon-sm": "size-8",
};

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;
export type ButtonSize = keyof typeof BUTTON_SIZES;

export function buttonClass(variant: ButtonVariant, size: ButtonSize): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

export const INPUT_CLASS = [
  "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
].join(" ");

// DialogContent without its positioning and open/close animations.
export const DIALOG_CONTENT_CLASS =
  "grid gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none";

export const DIALOG_TITLE_CLASS = "text-lg leading-none font-semibold";

export const BUTTON_PROPS = [
  "height",
  "padding-left",
  "padding-right",
  "border-top-width",
  "border-top-color",
  "border-radius",
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "box-shadow",
  "opacity",
];

export const INPUT_PROPS = [
  "height",
  "padding-left",
  "padding-right",
  "border-top-width",
  "border-top-color",
  "border-radius",
  "background-color",
  "color",
  "font-family",
  "font-size",
  "box-shadow",
];

export const DIALOG_PROPS = [
  "padding-top",
  "padding-left",
  "border-top-width",
  "border-top-color",
  "border-radius",
  "background-color",
  "color",
  "box-shadow",
];

export const TITLE_PROPS = ["font-size", "font-weight", "line-height"];

export type Styles = Record<string, string>;

/**
 * Computed `props` of the page element matching `selector`, next to those
 * of a `tag` element with extend-ui's `className`, rendered in an
 * `.extend-ui` scope (where extend-ui's theme and reset apply) that is
 * appended to the element's <dialog>, if any, else to <body>. `attributes` are set on the
 * probe, e.g. `disabled`, to compare the same state. Hidden page elements
 * are briefly unhidden to measure them, focused ones are blurred.
 */
export async function compareWithExtendUi(
  page: Page,
  selector: string,
  tag: string,
  className: string,
  props: string[],
  attributes: Record<string, string> = {},
): Promise<{ actual: Styles; expected: Styles }> {
  return page.evaluate(
    ({ selector, tag, className, props, attributes }) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`No element matches ${selector}`);
      const container = el.closest("dialog") ?? document.body;
      const scope = document.createElement("div");
      scope.className = "extend-ui";
      const probe = document.createElement(tag);
      probe.className = className;
      probe.textContent = el.textContent || "x";
      for (const [name, value] of Object.entries(attributes)) probe.setAttribute(name, value);
      scope.appendChild(probe);
      container.appendChild(scope);

      const wasHidden = el.hidden;
      el.hidden = false;
      // The probe isn't focused either (dialogs focus their first control).
      el.blur();
      // Box shadows are a list in Tailwind (rings, insets, then the shadow
      // itself), mostly transparent placeholders: compare the visible ones.
      const normalize = (prop: string, value: string) =>
        prop === "box-shadow"
          ? value
              .split(/,(?![^(]*\))/)
              .map((s) => s.trim())
              .filter((s) => !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(s) && s !== "none")
              .join(", ") || "none"
          : value;
      const read = (node: Element) => {
        const style = getComputedStyle(node);
        return Object.fromEntries(props.map((p) => [p, normalize(p, style.getPropertyValue(p))]));
      };
      const result = { actual: read(el), expected: read(probe) };
      el.hidden = wasHidden;
      scope.remove();
      return result;
    },
    { selector, tag, className, props, attributes },
  );
}

/**
 * The props where the page element and its extend-ui counterpart differ (see
 * compareWithExtendUi()), as `{ prop: { actual, expected } }`; `{}` when
 * they look the same. Meant for `expect.poll(...).toEqual({})`, which also
 * waits out transitions, e.g. after switching color schemes.
 */
export async function differencesFromExtendUi(
  ...args: Parameters<typeof compareWithExtendUi>
): Promise<Record<string, { actual: string; expected: string }>> {
  const { actual, expected } = await compareWithExtendUi(...args);
  return Object.fromEntries(
    Object.keys(expected)
      .filter((p) => actual[p] !== expected[p])
      .map((p) => [p, { actual: actual[p], expected: expected[p] }]),
  );
}
