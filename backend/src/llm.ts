import OpenAI from "openai";
import { env } from "./env";

// Provider-neutral: works with any OpenAI-compatible endpoint via baseURL.
export const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY || "not-set",
  baseURL: env.OPENAI_BASE_URL,
});

const SYSTEM_PROMPT =
  "You are AgAuto, an assistant that will eventually read and fill web forms. " +
  "For now this is a pipeline check — reply briefly and helpfully.";

// Separate client for embeddings (may be a different endpoint/key than chat).
export const embedClient = new OpenAI({
  apiKey: env.EMBED_API_KEY || "not-set",
  baseURL: env.EMBED_BASE_URL,
});

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await embedClient.embeddings.create({
    model: env.EMBED_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding as number[]);
}

export async function chat(prompt: string): Promise<{ reply: string; model: string }> {
  const completion = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  });

  return {
    reply: completion.choices[0]?.message?.content ?? "",
    model: completion.model || env.OPENAI_MODEL,
  };
}
