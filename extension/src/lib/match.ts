import type { PageState, ProfileFact } from "@agauto/shared";
import { cosine, embedCached } from "./embeddings";

const FILLABLE = new Set([
  "text",
  "textarea",
  "email",
  "password",
  "number",
  "tel",
  "url",
  "select",
  "checkbox",
  "radio",
  "date",
]);

export interface FieldMatch {
  fieldIndex: number;
  fieldLabel: string;
  factLabel: string;
  factValue: string;
  score: number;
}

/**
 * Semantically match each fillable form field to the best-matching profile fact,
 * using bge-small embeddings (cached). This is the answer-bank retrieval — a field
 * labeled "Compensation" finds your "Desired salary" fact even with different words.
 */
export async function matchFieldsToFacts(
  pageState: PageState,
  facts: ProfileFact[]
): Promise<FieldMatch[]> {
  const fields = pageState.elements.filter(
    (e) => FILLABLE.has(e.kind) && (e.label || e.name)
  );
  const usableFacts = facts.filter((f) => f.label.trim() && f.value.trim());
  if (!fields.length || !usableFacts.length) return [];

  const fieldTexts = fields.map((f) => f.label ?? f.name ?? "");
  const factTexts = usableFacts.map((f) => f.label);

  // One batched call keeps cache access consistent.
  const vectors = await embedCached([...fieldTexts, ...factTexts]);
  const fieldVecs = vectors.slice(0, fieldTexts.length);
  const factVecs = vectors.slice(fieldTexts.length);

  const matches: FieldMatch[] = [];
  fields.forEach((field, i) => {
    let best = -1;
    let bestScore = -1;
    factVecs.forEach((fv, j) => {
      const s = cosine(fieldVecs[i], fv);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    });
    if (best >= 0) {
      matches.push({
        fieldIndex: field.index,
        fieldLabel: fieldTexts[i],
        factLabel: usableFacts[best].label,
        factValue: usableFacts[best].value,
        score: bestScore,
      });
    }
  });

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Build a compact hint string for the agent from confident matches.
 * bge-small scores loosely-related text at ~0.6–0.75 (e.g. "languages you speak"
 * vs a programming-skills fact), so anything below 0.78 is too noisy to suggest.
 */
export function buildHints(matches: FieldMatch[], minScore = 0.78): string {
  return matches
    .filter((m) => m.score >= minScore)
    .map((m) => `#${m.fieldIndex} "${m.fieldLabel}" → ${m.factLabel}: ${m.factValue}`)
    .join("\n");
}
