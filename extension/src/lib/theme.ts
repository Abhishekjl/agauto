export type Theme = "light" | "dark";

const THEME_KEY = "agauto_theme";

export async function getTheme(): Promise<Theme> {
  const v = await chrome.storage.local.get(THEME_KEY);
  return (v[THEME_KEY] as Theme) === "dark" ? "dark" : "light";
}

export async function setTheme(t: Theme): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: t });
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
}
