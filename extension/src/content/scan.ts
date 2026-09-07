import type {
  ElementGeometry,
  FieldKind,
  FieldOption,
  InteractiveElement,
  PageState,
} from "@agauto/shared";

/**
 * Walk the full DOM — light DOM, open shadow roots, and same-origin iframes —
 * and produce an indexed list of interactive elements. Off-screen fields are
 * included (marked visible but inViewport:false), so the agent sees the whole
 * form without scrolling.
 *
 * Each element is stamped with `data-agauto-index="N"` so Phase 2 actions can
 * re-find it reliably (more robust than a generated CSS selector).
 */
export function scanPage(): PageState {
  const elements: InteractiveElement[] = [];
  let elIndex = 0;
  let frameCounter = 0;

  function walk(root: Document | ShadowRoot, framePath: number[]) {
    const all = root.querySelectorAll("*");
    all.forEach((node) => {
      const el = node as HTMLElement;

      if (isInteractive(el)) {
        el.setAttribute("data-agauto-index", String(elIndex));
        elements.push(describe(el, elIndex, framePath));
        elIndex++;
      }

      // Descend into an open shadow root.
      const sr = el.shadowRoot;
      if (sr) walk(sr, framePath);

      // Descend into a same-origin iframe.
      if (el instanceof HTMLIFrameElement) {
        let doc: Document | null = null;
        try {
          doc = el.contentDocument;
        } catch {
          doc = null; // cross-origin — inaccessible
        }
        if (doc) {
          const frameIndex = frameCounter++;
          el.setAttribute("data-agauto-frame", String(frameIndex));
          walk(doc, [...framePath, frameIndex]);
        }
      }
    });
  }

  walk(document, []);

  return {
    url: location.href,
    title: document.title,
    scannedAt: Date.now(),
    elementCount: elements.length,
    elements,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

/* ------------------------------------------------------------------ */

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "radio",
  "combobox",
  "textbox",
  "switch",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option", // custom-dropdown options (appear after opening)
  "tab",
]);

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();

  if (tag === "input") {
    return (el as HTMLInputElement).type !== "hidden";
  }
  if (tag === "textarea" || tag === "select" || tag === "button") return true;
  if (tag === "a") return el.hasAttribute("href");
  if (el.isContentEditable) return true;

  const role = el.getAttribute("role");
  return role != null && INTERACTIVE_ROLES.has(role);
}

function describe(
  el: HTMLElement,
  index: number,
  framePath: number[]
): InteractiveElement {
  const tag = el.tagName.toLowerCase();
  const kind = getKind(el, tag);
  const anyEl = el as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;

  const item: InteractiveElement = {
    index,
    kind,
    tag,
    type: el.getAttribute("type") ?? undefined,
    name: el.getAttribute("name") ?? undefined,
    id: el.id || undefined,
    label: getLabel(el),
    placeholder: el.getAttribute("placeholder") ?? undefined,
    ariaLabel: el.getAttribute("aria-label") ?? undefined,
    role: el.getAttribute("role") ?? undefined,
    required:
      el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
    disabled:
      anyEl.disabled === true || el.getAttribute("aria-disabled") === "true",
    readOnly: anyEl.readOnly === true,
    geometry: getGeometry(el),
    framePath,
    selector: `[data-agauto-index="${index}"]`,
  };

  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    item.options = Array.from(sel.options).map<FieldOption>((o) => ({
      value: o.value,
      label: (o.label || o.text || "").trim(),
      selected: o.selected,
    }));
    item.value = sel.value;
  } else if (kind === "checkbox" || kind === "radio") {
    const input = el as HTMLInputElement;
    item.checked =
      input.checked ?? el.getAttribute("aria-checked") === "true";
    item.value = input.value || undefined;
    if (kind === "radio") item.radioGroup = input.name || undefined;
    // Custom controls hide the real input and style the label — if the label
    // is visible, treat the control as visible so the agent doesn't skip it.
    if (!item.geometry.visible) {
      const lbl = visibleLabelFor(el);
      if (lbl) item.geometry.visible = true;
    }
    // Attach the GROUP question (e.g. "Are you authorized to work?") to the option's
    // own label ("Yes") — that prompt text isn't an interactive element, so the agent
    // would never see it otherwise.
    const gq = groupQuestion(el);
    if (gq) {
      const optionText =
        item.label && item.label.toLowerCase() !== gq.toLowerCase()
          ? item.label          // already a distinct per-option label
          : optionLabel(el);    // fallback: sibling text, value attr, aria-label
      item.label = optionText ? `${gq} — ${optionText}` : gq;
    }
  } else if (el.isContentEditable) {
    item.value = (el.textContent || "").trim().slice(0, 500);
  } else if (tag === "input" || tag === "textarea") {
    item.value = anyEl.value ?? undefined;
  } else if (tag === "a" || tag === "button" || item.role === "button") {
    item.value = (el.textContent || "").trim().slice(0, 200);
  } else if (item.role === "combobox") {
    // Custom dropdown: expose displayed text and open/closed state so the
    // agent can confirm a selection without re-clicking the trigger.
    item.value = (el.textContent || "").trim().slice(0, 200) || undefined;
    const expanded = el.getAttribute("aria-expanded");
    if (expanded !== null) item.ariaExpanded = expanded === "true";
  }

  return item;
}

