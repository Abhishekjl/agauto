import { embed } from "./llm";

const CACHE_KEY = "agauto_embeddings";

/** djb2 hash → short cache key */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36);
}

async function loadCache(): Promise<Record<string, number[]>> {
  const v = await chrome.storage.local.get(CACHE_KEY);
  return (v[CACHE_KEY] as Record<string, number[]>) ?? {};
}

async function saveCache(cache: Record<string, number[]>): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

/** Embed texts, caching vectors by content so unchanged facts/labels aren't re-embedded. */
export async function embedCached(texts: string[]): Promise<number[][]> {
  const cache = await loadCache();
  const result: (number[] | null)[] = new Array(texts.length).fill(null);
  const missing: string[] = [];
  const missingIdx: number[] = [];

  texts.forEach((t, i) => {
    const cached = cache[hash(t)];
    if (cached) result[i] = cached;
    else {
      missing.push(t);
      missingIdx.push(i);
    }
  });

  if (missing.length) {
    const vectors = await embed(missing);
    vectors.forEach((vec, j) => {
      cache[hash(missing[j])] = vec;
      result[missingIdx[j]] = vec;
    });
    await saveCache(cache);
  }

  return result.map((v) => v ?? []);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
