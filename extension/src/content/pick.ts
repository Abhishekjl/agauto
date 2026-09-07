import type { PickMessage } from "@agauto/shared";
import { scanPage } from "./scan";

let cleanup: (() => void) | null = null;
let hovered: HTMLElement | null = null;

/**
 * Enter "pick a field" mode: the user clicks an element on the page, and we report
 * which interactive field (data-agauto-index) they picked so the agent can fill only that one.
 */
export function startPick(): void {
  scanPage(); // stamp data-agauto-index on interactive elements
  cancelPick();

  const onMove = (e: MouseEvent) => {
    const el = targetField(e.target as HTMLElement);
    if (el === hovered) return;
    clearHover();
    if (el) {
      el.style.outline = "2px dashed #6366f1";
      el.style.outlineOffset = "1px";
      hovered = el;
    }
  };

  const onClick = (e: MouseEvent) => {
    const el = targetField(e.target as HTMLElement);
    e.preventDefault();
    e.stopPropagation();
    cancelPick();
    if (el) {
      const index = Number(el.getAttribute("data-agauto-index"));
      send({ type: "FIELD_PICKED", index, label: labelFor(el) });
    } else {
      send({ type: "FIELD_PICK_CANCELLED" });
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cancelPick();
      send({ type: "FIELD_PICK_CANCELLED" });
    }
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    clearHover();
  };
}

function cancelPick(): void {
  if (cleanup) cleanup();
  cleanup = null;
}

function clearHover(): void {
  if (hovered) {
    hovered.style.outline = "";
    hovered.style.outlineOffset = "";
    hovered = null;
  }
}

/** Nearest ancestor (or self) that was stamped as an interactive field. */
function targetField(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  return el.closest("[data-agauto-index]") as HTMLElement | null;
}

function labelFor(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim().slice(0, 120);
  const ph = el.getAttribute("placeholder");
  if (ph?.trim()) return ph.trim();
  const name = el.getAttribute("name");
  if (name) return name;
  return (el.textContent || "field").trim().slice(0, 80) || "field";
}

function send(msg: PickMessage): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

/* ------------------------- region (rectangle) pick ------------------------- */

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Drag a rectangle over the page; report every interactive field that falls inside it,
 * so the agent fills only that region.
 */
export function startRegionPick(): void {
  scanPage();
  cancelPick();

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(99,102,241,0.05);";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:2px dashed #6366f1;background:rgba(99,102,241,0.12);display:none;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(overlay);
  document.body.appendChild(box);

  let x0 = 0;
  let y0 = 0;
  let dragging = false;

  const rectFrom = (ax: number, ay: number, bx: number, by: number): ScreenRect => ({
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  });

  const drawBox = (e: MouseEvent) => {
    const r = rectFrom(x0, y0, e.clientX, e.clientY);
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.right - r.left + "px";
    box.style.height = r.bottom - r.top + "px";
  };

  const onDown = (e: MouseEvent) => {
    dragging = true;
    x0 = e.clientX;
    y0 = e.clientY;
    box.style.display = "block";
    drawBox(e);
    e.preventDefault();
  };
  const onMove = (e: MouseEvent) => {
    if (dragging) drawBox(e);
  };
  const onUp = (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;
    const sel = rectFrom(x0, y0, e.clientX, e.clientY);
    teardown();
    // A tiny click (not a drag) selects nothing — cancel.
    if (sel.right - sel.left < 5 && sel.bottom - sel.top < 5) {
      send({ type: "FIELD_PICK_CANCELLED" });
      return;
    }
    const fields: { index: number; label: string; rect: ScreenRect }[] = [];
    collectFields(document, 0, 0, fields);
    const chosen = fields
      .filter((f) => intersects(f.rect, sel))
      .map((f) => ({ index: f.index, label: f.label }));
    send({ type: "FIELDS_PICKED", fields: chosen });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      teardown();
      send({ type: "FIELD_PICK_CANCELLED" });
    }
  };

  overlay.addEventListener("mousedown", onDown, true);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  document.addEventListener("keydown", onKey, true);

  function teardown() {
    overlay.remove();
    box.remove();
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("keydown", onKey, true);
    cleanup = null;
  }
  cleanup = teardown;
}

/** Collect all stamped fields with viewport-relative rects (accounting for iframe offsets). */
function collectFields(
  root: Document | ShadowRoot,
  ox: number,
  oy: number,
  out: { index: number; label: string; rect: ScreenRect }[]
): void {
  root.querySelectorAll("*").forEach((node) => {
    const el = node as HTMLElement;
    if (el.hasAttribute("data-agauto-index")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        out.push({
          index: Number(el.getAttribute("data-agauto-index")),
          label: labelFor(el),
          rect: { left: r.left + ox, top: r.top + oy, right: r.right + ox, bottom: r.bottom + oy },
        });
      }
    }
    const sr = el.shadowRoot;
    if (sr) collectFields(sr, ox, oy, out); // shadow shares host coordinate space
    if (el instanceof HTMLIFrameElement) {
      let doc: Document | null = null;
      try {
        doc = el.contentDocument;
      } catch {
        doc = null;
      }
      if (doc) {
        const ir = el.getBoundingClientRect();
        collectFields(doc, ox + ir.left, oy + ir.top, out);
      }
    }
  });
}

function intersects(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
