import type { Action, ActionResult } from "@agauto/shared";

/**
 * Perform a single action against an element found by its scan index
 * (the data-agauto-index attribute stamped during scanPage()).
 *
 * Every mutation dispatches the events frameworks listen for (native value
 * setter + input/change), so React/Vue/Angular register the change.
 *
 * Returns a Promise so pick_option can await DOM mutations without blocking.
 */
export async function performAction(action: Action): Promise<ActionResult> {
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
    case "pick_option":
      return pickOption(el, action);
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

async function setCheckbox(
  el: HTMLElement,
  action: Extract<Action, { type: "set_checkbox" }>
): Promise<ActionResult> {
  const current = isChecked(el);
  if (current !== action.checked) {
    el.scrollIntoView({ block: "center" });

    // Try 1: JS click on the best visible target.
    checkboxClickTarget(el).click();

    // Try 2: if JS click didn't register, fire a real CDP hardware mouse event.
    // React/Vue always respond to these. We wait 150 ms afterward so the framework
    // has time to process the event and commit its re-render before we read state —
    // without the wait we'd read el.checked before React updates the DOM.
    if (isChecked(el) !== action.checked) {
      await cdpClick(el);
      await new Promise<void>((r) => window.setTimeout(r, 150));
    }
    // NOTE: no native-property fallback — setting el.checked directly causes a false
    // positive because React overrides it on the next render, making ok=true lie.
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

/**
 * Fire a real CDP mouse click at the best visible coordinates for el.
 * Runs in the content script but routes through the background service worker
 * which holds the chrome.debugger permission.
 */
async function cdpClick(el: HTMLElement): Promise<void> {
  const coords = cdpClickCoords(el);
  if (!coords) return;
  await (chrome.runtime.sendMessage({ type: "CDP_CLICK", x: coords.x, y: coords.y }) as Promise<unknown>).catch(() => {});
}

/**
 * Find the center viewport-coordinates of the best visible click target for a
 * (possibly hidden) input. Priority order:
 *   1. el itself (handles visible custom checkboxes/radios — div/span with role=checkbox)
 *   2. label/for link (handles hidden <input> with an associated <label>)
 *   3. next sibling (hidden input + adjacent visible span/div pattern)
 *   4. first visible ancestor (last resort)
 */
function cdpClickCoords(el: HTMLElement): { x: number; y: number } | null {
  function center(r: DOMRect) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // 1. The element itself — catches visible custom checkbox/radio divs.
  const elRect = el.getBoundingClientRect();
  if (elRect.width > 0 && elRect.height > 0) return center(elRect);

  // 2. Label target for hidden <input> (wrapping <label> or <label for=id>).
  const target = checkboxClickTarget(el);
  if (target !== el) {
    const r = target.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return center(r);
  }

  // 3. Next sibling — often the visible styled checkbox/radio span.
  const sib = el.nextElementSibling as HTMLElement | null;
  if (sib) {
    const r = sib.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return center(r);
  }

  // 4. First visible ancestor.
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const r = node.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) return center(r);
    node = node.parentElement;
  }

  return null;
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

/**
 * Atomic custom-dropdown handler: opens the trigger, waits for options to
 * appear in the DOM (including portals rendered at document.body level), then
 * clicks the best-matching option — all in one content-script turn so the LLM
 * never has to reason about intermediate open/closed state.
 */
async function pickOption(
  el: HTMLElement,
  action: Extract<Action, { type: "pick_option" }>
): Promise<ActionResult> {
  el.scrollIntoView({ block: "center" });
  el.click(); // open the dropdown

  const option = await waitForOption(action.option_label, 2500);
  if (!option) {
    return fail(
      action,
      `option "${action.option_label}" not found after opening dropdown — ` +
        "verify the label exactly matches one of the available choices"
    );
  }

  flash(option);
  option.scrollIntoView({ block: "nearest" });
  option.click();

  // Return the exact text of the option we clicked so the agent can verify.
  return ok(action, (option.textContent || "").trim().slice(0, 120) || action.option_label);
}

/**
 * Wait up to timeoutMs for a visible option element matching label to appear
 * anywhere in the document (handles portal/overlay rendering patterns used by
 * React Select, Ant Design, Headless UI, etc.).
 */
function waitForOption(label: string, timeoutMs: number): Promise<HTMLElement | null> {
  const OPTION_SEL =
    '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
  const norm = label.trim().toLowerCase();

  function findOption(): HTMLElement | null {
    let partial: HTMLElement | null = null;
    for (const node of Array.from(document.querySelectorAll(OPTION_SEL))) {
      const candidate = node as HTMLElement;
      const r = candidate.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered yet
      const text = (candidate.textContent || "").trim().toLowerCase();
      if (text === norm) return candidate; // exact match — done
      if (!partial && (text.includes(norm) || norm.includes(text))) partial = candidate;
    }
    return partial;
  }

  // Options might already be in the DOM (e.g. opened before this call).
  const immediate = findOption();
  if (immediate) return Promise.resolve(immediate);

  return new Promise<HTMLElement | null>((resolve) => {
    const observer = new MutationObserver(() => {
      const found = findOption();
      if (found) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(findOption()); // last chance
    }, timeoutMs);
  });
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
