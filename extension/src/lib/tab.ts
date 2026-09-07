import type {
  Action,
  ActionRequest,
  ActionResponse,
  ActionResult,
  ContentRequest,
  ContentResponse,
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
