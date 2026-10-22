/**
 * WCAG 2.5.3 Label in Name, the check behind axe's `label-content-name-mismatch`.
 *
 * Playwright runs that rule in CI. The jsdom axe suite cannot: the rule decides
 * what is visible from layout, and jsdom has none, so a control can ship with an
 * `aria-label` that drops the words on screen (the points chip said "pts" and
 * was named "points"). This repeats the rule from the text itself.
 */

export type LabelInNameMismatch = {
  /** Accessible name from aria-label or aria-labelledby. */
  name: string;
  /** Text a person can see inside the control. */
  visible: string;
  html: string;
};

const NAME_FROM_CONTENT = new Set([
  "button",
  "checkbox",
  "columnheader",
  "gridcell",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);

const EXPLICIT_ROLE = [...NAME_FROM_CONTENT].map((role) => `[role="${role}"]`).join(",");

/** Controls whose accessible name is allowed to come from their contents. */
const CONTROL = `a[href], button, summary, input[type="button"], input[type="submit"], input[type="reset"], ${EXPLICIT_ROLE}`;

/** Visible words must appear, in order, inside the accessible name. */
export function labelInNameMismatches(root: ParentNode): LabelInNameMismatch[] {
  const mismatches: LabelInNameMismatch[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(CONTROL)) {
    if (hiddenFromTree(element)) continue;
    if (!element.hasAttribute("aria-label") && !element.hasAttribute("aria-labelledby")) continue;
    const visible = visibleText(element);
    if (!visible) continue;
    const name = accessibleName(element);
    if (labelContainedInName(visible, name)) continue;
    mismatches.push({
      name,
      visible,
      html: element.outerHTML.replace(/\s+/g, " ").slice(0, 180),
    });
  }
  return mismatches;
}

export function labelContainedInName(visible: string, name: string): boolean {
  const needle = words(visible);
  if (needle.length === 0) return true;
  const haystack = words(name);
  if (haystack.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, index) => word === haystack[start + index])) return true;
  }
  return false;
}

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const doc = element.ownerDocument;
    return labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ");
  }
  return element.getAttribute("aria-label") ?? "";
}

function visibleText(element: HTMLElement): string {
  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as HTMLElement;
    if (child !== element && hiddenFromTree(child)) return;
    child.childNodes.forEach(visit);
  };
  visit(element);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function hiddenFromTree(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (element.hasAttribute("hidden")) return true;
  return element.classList.contains("sr-only");
}

function words(value: string): string[] {
  let text = value.normalize("NFKD").toLowerCase();
  let previous: string;
  do {
    previous = text;
    text = text.replace(/\([^()]*\)/g, " ");
  } while (text !== previous);
  return text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
