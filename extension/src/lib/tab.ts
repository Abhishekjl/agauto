import type {
  Action,
  ActionRequest,
  ActionResponse,
  ActionResult,
  ContentRequest,
  ContentResponse,
  InteractiveElement,
  PageState,
  PickedField,
} from "@agauto/shared";

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab.id;
}

/**
 * Send a message to the content script, injecting it first if it isn't there yet.
 * (Content scripts declared in the manifest only auto-inject on page load, so tabs
 * opened before the extension was (re)loaded won't have it — we inject on demand.)
 */
async function send<T>(msg: ContentRequest | ActionRequest): Promise<T> {
  const tabId = await activeTabId();
  try {
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  } catch {
    // Not present — inject then retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      throw new Error(
        "Can't run on this page. Open a normal web page — chrome:// pages, the Web Store, and browser-internal pages are blocked."
      );
    }
    return (await chrome.tabs.sendMessage(tabId, msg)) as T;
  }
}

export async function scanActiveTab(): Promise<PageState> {
  const res = await send<ContentResponse>({ type: "SCAN_PAGE" });
  if (res?.type === "SCAN_RESULT") return res.state;
  throw new Error(res?.type === "SCAN_ERROR" ? res.error : "Scan failed.");
}

export async function runAction(action: Action): Promise<ActionResult> {
  const res = await send<ActionResponse>({ type: "PERFORM_ACTION", action });
  if (res?.type === "ACTION_RESULT") return res.result;
  throw new Error(res?.type === "ACTION_ERROR" ? res.error : "Action failed.");
}

export async function highlightFields(indices: number[]): Promise<void> {
  await send({ type: "HIGHLIGHT_FIELDS", indices });
}

export async function clearHighlights(): Promise<void> {
  await send({ type: "CLEAR_HIGHLIGHT" });
}

/**
 * Take a screenshot of the active tab and draw numbered purple boxes over every
 * visible in-viewport interactive element. The numbers match element indices so
 * the vision model can identify fields by reading the rendered page text rather
 * than relying on parsed DOM labels.
 */
export async function captureAnnotatedScreenshot(
  elements: InteractiveElement[],
  viewport: { width: number; height: number }
): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (!windowId) throw new Error("no active tab");

  // Scroll to top so the screenshot always shows the beginning of the form,
  // where question labels (radio groups etc.) are most likely to be.
  await send<ContentResponse>({ type: "SCROLL_TOP" }).catch(() => {});

  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  // Scale: screenshot pixels per CSS pixel (accounts for devicePixelRatio)
  const sx = img.width / viewport.width;
  const sy = img.height / viewport.height;
  const fontSize = Math.round(11 * sx);
  ctx.font = `bold ${fontSize}px monospace`;

  for (const el of elements) {
    if (!el.geometry.visible || !el.geometry.inViewport) continue;

    const x = Math.round(el.geometry.x * sx);
    const y = Math.round(el.geometry.y * sy);
    const w = Math.max(Math.round(el.geometry.width * sx), 4);
    const h = Math.max(Math.round(el.geometry.height * sy), 4);

    // Box outline
    ctx.strokeStyle = "rgba(99,102,241,0.8)";
    ctx.lineWidth = Math.max(1, Math.round(sx));
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    // Number badge
    const label = String(el.index);
    const tw = ctx.measureText(label).width;
    const pad = Math.round(3 * sx);
    const bw = tw + pad * 2;
    const bh = fontSize + pad;
    const bx = x;
    const by = Math.max(0, y - bh - 1);
    ctx.fillStyle = "#6366f1";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, bx + pad, by + fontSize);
  }

  return canvas.toDataURL("image/png");
}

/** Drag a rectangle over the page; resolve with the fields inside it (or null if cancelled). */
export function pickRegion(): Promise<PickedField[] | null> {
  return new Promise((resolve) => {
    const listener = (msg: unknown) => {
      const m = msg as { type?: string; fields?: PickedField[] };
      if (m?.type === "FIELDS_PICKED") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(m.fields ?? []);
      } else if (m?.type === "FIELD_PICK_CANCELLED") {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(null);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    send({ type: "REGION_PICK" }).catch(() => {
      chrome.runtime.onMessage.removeListener(listener);
      resolve(null);
    });
  });
}
