export interface Settings {
  chatBaseUrl: string;
  chatKey: string;
  model: string;
  embedBaseUrl: string;
  embedKey: string;
  embedModel: string;
}

export const SETTINGS_KEY = "agauto_settings";

// Sensible defaults so it works out of the box; fully editable in the Settings tab.
export const DEFAULT_SETTINGS: Settings = {
  chatBaseUrl: "https://api.openai.com/v1",
  chatKey: "",
  model: "gpt-4o",
  embedBaseUrl: "",
  embedKey: "",
  embedModel: "text-embedding-3-small",
};

export async function getSettings(): Promise<Settings> {
  const v = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((v[SETTINGS_KEY] as Partial<Settings>) ?? {}) };
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}
