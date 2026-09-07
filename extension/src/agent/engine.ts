import type { Action, PageState } from "@agauto/shared";
import { chatCompletion, type ChatMessage, type Tool } from "../lib/llm";

export interface ToolAction {
  toolCallId: string;
  action: Action;
}

export type EngineStep =
  | { kind: "actions"; actions: ToolAction[] }
  | { kind: "ask"; question: string; key: string }
  | { kind: "approval"; summary: string; submitIndex?: number }
  | { kind: "done"; summary: string }
  | { kind: "error"; error: string };

export interface StartParams {
  profile: string;
  goal: string;
  jobDescription?: string;
  hints?: string;
  hasDocument: boolean;
  pageState: PageState;
}

const SYSTEM_PROMPT = `You are AgAuto, an agent that fills out web forms on the user's behalf.

You are given the user's profile and a list of the page's interactive elements,
each with a numeric index (#N). Use the tools to fill the form ONE action at a time.

Rules:
- READ EACH QUESTION LITERALLY and answer exactly what it asks — nothing else.
  Watch for ambiguous words: on application forms, "languages" means HUMAN
  languages (English, Hindi, Spanish...) unless it explicitly says programming
  languages. "References" means people, not citations. If the question text
  includes an example answer, mirror that example's format exactly.
- Fill fields from the profile, inferring reasonable values where you safely can.
  If the profile does not contain what a question asks for, use ask_user —
  NEVER substitute unrelated profile content just because keywords overlap.
- For open-ended writing fields (cover letter, "why do you want this role?",
  "tell us about yourself", short essays), COMPOSE a concise, professional answer
  yourself from the profile and context — do NOT ask the user for these.
- Use ask_user ONLY for specific personal values you cannot infer or generate
  (e.g. exact desired salary, earliest start date, a yes/no you have no basis for).
  When you do, also provide field_label: a short canonical label (e.g. "Desired salary").
- Follow the user's Instructions exactly. If a Job description is provided, tailor
  open-ended answers to it — emphasize the most relevant experience.
- Match values to fields by labels. For native <select>, pass an option value/label
  from its options. For CUSTOM dropdowns/date pickers, click to OPEN, then click the
  option/day that appears. For +/- steppers, click the +/- button repeatedly, checking
  the value each time. Native range sliders can be set with type_text.
- Element indices are RE-ASSIGNED on every page rescan. NEVER reuse an index from an
  older page listing — act only on the LATEST "Updated page" state. Click results
  include the clicked element's text: check it is what you intended (option lists
  have near-identical neighbors, e.g. "India" vs "Indonesia"). After choosing a
  dropdown option, VERIFY in the updated page state that the field now displays the
  intended value; if it shows the wrong one, correct it before moving on.
- Answer EVERY required radio-group question. Custom radios/checkboxes may show a
  tiny size or unusual geometry because the real input is styled by its label —
  set_checkbox handles them; do not skip the question.
- Some forms span MULTIPLE pages: when a page is done and a Next/Continue button exists,
  click it. Only call finish when the ENTIRE application is complete.
- NEVER click submit yourself — call finish with a short summary and the submit button's
  index (if present). The user approves before anything is submitted.
- To attach the user's document to a file-upload field, call upload_document.
- Prefer visible, enabled fields. Skip fields already correct. Be concise; one action per turn.`;

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): Tool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

const TOOLS: Tool[] = [
  fn("type_text", "Type text into a text input, textarea, or contenteditable field.",
    { index: { type: "integer" }, text: { type: "string" } }, ["index", "text"]),
  fn("select_option", "Choose an option in a native <select>. Provide value or label.",
    { index: { type: "integer" }, value: { type: "string" }, label: { type: "string" } }, ["index"]),
  fn("set_checkbox", "Check or uncheck a checkbox or radio.",
    { index: { type: "integer" }, checked: { type: "boolean" } }, ["index", "checked"]),
  fn("click", "Click a button, link, radio, or custom control.",
    { index: { type: "integer" } }, ["index"]),
  fn("scroll_to", "Scroll an element into view.", { index: { type: "integer" } }, ["index"]),
  fn("upload_document", "Attach the user's stored document to a file-upload field.",
    { index: { type: "integer" } }, ["index"]),
  fn("ask_user", "Ask the user for a specific personal value you cannot infer or generate.",
    { question: { type: "string" }, field_label: { type: "string" } }, ["question", "field_label"]),
  fn("finish", "Call when the form is filled and ready. Do NOT click submit yourself.",
    { summary: { type: "string" }, submit_index: { type: "integer" } }, ["summary"]),
];

