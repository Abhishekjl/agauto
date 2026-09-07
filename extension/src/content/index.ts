import type {
  ActionRequest,
  ActionResponse,
  ContentRequest,
  ContentResponse,
} from "@agauto/shared";
import { scanPage } from "./scan";
import { clearHighlights, highlightFields, performAction } from "./actions";
import { startPick, startRegionPick } from "./pick";

type Incoming = ContentRequest | ActionRequest;
type Outgoing = ContentResponse | ActionResponse;

// Content script: runs in the top frame of every page. Handles scan + action
// requests from the side panel.
chrome.runtime.onMessage.addListener(
  (msg: Incoming, _sender, sendResponse: (r: Outgoing) => void) => {
    try {
      if (msg?.type === "SCAN_PAGE") {
        sendResponse({ type: "SCAN_RESULT", state: scanPage() });
        return true;
      }
      if (msg?.type === "PERFORM_ACTION") {
        sendResponse({ type: "ACTION_RESULT", result: performAction(msg.action) });
        return true;
      }
      if (msg?.type === "HIGHLIGHT_FIELDS") {
        highlightFields(msg.indices);
        sendResponse({ type: "OK" });
        return true;
      }
      if (msg?.type === "CLEAR_HIGHLIGHT") {
        clearHighlights();
        sendResponse({ type: "OK" });
        return true;
      }
      if (msg?.type === "PICK_FIELD") {
        startPick();
        sendResponse({ type: "OK" });
        return true;
      }
      if (msg?.type === "REGION_PICK") {
        startRegionPick();
        sendResponse({ type: "OK" });
        return true;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse(
        msg?.type === "PERFORM_ACTION"
          ? { type: "ACTION_ERROR", error }
          : { type: "SCAN_ERROR", error }
      );
      return true;
    }
    return undefined;
  }
);

(window as unknown as { __agautoContentReady?: boolean }).__agautoContentReady = true;
