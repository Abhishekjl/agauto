import type { ProfileFact } from "@agauto/shared";
import { PREFERENCES_KEY, PROFILE_FACTS_KEY, PROFILE_KEY } from "./storage";

export type { ProfileFact };

/**
 * The profile is a single, editable, well-formatted TEXT block — raw text the user
 * can read and edit. Internally we parse "Label: value" lines into facts for semantic
 * matching (Phase 5), but the display/edit surface is plain text.
 */

const SAMPLE = `Name: Jordan Lee
Email: jordan.lee@example.com
Phone: +1 415 555 0132
Location: San Francisco, CA
Work authorization: Authorized to work in the US; no sponsorship needed

Summary:
  Software engineer with 6 years of backend experience (TypeScript, Node.js).

Skills: TypeScript, Node.js, PostgreSQL, Docker, AWS

Links: https://linkedin.com/in/jordanlee`;

export async function getProfileText(): Promise<string> {
  const v = await chrome.storage.local.get([PROFILE_KEY, PROFILE_FACTS_KEY, PREFERENCES_KEY]);
  const text = v[PROFILE_KEY] as string | undefined;
  if (typeof text === "string" && text.trim()) return text;

  // migrate from the earlier facts-based storage, if present
  const facts = [
    ...((v[PROFILE_FACTS_KEY] as ProfileFact[] | undefined) ?? []),
    ...((v[PREFERENCES_KEY] as ProfileFact[] | undefined) ?? []),
  ];
  if (facts.length) {
    const migrated = facts.map((f) => `${f.label}: ${f.value}`).join("\n");
    await setProfileText(migrated);
    return migrated;
  }

  await setProfileText(SAMPLE);
  return SAMPLE;
}

export async function setProfileText(text: string): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: text });
}

/** Append (or update) a "Label: value" line — used when the agent learns an answer. */
export async function appendFact(label: string, value: string): Promise<string> {
  const text = await getProfileText();
  const l = label.trim();
  const lines = text.split("\n");
  const idx = lines.findIndex((ln) => {
    const c = ln.indexOf(":");
    return c > 0 && ln.slice(0, c).trim().toLowerCase() === l.toLowerCase();
  });
  const line = `${l}: ${value.trim()}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  const next = lines.join("\n").trim();
  await setProfileText(next);
  return next;
}

/** Parse "Label: value" lines into facts for semantic matching. */
export function textToFacts(text: string): ProfileFact[] {
  const out: ProfileFact[] = [];
  for (const line of text.split("\n")) {
    const c = line.indexOf(":");
    if (c <= 0) continue;
    const label = line.slice(0, c).trim();
    const value = line.slice(c + 1).trim();
    // short labels only — skip long prose / bullet lines
    if (label && value && label.length <= 40 && !label.startsWith("-")) {
      out.push({ label, value });
    }
  }
  return out;
}
