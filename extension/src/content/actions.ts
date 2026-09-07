import type { Action, ActionResult } from "@agauto/shared";

/**
 * Perform a single action against an element found by its scan index
 * (the data-agauto-index attribute stamped during scanPage()).
 *
 * Every mutation dispatches the events frameworks listen for (native value
 * setter + input/change), so React/Vue/Angular register the change.
 */
export function performAction(action: Action): ActionResult {
  const el = findByIndex(action.index);
  if (!el) {
    return fail(action, "element not found — re-scan the page (DOM may have changed)");
  }

  flash(el);

  switch (action.type) {
    case "type_text":
      return typeText(el, action);
    case "select_option":
      return selectOption(el, action);
    case "set_checkbox":
      return setCheckbox(el, action);
    case "click":
      return click(el, action);
    case "upload_file":
      return uploadFile(el, action);
    case "scroll_to":
      el.scrollIntoView({ block: "center", inline: "nearest" });
      return ok(action);
    case "upload_document":
      // Translated to upload_file by the side panel (which holds the bytes);
      // if it reaches here, the document wasn't attached.
      return fail(action, "document upload is handled by the side panel");
    default: {
      const _exhaustive: never = action;
      return { ok: false, index: -1, action: "click", message: "unknown action" };
    }
  }
}

/* ------------------------- individual actions ------------------------- */

function typeText(
  el: HTMLElement,
  action: Extract<Action, { type: "type_text" }>
): ActionResult {
  el.scrollIntoView({ block: "center" });
  (el as HTMLElement).focus();

  if (el.isContentEditable) {
    el.textContent = action.text;
    dispatch(el, "input");
    return ok(action, (el.textContent || "").trim());
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, action.text);
    dispatch(el, "input");
    dispatch(el, "change");
    return ok(action, el.value);
  }

  return fail(action, "element is not a text field");
}

function selectOption(
  el: HTMLElement,
  action: Extract<Action, { type: "select_option" }>
): ActionResult {
  if (!(el instanceof HTMLSelectElement)) {
    return fail(
      action,
      "not a native <select> — for custom dropdowns, click to open then click the option"
    );
  }
  const opt = Array.from(el.options).find(
    (o) =>
      (action.value !== undefined && o.value === action.value) ||
      (action.label !== undefined &&
        (o.label || o.text).trim().toLowerCase() ===
          action.label.trim().toLowerCase())
  );
  if (!opt) return fail(action, "no matching option");

  el.value = opt.value;
  dispatch(el, "input");
  dispatch(el, "change");
  return ok(action, el.value);
}

function setCheckbox(
  el: HTMLElement,
  action: Extract<Action, { type: "set_checkbox" }>
): ActionResult {
  const current = isChecked(el);
  if (current !== action.checked) {
    el.scrollIntoView({ block: "center" });
    // Custom controls hide the real input and style the label — click that.
    checkboxClickTarget(el).click();
    // Framework-controlled input that ignored the click — set checked natively.
    if (isChecked(el) !== action.checked && el instanceof HTMLInputElement) {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
      if (desc?.set) desc.set.call(el, action.checked);
      else el.checked = action.checked;
      dispatch(el, "input");
      dispatch(el, "change");
    }
  }
  const after = isChecked(el);
  return {
    ok: after === action.checked,
    index: action.index,
    action: action.type,
    value: String(after),
    message: after === action.checked ? undefined : "state did not change",
  };
}

/** The visible click target for a checkbox/radio whose input is hidden by CSS. */
function checkboxClickTarget(el: HTMLElement): HTMLElement {
  if (!(el instanceof HTMLInputElement)) return el;
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const invisible =
    r.width < 2 || r.height < 2 || style.opacity === "0" || style.visibility === "hidden";
  if (!invisible) return el;
  const wrapping = el.closest("label");
  if (wrapping) return wrapping;
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const forLabel = root.querySelector(
      `label[for="${el.id.replace(/["\\]/g, "\\$&")}"]`
    ) as HTMLElement | null;
    if (forLabel) return forLabel;
  }
  return el;
}

function click(
  el: HTMLElement,
  action: Extract<Action, { type: "click" }>
): ActionResult {
  el.scrollIntoView({ block: "center" });
  el.click();
  // Report what was clicked so the agent can catch a mis-click (stale index,
  // adjacent option — e.g. "Indonesia" when it meant "India").
  return ok(action, clickedText(el));
}

function clickedText(el: HTMLElement): string | undefined {
  const t =
    (el.textContent || "").trim() ||
    (el.getAttribute("aria-label") || "").trim() ||
    (el instanceof HTMLInputElement ? el.value : "");
  return t ? t.slice(0, 120) : undefined;
}

function uploadFile(
  el: HTMLElement,
  action: Extract<Action, { type: "upload_file" }>
): ActionResult {
  if (!(el instanceof HTMLInputElement) || el.type !== "file") {
    return fail(action, "not a file input");
  }
  try {
    const bytes = base64ToBytes(action.dataBase64);
    const file = new File([bytes], action.filename, { type: action.mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    dispatch(el, "input");
    dispatch(el, "change");
    return {
      ok: el.files.length > 0,
      index: action.index,
      action: action.type,
      value: file.name,
    };
  } catch (e) {
    return fail(action, e instanceof Error ? e.message : "upload failed");
  }
}

/* --------------------------- dry-run preview ------------------------- */

let highlighted: HTMLElement[] = [];

/** Outline the given fields (by scan index) in green — the dry-run preview. */
export function highlightFields(indices: number[]): void {
  clearHighlights();
  for (const idx of indices) {
    const el = findByIndex(idx);
    if (!el) continue;
    el.style.outline = "2px solid #10b981";
    el.style.outlineOffset = "1px";
    highlighted.push(el);
  }
}

export function clearHighlights(): void {
  for (const el of highlighted) {
    el.style.outline = "";
    el.style.outlineOffset = "";
  }
  highlighted = [];
}

/* ----------------------------- helpers ------------------------------- */

/** Find an element by data-agauto-index across light DOM, shadow roots, and same-origin iframes. */
function findByIndex(index: number): HTMLElement | null {
  const sel = `[data-agauto-index="${index}"]`;

  function search(root: Document | ShadowRoot): HTMLElement | null {
    const direct = root.querySelector(sel) as HTMLElement | null;
    if (direct) return direct;

    for (const node of Array.from(root.querySelectorAll("*"))) {
      const el = node as HTMLElement;
      if (el.shadowRoot) {
        const found = search(el.shadowRoot);
        if (found) return found;
      }
      if (el instanceof HTMLIFrameElement) {
        let doc: Document | null = null;
        try {
          doc = el.contentDocument;
        } catch {
          doc = null;
        }
        if (doc) {
          const found = search(doc);
          if (found) return found;
        }
      }
    }
    return null;
  }

  return search(document);
}

function isChecked(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.getAttribute("aria-checked") === "true";
}

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

function dispatch(el: HTMLElement, type: "input" | "change"): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buffer = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function flash(el: HTMLElement): void {
  const prev = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid #6366f1";
  el.style.outlineOffset = "1px";
  window.setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOffset;
  }, 600);
}

function ok(action: Action, value?: string): ActionResult {
  return { ok: true, index: action.index, action: action.type, value };
}

function fail(action: Action, message: string): ActionResult {
  return { ok: false, index: action.index, action: action.type, message };
}
