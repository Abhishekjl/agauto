// Shared contracts between the extension and the backend.

/* ------------------------------------------------------------------ */
/* Phase 0 — chat pipeline check                                       */
/* ------------------------------------------------------------------ */

export interface ChatRequest {
  prompt: string;
}

export interface ChatResponse {
  reply: string;
  model: string;
}

export interface ApiError {
  error: string;
}

/* ------------------------------------------------------------------ */
/* Phase 1 — perception (page state)                                   */
/* ------------------------------------------------------------------ */

export type FieldKind =
  | "text"
  | "textarea"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "select"
  | "checkbox"
  | "radio"
  | "date"
  | "file"
  | "button"
  | "link"
  | "contenteditable"
  | "other";

export interface ElementGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** intersects the current viewport */
  inViewport: boolean;
  /** has a layout box and is not display:none / visibility:hidden */
  visible: boolean;
}

export interface FieldOption {
  value: string;
  label: string;
  selected: boolean;
}

export interface InteractiveElement {
  /** stable index within this scan; also stamped as data-agauto-index on the DOM node */
  index: number;
  kind: FieldKind;
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  /** best-effort human label (aria, <label>, placeholder, humanized name…) */
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  role?: string;
  /** current text value, or contenteditable/button/link text */
  value?: string;
  /** for combobox — whether the dropdown list is currently open */
  ariaExpanded?: boolean;
  /** for checkbox / radio */
  checked?: boolean;
  /** radio group name */
  radioGroup?: string;
  /** for <select> */
  options?: FieldOption[];
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  geometry: ElementGeometry;
  /** frame indices to reach this element ([] = top document) */
  framePath: number[];
  /** selector to re-find within its own document */
  selector: string;
}

export interface PageState {
  url: string;
  title: string;
  scannedAt: number;
  elementCount: number;
  elements: InteractiveElement[];
  /** CSS-pixel dimensions of the visible viewport at scan time */
  viewport: { width: number; height: number };
}

/* ------------------------------------------------------------------ */
/* Extension messaging (side panel <-> content script)                 */
/* ------------------------------------------------------------------ */

export type ContentRequest =
  | { type: "SCAN_PAGE" }
  | { type: "HIGHLIGHT_FIELDS"; indices: number[] }
  | { type: "CLEAR_HIGHLIGHT" }
  | { type: "SCROLL_TOP" }
  | { type: "PICK_FIELD" }
  | { type: "REGION_PICK" };

export interface PickedField {
  index: number;
  label: string;
}

/** Broadcast (chrome.runtime) from the content script when the user picks field(s). */
export type PickMessage =
  | { type: "FIELD_PICKED"; index: number; label: string }
  | { type: "FIELDS_PICKED"; fields: PickedField[] }
  | { type: "FIELD_PICK_CANCELLED" };

export type ContentResponse =
  | { type: "SCAN_RESULT"; state: PageState }
  | { type: "SCAN_ERROR"; error: string }
  | { type: "OK" };

/* ------------------------------------------------------------------ */
/* Phase 2 — actions                                                   */
/* ------------------------------------------------------------------ */

export type Action =
  | { type: "type_text"; index: number; text: string }
  | { type: "select_option"; index: number; value?: string; label?: string }
  | { type: "set_checkbox"; index: number; checked: boolean }
  | { type: "click"; index: number }
  /** atomic custom-dropdown: opens the trigger then clicks the matching option */
  | { type: "pick_option"; index: number; option_label: string }
  | {
      type: "upload_file";
      index: number;
      filename: string;
      mimeType: string;
      /** base64-encoded file contents */
      dataBase64: string;
    }
  /** attach the user's stored document to a file input (bytes filled in by the side panel) */
  | { type: "upload_document"; index: number }
  | { type: "scroll_to"; index: number };

export interface ActionResult {
  ok: boolean;
  index: number;
  action: Action["type"];
  /** post-action value, for verification */
  value?: string;
  message?: string;
}

export type ActionRequest = { type: "PERFORM_ACTION"; action: Action };

export type ActionResponse =
  | { type: "ACTION_RESULT"; result: ActionResult }
  | { type: "ACTION_ERROR"; error: string };

/* ------------------------------------------------------------------ */
/* Phase 3 — agent session (side panel <-> backend)                    */
/* ------------------------------------------------------------------ */

export interface AgentProfile {
  /** free-text profile for now (name, email, phone, experience…). Structured in Phase 4. */
  raw: string;
}

export interface ToolAction {
  toolCallId: string;
  action: Action;
}

export interface ToolActionResult {
  toolCallId: string;
  result: ActionResult;
}

export interface StartSessionRequest {
  /** free-form per-run instructions ("I'm available immediately; emphasize MCP work") */
  goal: string;
  profile: AgentProfile;
  pageState: PageState;
  /** whether a document file is stored and available for upload_document */
  hasDocument?: boolean;
  /** optional job description to tailor open-ended answers to */
  jobDescription?: string;
  /** semantic field→fact suggestions (from the answer bank) */
  hints?: string;
}

/* ------------------------------------------------------------------ */
/* Phase 5 — embeddings / answer bank                                  */
/* ------------------------------------------------------------------ */

export interface EmbedRequest {
  texts: string[];
}

export interface EmbedResponse {
  vectors: number[][];
}

/* ------------------------------------------------------------------ */
/* Phase 4 — document ingestion (vision + text)                        */
/* ------------------------------------------------------------------ */

/**
 * An open, extensible profile is just a list of facts — no fixed schema.
 * A fact is any label→value the model finds in a document, or any answer the
 * user adds/learns (salary, relocation, custom screening questions, …).
 */
export interface ProfileFact {
  label: string;
  value: string;
}

/**
 * Extract profile/preferences from a document. Vision-only for image-based docs
 * (PDF pages rendered to PNG, or an uploaded image); plain-text docs (.txt) send
 * their text directly. At least one of images / text must be present.
 */
export interface ExtractProfileRequest {
  /** page images as data URLs (data:image/png;base64,...) — for PDF/image docs */
  images?: string[];
  /** raw text — for .txt (and other text) documents */
  text?: string;
  filename?: string;
}

export interface ExtractProfileResponse {
  /** well-formatted plain-text profile extracted from the document */
  text: string;
}

export interface StepSessionRequest {
  sessionId: string;
  /** results of the actions returned by the previous step */
  results?: ToolActionResult[];
  /** answer to a prior ask_user */
  userAnswer?: string;
  /** response to an approval step (true = submit, false = revise) */
  approved?: boolean;
  /** fresh page state, sent after navigation/clicks */
  pageState?: PageState;
}

/** One turn of the agent loop, returned by the backend. */
export type AgentStep =
  | { kind: "actions"; sessionId: string; actions: ToolAction[] }
  | { kind: "ask"; sessionId: string; question: string; key: string }
  | { kind: "approval"; sessionId: string; summary: string; submitIndex?: number }
  | { kind: "done"; sessionId: string; summary: string }
  | { kind: "error"; sessionId: string; error: string };
