import { chatCompletion } from "./llm";

const SYSTEM =
  "You read a resume/CV or profile document and transcribe its FULL content into a clean, " +
  "well-organized plain-text profile, preserving every detail. Return ONLY the profile text.";

const INSTRUCTIONS = `Transcribe the FULL content of this document into a clean, well-organized
plain-text profile. Preserve ALL details — do NOT summarize, shorten, or omit anything. This is
the agent's complete knowledge base for filling forms, so completeness matters more than brevity.

Include (only what's present):

Name: ...
Email: ...
Phone: ...
Location: ...
Work authorization: ...
Links: ...

Summary:
  <the full summary/objective, verbatim>

Skills: <every skill listed>

Experience:
  - <Title> @ <Company> (<dates>)
      - <every bullet point / responsibility / achievement, one per line>

Projects:
  - <Project name> — <full description>
      - <technologies, details, links>

Education:
  - <Degree>, <School> (<year>) — <any details>

Certifications / Awards / Publications:
  - <each item>

Capture every bullet point and every project. Keep clear section headers and indentation.
Do not invent anything. Return only the profile text (no JSON, no code fences, no commentary).`;

/** Extract a well-formatted text profile from document images and/or text. */
export async function extractProfileFromDoc(input: {
  images?: string[];
  text?: string;
}): Promise<string> {
  const content: unknown[] = [{ type: "text", text: INSTRUCTIONS }];
  if (input.text?.trim()) {
    content.push({ type: "text", text: `Document text:\n${input.text.trim()}` });
  }
  for (const url of input.images ?? []) {
    content.push({ type: "image_url", image_url: { url } });
  }

  const msg = await chatCompletion([
    { role: "system", content: SYSTEM },
    { role: "user", content },
  ]);

  let out = typeof msg.content === "string" ? msg.content.trim() : "";
  if (out.startsWith("```")) {
    out = out.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  }
  return out;
}
