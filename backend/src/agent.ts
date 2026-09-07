import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type {
  Action,
  AgentStep,
  PageState,
  StartSessionRequest,
} from "@agauto/shared";
import { client } from "./llm";
import { env } from "./env";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

interface Session {
  id: string;
  messages: Msg[];
  /** tool_call id we are currently waiting on the extension/user to fulfil */
  pendingToolCallId: string | null;
  pendingSubmitIndex?: number;
  updatedAt: number;
}

const sessions = new Map<string, Session>();

/* ------------------------------- prompt ------------------------------- */

const SYSTEM_PROMPT = `You are AgAuto, an agent that fills out web forms on the user's behalf.

You are given the user's profile and a list of the page's interactive elements,
each with a numeric index (#N). Use the tools to fill the form ONE action at a time.

Rules:
- Fill fields from the profile, inferring reasonable values where you safely can.
- For open-ended writing fields (cover letter, "why do you want this role?",
  "tell us about yourself", short essays), COMPOSE a concise, professional answer
  yourself from the profile and context — do NOT ask the user for these.
- Use ask_user ONLY for specific personal values you cannot infer or generate
  (e.g. exact desired salary, earliest start date, a yes/no you have no basis for).
  When you do, also provide field_label: a short canonical label (e.g. "Desired salary")
  so the answer can be saved and reused.
- Follow the user's Instructions exactly (e.g. availability, points to emphasize).
- If a Job description is provided, tailor open-ended answers to it — emphasize the
  most relevant experience and align phrasing with the role.
- Match values to fields by their labels. For native <select>, pass an option value or
  label that appears in the options list.
- For CUSTOM (non-native) dropdowns and date pickers, click the control to OPEN it. The
  page then updates and the options/days appear as new elements — click the correct one.
- For +/- stepper or quantity controls, click the increment (+) or decrement (-) button
  repeatedly, re-checking the field's value after each click, until it reaches the target.
  Native range sliders can be set with type_text (the numeric value).
- Some forms span MULTIPLE pages/steps. When the current page's fields are complete and a
  Next/Continue button exists, click it to proceed; the page updates and you continue.
  Only call finish when the ENTIRE application is complete and the final submit is present.
- NEVER click a submit/apply button yourself. When the form is fully filled and ready,
  call finish with a short summary and the index of the submit button (if present).
  The user approves before anything is submitted.
- To attach the user's document (resume/CV, cover letter, etc.) to a file-upload
  field, call upload_document with that field's index (only if a document is available).
- Prefer visible, enabled fields. Skip fields that are already correct.
- Be concise. Take one tool action per turn.`;

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
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

const TOOLS: Tool[] = [
  fn(
    "type_text",
    "Type text into a text input, textarea, or contenteditable field.",
    { index: { type: "integer" }, text: { type: "string" } },
    ["index", "text"]
  ),
  fn(
    "select_option",
    "Choose an option in a native <select>. Provide value or label from its options.",
    {
      index: { type: "integer" },
      value: { type: "string" },
      label: { type: "string" },
    },
    ["index"]
  ),
  fn(
    "set_checkbox",
    "Check or uncheck a checkbox or radio.",
    { index: { type: "integer" }, checked: { type: "boolean" } },
    ["index", "checked"]
  ),
  fn(
    "click",
    "Click a button, link, radio, or custom control (e.g. Next, expand a section).",
    { index: { type: "integer" } },
    ["index"]
  ),
  fn(
    "scroll_to",
    "Scroll an element into view.",
    { index: { type: "integer" } },
    ["index"]
  ),
  fn(
    "upload_document",
    "Attach the user's stored document (resume/CV, cover letter, etc.) to a file-upload field.",
    { index: { type: "integer" } },
    ["index"]
  ),
  fn(
    "ask_user",
    "Ask the user for a specific personal value you cannot infer or generate.",
    {
      question: { type: "string" },
      field_label: {
        type: "string",
        description: "short canonical label to save the answer under, e.g. 'Desired salary'",
      },
    },
    ["question", "field_label"]
  ),
  fn(
    "finish",
    "Call when the form is fully filled and ready to submit. Do NOT click submit yourself.",
    { summary: { type: "string" }, submit_index: { type: "integer" } },
    ["summary"]
  ),
];

