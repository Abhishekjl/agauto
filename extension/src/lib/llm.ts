// Client-side LLM access. The actual network call happens in the background
// service worker (which can reach configured hosts, including http); here we
// just message it. No backend server involved.

export interface ToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type Tool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export async function chatCompletion(
  messages: ChatMessage[],
  tools?: Tool[]
): Promise<ChatMessage> {
  const res = (await chrome.runtime.sendMessage({ type: "LLM_CHAT", messages, tools })) as {
    message?: ChatMessage;
    error?: string;
  };
  if (!res || res.error || !res.message) {
    throw new Error(res?.error ?? "LLM call failed");
  }
  return res.message;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const res = (await chrome.runtime.sendMessage({ type: "LLM_EMBED", texts })) as {
    vectors?: number[][];
    error?: string;
  };
  if (!res || res.error || !res.vectors) {
    throw new Error(res?.error ?? "embed failed");
  }
  return res.vectors;
}
