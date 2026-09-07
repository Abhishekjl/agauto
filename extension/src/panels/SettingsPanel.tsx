import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_SETTINGS, getSettings, setSettings, type Settings } from "../lib/settings";
import { applyTheme, getTheme, setTheme, type Theme } from "../lib/theme";

export default function SettingsPanel() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [note, setNote] = useState("");
  const [testing, setTesting] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    getSettings().then(setS);
    getTheme().then(setThemeState);
  }, []);

  function chooseTheme(t: Theme) {
    setThemeState(t);
    applyTheme(t);
    void setTheme(t);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    await setSettings(s);
    setNote("saved");
  }

  async function test() {
    setTesting(true);
    setNote("");
    await setSettings(s); // test against what's shown
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "LLM_CHAT",
        messages: [{ role: "user", content: "reply with exactly: ok" }],
      })) as { message?: { content?: unknown }; error?: string };
      if (res?.error) setNote(`✗ ${res.error}`);
      else setNote(`✓ connected — model replied: ${String(res?.message?.content ?? "")}`);
    } catch (e) {
      setNote(`✗ ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Configure your OpenAI-compatible model here. Everything runs locally in the
        extension — no backend to start.
      </p>

      <Section title="Appearance">
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-700 p-0.5 text-xs font-medium">
          {(["light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => chooseTheme(t)}
              className={`flex-1 rounded-md py-1 capitalize transition ${
                theme === t
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 shadow-sm"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Chat / vision model (required)">
        <Field label="Base URL" value={s.chatBaseUrl} onChange={(v) => update("chatBaseUrl", v)}
          placeholder="https://api.openai.com/v1" />
        <Field label="API key" value={s.chatKey} onChange={(v) => update("chatKey", v)}
          placeholder="sk-…" secret />
        <Field label="Model" value={s.model} onChange={(v) => update("model", v)}
          placeholder="gpt-4o / gemma-4 / …" />
      </Section>

      <Section title="Embeddings (optional — enables semantic matching)">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 -mt-1">
          Leave blank to reuse the chat endpoint. Must be a valid-TLS https (or http) host —
          the browser can't accept self-signed certs.
        </p>
        <Field label="Base URL" value={s.embedBaseUrl} onChange={(v) => update("embedBaseUrl", v)}
          placeholder="(same as chat if blank)" />
        <Field label="API key" value={s.embedKey} onChange={(v) => update("embedKey", v)}
          placeholder="(same as chat if blank)" secret />
        <Field label="Model" value={s.embedModel} onChange={(v) => update("embedModel", v)}
          placeholder="text-embedding-3-small / bge-small" />
      </Section>

      <div className="flex gap-2">
        <button
          onClick={save}
          className="flex-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2"
        >
          Save
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium px-3 disabled:opacity-50"
        >
          {testing ? "…" : "Test"}
        </button>
      </div>

      {note && (
        <div
          className={`text-xs rounded p-2 ${
            note.startsWith("✗")
              ? "bg-red-50 text-red-700 border border-red-200"
              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-2.5 shadow-sm flex flex-col gap-1.5">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-2 py-1 text-xs font-mono"
      />
    </label>
  );
}
