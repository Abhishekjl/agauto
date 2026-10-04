export interface TailorResult {
  tailoredProfile: string;
  jobTitle: string;
  company: string;
}

const SYSTEM_PROMPT = `You are an expert resume writer. The user will give you their current profile/resume and a job description.

Your task:
1. Extract the job title and company name from the job description.
2. Rewrite the profile so it is most relevant to this role — reorder sections to put the most relevant experience first, sharpen bullet points to emphasize matching skills, and ensure every claim is backed by a metric (%, $, users, time, team size). Do NOT copy JD language verbatim — keep the candidate's voice natural.
3. Include a PROJECTS section with AT LEAST 3 projects. Select and tailor projects from the base profile that are most relevant to the JD. If the base profile has fewer than 3 projects, infer additional plausible ones from the work experience described (e.g. internal tools, open source contributions, side projects) — keeping them realistic and grounded in the experience shown.
4. Keep the full profile to roughly 650 words (suitable for a 2-page resume).
5. Do not invent job titles, employers, degrees, or dates that are not in the original profile.

Output ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "jobTitle": "...",
  "company": "...",
  "tailoredProfile": "..."
}

The tailoredProfile must use this exact structure (all section headers in ALL CAPS):
NAME: [full name]
CONTACT: [email] | [phone] | [location]

SUMMARY
[2-3 sentences tailored to the role]

EXPERIENCE

[Job Title] | [Company] | [Date Range]
• [achievement with metric]
• [achievement with metric]

PROJECTS

[Project Name] | [Tech Stack]
• [what it does and its impact — 1-2 bullets with metrics where possible]

[Project Name] | [Tech Stack]
• [what it does and its impact]

[Project Name] | [Tech Stack]
• [what it does and its impact]

SKILLS
[Category]: [skill1, skill2, ...]

EDUCATION
[Degree] | [Institution] | [Year]`;

export async function tailorProfileToJD(
  profile: string,
  jdText: string
): Promise<TailorResult> {
  const response = await (
    chrome.runtime.sendMessage({
      type: "LLM_CHAT",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `CURRENT PROFILE:\n${profile}\n\nJOB DESCRIPTION:\n${jdText}`,
        },
      ],
    }) as Promise<{ message?: { content?: string }; error?: string }>
  );

  if (response.error) throw new Error(response.error);

  const raw = (response.message?.content ?? "").trim();
  // Strip markdown code fences if the model wrapped the JSON
  const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: TailorResult;
  try {
    parsed = JSON.parse(json) as TailorResult;
  } catch {
    throw new Error("Model returned invalid JSON — try again.");
  }

  if (!parsed.tailoredProfile || !parsed.jobTitle) {
    throw new Error("Incomplete response from model — try again.");
  }

  return parsed;
}