/**
 * The per-option label for a radio/checkbox when getLabel() only returned the group
 * question text. Tries, in order:
 *   1. Sibling visible text node / span / div right next to the input
 *   2. aria-label on the input itself
 *   3. The input's value attribute (e.g. "yes", "no", "true")
 */
function optionLabel(el: HTMLElement): string | undefined {
  // 1. Next sibling text (common pattern: <input type=radio><span>Yes</span>)
  let sib = el.nextSibling;
  while (sib) {
    if (sib.nodeType === Node.TEXT_NODE) {
      const t = sib.textContent?.trim();
      if (t && t.length > 0) return t.slice(0, 80);
    } else if (sib instanceof HTMLElement) {
      const tag = sib.tagName.toLowerCase();
      // stop at another interactive element — that's a different field
      if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button") break;
      const t = (sib.textContent || "").trim();
      if (t && t.length > 0) return t.slice(0, 80);
    }
    sib = sib.nextSibling;
  }
  // 2. aria-label
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria.slice(0, 80);
  // 3. value attribute (e.g. value="yes" / value="no")
  const val = (el as HTMLInputElement).value?.trim();
  if (val && val !== "on") return val.slice(0, 80);
  return undefined;
}

/**
 * The group question for a radio/checkbox — the prompt text shown above a set of
 * options (e.g. "Are you authorized to work?"). It usually isn't tied to the inputs
 * via for/id and isn't itself interactive, so it must be found and attached here.
 * Scoped to the group's own container to avoid grabbing an unrelated heading.
 */
function groupQuestion(el: HTMLElement): string | undefined {
  const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

  const legend = el.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
  if (legend) return clip(legend);

  const name = el.getAttribute("name");
  if (!name) return undefined;
  const root = el.getRootNode() as Document | ShadowRoot;
  const group = Array.from(root.querySelectorAll(`input[name="${cssEscape(name)}"]`));
  if (group.length < 2) return undefined; // lone control — its own label is enough

  // smallest ancestor that contains the whole group
  let container: HTMLElement | null = el.parentElement;
  while (container && !group.every((n) => container!.contains(n))) {
    container = container.parentElement;
  }
  if (!container) return undefined;

  // first text label in that container that isn't an option label
  const cands = container.querySelectorAll(
    "legend, label, [class*='label'], [class*='question'], h1,h2,h3,h4,h5,h6"
  );
  for (const node of Array.from(cands)) {
    const c = node as HTMLElement;
    if (c.getAttribute("for")) continue; // an option's own label
    if (c.querySelector("input, select, textarea")) continue; // wraps a control
    const t = c.textContent?.trim();
    if (t && t.length > 3) return clip(t);
  }
  return undefined;
}

