import type { StoredDocument } from "./documents";

export const PROFILE_FACTS_KEY = "agauto_profile_facts";
export const GOAL_KEY = "agauto_goal";
export const JOB_DESCRIPTION_KEY = "agauto_job_description";
export const AUTOSUBMIT_KEY = "agauto_autosubmit";
export const HISTORY_KEY = "agauto_history";
// legacy keys, kept for one-time migration:
export const PROFILE_KEY = "agauto_profile";
export const PREFERENCES_KEY = "agauto_preferences";
export const DOCUMENT_KEY = "agauto_document";
export const DOCUMENT_META_KEY = "agauto_document_meta";

export async function getStoredDocument(): Promise<StoredDocument | null> {
  const v = await chrome.storage.local.get(DOCUMENT_KEY);
  return (v[DOCUMENT_KEY] as StoredDocument | undefined) ?? null;
}

export async function setStoredDocument(doc: StoredDocument): Promise<void> {
  await chrome.storage.local.set({
    [DOCUMENT_KEY]: doc,
    [DOCUMENT_META_KEY]: { name: doc.name, mime: doc.mime },
  });
}

export async function clearStoredDocument(): Promise<void> {
  await chrome.storage.local.remove([DOCUMENT_KEY, DOCUMENT_META_KEY]);
}

export async function getDocumentMeta(): Promise<{ name: string; mime: string } | null> {
  const v = await chrome.storage.local.get(DOCUMENT_META_KEY);
  return (v[DOCUMENT_META_KEY] as { name: string; mime: string } | undefined) ?? null;
}

export type { StoredDocument };