/* ------------------------------ helpers ------------------------------- */

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

/** Call the model once, interpret its single tool call, and return the next step. */
async function advance(session: Session): Promise<AgentStep> {
  const completion = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: session.messages,
    tools: TOOLS,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });

  const msg = completion.choices[0]?.message;
  if (!msg) return err(session, "empty model response");

  session.messages.push(msg as Msg);
  session.updatedAt = Date.now();

  const call = msg.tool_calls?.[0];
  if (!call) {
    return { kind: "done", sessionId: session.id, summary: msg.content ?? "Done." };
  }

  const name = call.function.name;
  const args = parseArgs(call.function.arguments);
  session.pendingToolCallId = call.id;

  if (name === "ask_user") {
    return {
      kind: "ask",
      sessionId: session.id,
      question: String(args.question ?? "?"),
      key: String(args.field_label ?? args.question ?? "answer"),
    };
  }
  if (name === "finish") {
    const submitIndex =
      args.submit_index !== undefined ? Number(args.submit_index) : undefined;
    session.pendingSubmitIndex = submitIndex;
    return {
      kind: "approval",
      sessionId: session.id,
      summary: String(args.summary ?? "Ready to submit."),
      submitIndex,
    };
  }

  const action = toAction(name, args);
  if (!action) {
    // Unknown tool — feed an error back so the model can recover.
    session.messages.push(toolResult(call.id, `unknown tool: ${name}`));
    return advance(session);
  }

  return {
    kind: "actions",
    sessionId: session.id,
    actions: [{ toolCallId: call.id, action }],
  };
}

function toolResult(toolCallId: string, content: string): Msg {
  return { role: "tool", tool_call_id: toolCallId, content };
}

function err(session: Session, error: string): AgentStep {
  return { kind: "error", sessionId: session.id, error };
}

/* ------------------------------- public ------------------------------- */

export async function startSession(req: StartSessionRequest): Promise<AgentStep> {
  const session: Session = {
    id: randomUUID(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `My profile:\n${req.profile.raw}\n\n` +
          (req.hasDocument
            ? "A document file is attached and can be uploaded via upload_document.\n\n"
            : "") +
          `Instructions: ${req.goal}\n\n` +
          (req.jobDescription?.trim()
            ? `Job description to tailor answers to:\n${req.jobDescription.trim()}\n\n`
            : "") +
          (req.hints?.trim()
            ? `Semantic field→fact suggestions (verify before using):\n${req.hints.trim()}\n\n`
            : "") +
          `Current page:\n${serializeState(req.pageState)}`,
      },
    ],
    pendingToolCallId: null,
    updatedAt: Date.now(),
  };
  sessions.set(session.id, session);
  return advance(session);
}

export async function stepSession(req: {
  sessionId: string;
  results?: { toolCallId: string; result: unknown }[];
  userAnswer?: string;
  approved?: boolean;
  pageState?: PageState;
}): Promise<AgentStep> {
  const session = sessions.get(req.sessionId);
  if (!session) {
    return { kind: "error", sessionId: req.sessionId, error: "unknown session" };
  }

  // Fulfil the pending tool call from whatever the extension/user returned.
  if (req.results?.length) {
    for (const r of req.results) {
      session.messages.push(toolResult(r.toolCallId, JSON.stringify(r.result)));
    }
  } else if (req.userAnswer !== undefined && session.pendingToolCallId) {
    session.messages.push(
      toolResult(session.pendingToolCallId, `User answered: ${req.userAnswer}`)
    );
  } else if (req.approved !== undefined && session.pendingToolCallId) {
    if (req.approved) {
      session.messages.push(
        toolResult(session.pendingToolCallId, "User approved and the form was submitted.")
      );
      session.pendingToolCallId = null;
      return { kind: "done", sessionId: session.id, summary: "Submitted." };
    }
    session.messages.push(
      toolResult(
        session.pendingToolCallId,
        `User did NOT approve. Feedback: ${req.userAnswer ?? "please revise"}`
      )
    );
  }

  session.pendingToolCallId = null;

  if (req.pageState) {
    session.messages.push({
      role: "user",
      content: `Updated page:\n${serializeState(req.pageState)}`,
    });
  }

  return advance(session);
}