/** The visible label element associated with an input, if any. */
function visibleLabelFor(el: HTMLElement): HTMLElement | null {
  const candidates: (HTMLElement | null)[] = [el.closest("label")];
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    candidates.push(
      root.querySelector(`label[for="${cssEscape(el.id)}"]`) as HTMLElement | null
    );
  }
  for (const lbl of candidates) {
    if (!lbl) continue;
    const r = lbl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return lbl;
  }
  return null;
}

function getKind(el: HTMLElement, tag: string): FieldKind {
  if (tag === "textarea") return "textarea";
  if (tag === "select") return "select";
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (el.isContentEditable) return "contenteditable";

  if (tag === "input") {
    const t = (el as HTMLInputElement).type;
    switch (t) {
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "email":
        return "email";
      case "password":
        return "password";
      case "number":
        return "number";
      case "tel":
        return "tel";
      case "url":
        return "url";
      case "date":
      case "datetime-local":
      case "month":
      case "week":
      case "time":
        return "date";
      case "file":
        return "file";
      case "submit":
      case "button":
      case "reset":
        return "button";
      default:
        return "text";
    }
  }

  const role = el.getAttribute("role");
  if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox")
    return "checkbox";
  if (role === "radio" || role === "menuitemradio") return "radio";
  if (role === "combobox") return "select";
  if (role === "textbox") return "text";
  if (role === "link") return "link";
  // options / tabs / menuitems / buttons are all click targets
  if (role === "button" || role === "option" || role === "tab" || role === "menuitem")
    return "button";
  return "other";
}

function getGeometry(el: HTMLElement): ElementGeometry {
  const rect = el.getBoundingClientRect();
  const hasBox = rect.width > 0 || rect.height > 0;

  // checkVisibility is not in all lib.dom versions — guard it.
  const cv = (el as unknown as {
    checkVisibility?: (opts?: object) => boolean;
  }).checkVisibility;
  const cssVisible = typeof cv === "function" ? cv.call(el, { checkVisibilityCSS: true }) : true;

  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const inViewport =
    rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    inViewport,
    visible: hasBox && cssVisible,
  };
}

const LABEL_MAX = 400;

function getLabel(el: HTMLElement): string | undefined {
  const root = el.getRootNode() as Document | ShadowRoot;

  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim().slice(0, LABEL_MAX);

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const txt = labelledby
      .split(/\s+/)
      .map((id) => (root as Document).getElementById?.(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (txt) return squash(txt);
  }

  if (el.id) {
    const forLabel = root.querySelector(
      `label[for="${cssEscape(el.id)}"]`
    ) as HTMLElement | null;
    if (forLabel?.textContent?.trim()) return squash(forLabel.textContent);
  }

  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) return squash(wrapping.textContent);

  // aria-describedby often carries the question / helper text on custom forms
  const describedby = el.getAttribute("aria-describedby");
  if (describedby) {
    const txt = describedby
      .split(/\s+/)
      .map((id) => (root as Document).getElementById?.(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (txt) return squash(txt);
  }

  // Div-based form builders put the question text in a sibling/ancestor <div>,
  // not a <label>. Look for the nearest preceding text block.
  const nearby = nearbyQuestionText(el);
  if (nearby) return nearby;

  const ph = el.getAttribute("placeholder");
  if (ph?.trim()) return ph.trim();

  const name = el.getAttribute("name");
  if (name) return humanize(name);

  return undefined;
}

/**
 * Walk up the ancestors (a few levels) and take the text of the closest
 * preceding sibling that reads like a question/label. Stop at siblings that
 * contain form controls — that text belongs to a *different* field.
 */
function nearbyQuestionText(el: HTMLElement): string | undefined {
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 5 && node; depth++) {
    let sib = node.previousElementSibling as HTMLElement | null;
    while (sib) {
      if (sib.querySelector("input, textarea, select, button")) break;
      const t = squash(sib.textContent ?? "");
      if (t && t.length >= 3) return t;
      sib = sib.previousElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
  }
  return undefined;
}

function squash(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

function humanize(raw: string): string {
  return raw
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function cssEscape(value: string): string {
  const CSSref = (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (CSSref?.escape) return CSSref.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
