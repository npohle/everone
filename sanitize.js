// Lightweight HTML-escaping utility for inserting untrusted strings into HTML
// contexts. Covers the five characters that can break out of an HTML text node
// or attribute value.

const ESC = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>"']/g, (ch) => ESC[ch]);
}
