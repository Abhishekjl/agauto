import type { ProfileFact } from "@agauto/shared";
import { HISTORY_KEY } from "./storage";

export interface FillRecord {
  id: string;
  at: number;
  url: string;
  title: string;
  outcome: "submitted";
  fields: ProfileFact[];
}

const MAX_RECORDS = 100;

export async function getHistory(): Promise<FillRecord[]> {
  const v = await chrome.storage.local.get(HISTORY_KEY);
  return (v[HISTORY_KEY] as FillRecord[] | undefined) ?? [];
}

export async function addHistory(record: FillRecord): Promise<void> {
  const history = await getHistory();
  history.unshift(record);
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_RECORDS) });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}
