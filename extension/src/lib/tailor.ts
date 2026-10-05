export interface TailorResult {
  tailoredProfile: string;
  jobTitle: string;
  company: string;
}

/* ------------------------------------------------------------------ */
/* Step 1 — extract actionable signals from the JD                    */
/* ------------------------------------------------------------------ */

const ANALYZE_PROMPT = `You are a technical recruiter. Read the job description and extract the most important signals a candidate must address.

Output ONLY valid JSON — no markdown, no explanation:
{
  "jobTitle": "exact job title from the JD",
  "company": "company name, or empty string if not found",
  "mustHave": ["specific technology or skill explicitly required — e.g. MCP server, RAG pipeline, TypeScript"],
  "niceToHave": ["mentioned but not mandatory"],
  "domain": "one-line domain summary — e.g. AI agent tooling, fintech payments, developer infrastructure",
  "senioritySignals": ["phrases that reveal seniority — e.g. lead a team, design system architecture, own the roadmap"],
  "keyResponsibilities": ["top 4 responsibilities in plain English"]
}

Be specific. If the JD says "MCP server" — output "MCP server", not "API development". Extract the real terms.`;

/* ------------------------------------------------------------------ */
/* Step 2 — rewrite the resume using the signals                      */
/* ------------------------------------------------------------------ */

function buildTailorPrompt(analysis: JDAnalysis): string {
  return `You are a senior resume writer. You will receive a candidate's profile and a structured analysis of a job description. Your job is to rewrite the profile into a tailored, metrics-driven resume.

JD ANALYSIS:
- Role: ${analysis.jobTitle} at ${analysis.company || "the company"}
- Domain: ${analysis.domain}
- Must-have skills/technologies: ${analysis.mustHave.join(", ")}
- Nice-to-have: ${analysis.niceToHave.join(", ")}
- Seniority signals: ${analysis.senioritySignals.join(", ")}
- Key responsibilities: ${analysis.keyResponsibilities.map((r, i) => `${i + 1}. ${r}`).join("; ")}

RULES — follow every rule exactly:

SIGNAL MAPPING (most important rule):
- For every item in must-have skills, find evidence in the candidate's profile and surface it prominently.
- If the candidate has worked with that technology (even indirectly) — name it explicitly in bullets or projects.
- If the JD mentions "MCP server" and the candidate built any server/tool/agent — frame that project around MCP concepts.
- If a must-have is completely absent from the profile — add it to Skills under "Familiar with" and add a short project that demonstrates learning/exploration of it.
- Never ignore a must-have signal. Every one must appear somewhere in the final resume.

EXPERIENCE BULLETS:
- Minimum 4 bullets per role.
- Every bullet must contain a real number: %, $, users, requests/sec, ms latency, team size, hours saved, etc.
- If the original profile has no number for a bullet — derive a plausible one from context (e.g. "built an internal tool" → "reduced manual processing time by ~60%") or reframe to show scale.
- Lead with the strongest, most JD-relevant bullet for each role.

PROJECTS (minimum 3, tailored to JD signals):
- Each project must address at least one must-have signal from the JD.
- Format: Problem → Solution (with specific tech) → Outcome (with metric).
- If the profile has fewer than 3 relevant projects, derive additional ones from work experience (internal tools, automations, open source contributions) — keep them realistic.
- Mention the exact technology keywords from the JD naturally within project descriptions.

SKILLS:
- Group by JD priority: put must-have categories first.
- Include all must-have technologies in skills, even if adding them.

SUMMARY:
- 3 sentences. Sentence 1: candidate's identity + years. Sentence 2: most relevant achievement. Sentence 3: direct call-out of the JD domain using natural language (not copied from JD).

LENGTH: ~700 words total. Never truncate experience to fit — trim summary/skills instead.

Output ONLY valid JSON — no markdown, no explanation:
{
  "tailoredProfile": "..."
}

The tailoredProfile must use this exact structure (section headers in ALL CAPS):
NAME: [full name]
CONTACT: [email] | [phone] | [location]

SUMMARY
[3 sentences]

EXPERIENCE

[Job Title] | [Company] | [Date Range]
• [bullet with metric]
• [bullet with metric]
• [bullet with metric]
• [bullet with metric]

PROJECTS

[Project Name] | [Tech Stack — use JD keywords here]
• Problem: [what problem it solved]
• Built: [what you built and how]
• Outcome: [measurable result]

SKILLS
[Category ordered by JD priority]: [skill1, skill2, ...]

EDUCATION
[Degree] | [Institution] | [Year]`;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface JDAnalysis {
  jobTitle: string;
  company: string;
  mustHave: string[];
  niceToHave: string[];
  domain: string;
  senioritySignals: string[];
  keyResponsibilities: string[];
}

/* ------------------------------------------------------------------ */
/* Main export                                                         */
/* ------------------------------------------------------------------ */

export async function tailorProfileToJD(
  profile: string,
  jdText: string
): Promise<TailorResult> {
  // Step 1 — analyse the JD
  const analysisResp = await (
    chrome.runtime.sendMessage({
      type: "LLM_CHAT",
      messages: [
        { role: "system", content: ANALYZE_PROMPT },
        { role: "user", content: jdText },
      ],
    }) as Promise<{ message?: { content?: string }; error?: string }>
  );

  if (analysisResp.error) throw new Error(analysisResp.error);

  const rawAnalysis = (analysisResp.message?.content ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let analysis: JDAnalysis;
  try {
    analysis = JSON.parse(rawAnalysis) as JDAnalysis;
  } catch {
    throw new Error("Step 1 failed — could not parse JD analysis. Try again.");
  }

  // Step 2 — rewrite the resume using the analysis
  const tailorResp = await (
    chrome.runtime.sendMessage({
      type: "LLM_CHAT",
      messages: [
        { role: "system", content: buildTailorPrompt(analysis) },
        {
          role: "user",
          content: `CANDIDATE PROFILE:\n${profile}`,
        },
      ],
    }) as Promise<{ message?: { content?: string }; error?: string }>
  );

  if (tailorResp.error) throw new Error(tailorResp.error);

  const rawTailor = (tailorResp.message?.content ?? "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let tailored: { tailoredProfile: string };
  try {
    tailored = JSON.parse(rawTailor) as { tailoredProfile: string };
  } catch {
    throw new Error("Step 2 failed — could not parse tailored profile. Try again.");
  }

  if (!tailored.tailoredProfile) {
    throw new Error("Model returned an empty profile — try again.");
  }

  return {
    jobTitle: analysis.jobTitle,
    company: analysis.company,
    tailoredProfile: tailored.tailoredProfile,
  };
}
