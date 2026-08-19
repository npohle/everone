// Parser for `agent-browser snapshot` output.
//
// The CLI prints an indented accessibility tree, one node per line:
//
//   - textbox "Email or phone number" [ref=e7]
//   - combobox [expanded=false, ref=e5]: Name (Z→A)
//     - option "Name (A→Z)" [ref=e12]
//
// Tests match on role + accessible name rather than CSS, which is what keeps
// them working across Microsoft's frequent sign-in page redesigns.

const NODE_LINE = /^(\s*)-\s+([A-Za-z][\w-]*)\s*(?:"((?:[^"\\]|\\.)*)")?\s*(?:\[([^\]]*)\])?/;

const BUTTON_ROLES = new Set(["button", "link", "menuitem", "tab", "radio", "checkbox"]);

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq === -1) attrs[token] = true;
    else attrs[token.slice(0, eq).trim()] = token.slice(eq + 1).trim();
  }
  return attrs;
}

/** @returns {Array<{role:string,name:string,ref:string|null,depth:number,attrs:object,line:string}>} */
export function parseSnapshot(text) {
  if (!text) return [];
  const nodes = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("(")) continue;
    const match = NODE_LINE.exec(line);
    if (!match) continue;
    const [, indent, role, name, rawAttrs] = match;
    const attrs = parseAttrs(rawAttrs);
    nodes.push({
      role,
      name: (name ?? "").replace(/\\n/g, "\n").trim(),
      ref: attrs.ref ? `@${attrs.ref}` : null,
      depth: Math.floor(indent.length / 2),
      attrs,
      line: line.trim(),
    });
  }
  return nodes;
}

const matches = (value, pattern) =>
  pattern instanceof RegExp ? pattern.test(value) : value === pattern;

export function findByRole(nodes, role, pattern) {
  const roles = Array.isArray(role) ? role : [role];
  return (
    nodes.find((n) => roles.includes(n.role) && (pattern === undefined || matches(n.name, pattern))) ??
    null
  );
}

/** Buttons, links and other clickable roles, preferring an exact name match. */
export function findButton(nodes, pattern) {
  const clickable = nodes.filter((n) => BUTTON_ROLES.has(n.role) && n.ref);
  return clickable.find((n) => matches(n.name, pattern)) ?? null;
}

/** Flattened visible text of a snapshot — handy for error messages. */
export function snapshotText(nodes) {
  return nodes
    .map((n) => n.name)
    .filter(Boolean)
    .join(" | ");
}
