import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import AgentPanel from "./panels/AgentPanel";
import InspectPanel from "./panels/InspectPanel";
import HistoryPanel from "./panels/HistoryPanel";
import SettingsPanel from "./panels/SettingsPanel";
import { applyTheme, getTheme } from "./lib/theme";

type Tab = "agent" | "history" | "inspect" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("agent");

  useEffect(() => {
    getTheme().then(applyTheme);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50 to-indigo-50/50 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/40 text-slate-800 dark:text-slate-200 flex flex-col antialiased">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 backdrop-blur-md">
        <img
          src="icons/icon128.png"
          alt="AgAuto"
          className="h-8 w-8 rounded-xl shadow-md shadow-indigo-500/25"
        />
        <div className="flex-1 leading-tight">
          <h1 className="font-semibold text-[15px] tracking-tight">AgAuto</h1>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-0.5">form autofill agent</p>
        </div>
        <nav className="flex items-center gap-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5">
          <TabBtn active={tab === "agent"} onClick={() => setTab("agent")}>
            Agent
          </TabBtn>
          <TabBtn active={tab === "history"} onClick={() => setTab("history")}>
            History
          </TabBtn>
          <TabBtn active={tab === "inspect"} onClick={() => setTab("inspect")}>
            Inspect
          </TabBtn>
          <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} title="Settings">
            <GearIcon />
          </TabBtn>
        </nav>
      </header>

      <main className="flex-1">
        {tab === "agent" ? (
          <AgentPanel />
        ) : tab === "history" ? (
          <HistoryPanel />
        ) : tab === "settings" ? (
          <SettingsPanel />
        ) : (
          <InspectPanel />
        )}
      </main>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid place-items-center px-2.5 py-1 rounded-lg text-xs font-medium transition ${
        active
          ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm"
          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function GearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
