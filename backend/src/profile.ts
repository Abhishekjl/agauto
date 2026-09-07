import OpenAI from "openai";
import type { ExtractProfileRequest, ExtractProfileResponse } from "@agauto/shared";
import { client } from "./llm";
import { env } from "./env";

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

const SYSTEM =
  "You read a resume/CV or profile document and rewrite it as a clean, " +
  "well-organized plain-text profile. Return ONLY the profile text.";

const INSTRUCTIONS = `Produce a clean, well-formatted plain-text profile from the document.
Use clear labeled sections and consistent indentation. Follow this shape (include only what's present):

Name: ...
Email: ...
Phone: ...
Location: ...
Work authorization: ...
Links: ...

Summary:
  <2-3 lines>

Skills: <comma-separated list>

Experience:
  - <Title> @ <Company> (<dates>)
      <one concise line>

Education:
  - <Degree>, <School> (<year>)

Only include what's in the document. Do not invent anything. Return only the profile text
(no JSON, no code fences, no commentary).`;

export async function extractProfile(
  req: ExtractProfileRequest
): Promise<ExtractProfileResponse> {
  const content: Part[] = [{ type: "text", text: INSTRUCTIONS }];
  if (req.text?.trim()) {
    content.push({ type: "text", text: `Document text:\n${req.text.trim()}` });
  }
  for (const url of req.images ?? []) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const completion = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
  });

  let text = (completion.choices[0]?.message?.content ?? "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  }
  console.log("\n──────── document extraction ────────\n" + text + "\n─────────\n");
  return { text };
}