function serializeState(s: PageState): string {
  const lines = s.elements.map((e) => {
    const parts = [`#${e.index}`, `[${e.kind}]`];
    if (e.label) parts.push(JSON.stringify(e.label));
    if (e.required) parts.push("(required)");
    if (e.options?.length)
      parts.push(`options=[${e.options.map((o) => o.label || o.value).join(" | ")}]`);
    if (e.value) parts.push(`value=${JSON.stringify(e.value)}`);
    if (e.kind === "checkbox" || e.kind === "radio")
      parts.push(`checked=${e.checked ? "yes" : "no"}`);
    if (!e.geometry.visible) parts.push("<hidden>");
    return parts.join(" ");
  });
  return `Page: ${s.title} (${s.url})\nInteractive elements:\n${lines.join("\n")}`;
}

function toAction(name: string, args: Record<string, unknown>): Action | null {
  const index = Number(args.index);
  switch (name) {
    case "type_text":
      return { type: "type_text", index, text: String(args.text ?? "") };
    case "select_option":
      return {
        type: "select_option",
        index,
        value: args.value as string | undefined,
        label: args.label as string | undefined,
      };
    case "set_checkbox":
      return { type: "set_checkbox", index, checked: Boolean(args.checked) };
    case "click":
      return { type: "click", index };
    case "scroll_to":
      return { type: "scroll_to", index };
    case "upload_document":
      return { type: "upload_document", index };
    default:
      return null;
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function toolResult(id: string, content: string): ChatMessage {
  return { role: "tool", tool_call_id: id, content };
}

/** Client-side agent session — holds the conversation and drives the model. */
export class AgentEngine {
  private messages: ChatMessage[] = [];
  private pendingId: string | null = null;

  start(p: StartParams): void {
    const content =
      `My profile:\n${p.profile}\n\n` +
      (p.hasDocument ? "A document file is attached; upload it via upload_document.\n\n" : "") +
      `Instructions: ${p.goal}\n\n` +
      (p.jobDescription?.trim() ? `Job description to tailor answers to:\n${p.jobDescription.trim()}\n\n` : "") +
      (p.hints?.trim()
        ? `Semantic field→fact suggestions (fuzzy auto-matches — they are often WRONG for open-ended questions; use one only if it truly answers the actual question):\n${p.hints.trim()}\n\n`
        : "") +
      `Current page:\n${serializeState(p.pageState)}`;
    this.messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ];
    this.pendingId = null;
  }

  async advance(): Promise<EngineStep> {
    let msg: ChatMessage;
    try {
      msg = await chatCompletion(this.messages, TOOLS);
    } catch (e) {
      return { kind: "error", error: e instanceof Error ? e.message : "model call failed" };
    }
    this.messages.push(msg);

    const call = msg.tool_calls?.[0];
    if (!call) {
      return { kind: "done", summary: typeof msg.content === "string" ? msg.content : "Done." };
    }
    this.pendingId = call.id;
    const name = call.function.name;
    const args = parseArgs(call.function.arguments);

    if (name === "ask_user") {
      return {
        kind: "ask",
        question: String(args.question ?? "?"),
        key: String(args.field_label ?? args.question ?? "answer"),
      };
    }
    if (name === "finish") {
      const s = args.submit_index;
      return {
        kind: "approval",
        summary: String(args.summary ?? "Ready to submit."),
        submitIndex: s !== undefined ? Number(s) : undefined,
      };
    }
    const action = toAction(name, args);
    if (!action) {
      this.messages.push(toolResult(call.id, `unknown tool: ${name}`));
      return this.advance();
    }
    return { kind: "actions", actions: [{ toolCallId: call.id, action }] };
  }

  addResults(results: { toolCallId: string; result: unknown }[]): void {
    for (const r of results) this.messages.push(toolResult(r.toolCallId, JSON.stringify(r.result)));
    this.pendingId = null;
  }

  addAnswer(text: string): void {
    if (this.pendingId) this.messages.push(toolResult(this.pendingId, `User answered: ${text}`));
    this.pendingId = null;
  }

  addRejection(feedback: string): void {
    if (this.pendingId)
      this.messages.push(
        toolResult(this.pendingId, `User did NOT approve. Feedback: ${feedback || "please revise"}`)
      );
    this.pendingId = null;
  }

  addPageState(s: PageState): void {
    this.messages.push({ role: "user", content: `Updated page:\n${serializeState(s)}` });
  }

  /** Free-form user message (e.g. after the user fixed a failed field manually). */
  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }
}
