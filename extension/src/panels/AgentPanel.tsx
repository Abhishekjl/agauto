import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useAgent } from "../agent/useAgent";
import { prepareDocument } from "../lib/documents";
import { extractProfileFromDoc } from "../lib/extract";
import {
  AUTOSUBMIT_KEY,
  GOAL_KEY,
  JOB_DESCRIPTION_KEY,
  getDocumentMeta,
  setStoredDocument,
} from "../lib/storage";
import { appendFact, getProfileText, setProfileText, textToFacts } from "../lib/profile";
import { pickRegion, scanActiveTab } from "../lib/tab";
import { matchFieldsToFacts, type FieldMatch } from "../lib/match";

const DEFAULT_GOAL = "Fill out this application form using my profile.";

export default function AgentPanel() {
  const { status, log, pending, start, answer, approve, reject, resumeFix, stop, pause, resume, reset } =
    useAgent();
  const [profile, setProfile] = useState("");
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [jobDescription, setJobDescription] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [rejectText, setRejectText] = useState("");
  const [fixText, setFixText] = useState("");
  const [docName, setDocName] = useState<string | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const [docNote, setDocNote] = useState("");
  const [matches, setMatches] = useState<FieldMatch[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [picking, setPicking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProfileText().then(setProfile);
    getDocumentMeta().then((m) => setDocName(m?.name ?? null));
    chrome.storage.local.get([GOAL_KEY, JOB_DESCRIPTION_KEY, AUTOSUBMIT_KEY]).then((v) => {
      if (typeof v[GOAL_KEY] === "string") setGoal(v[GOAL_KEY] as string);
      if (typeof v[JOB_DESCRIPTION_KEY] === "string")
        setJobDescription(v[JOB_DESCRIPTION_KEY] as string);
      if (typeof v[AUTOSUBMIT_KEY] === "boolean") setAutoSubmit(v[AUTOSUBMIT_KEY] as boolean);
    });
  }, []);

  function saveAutoSubmit(next: boolean) {
    setAutoSubmit(next);
    void chrome.storage.local.set({ [AUTOSUBMIT_KEY]: next });
  }

  async function selectAreaToFill() {
    setPicking(true);
    try {
      const fields = await pickRegion();
      if (!fields || fields.length === 0) return;
      const list = fields.map((f) => `#${f.index} "${f.label}"`).join(", ");
      const targetedGoal =
        `Fill ONLY these fields: ${list}. Leave every other field unchanged. ` +
        `Do not click Next or submit; call finish (with no submit button) once these are filled. ` +
        `${goal}`;
      start(profile, targetedGoal, jobDescription, autoSubmit);
    } finally {
      setPicking(false);
    }
  }

  function saveProfile(next: string) {
    setProfile(next);
    void setProfileText(next);
  }
  function saveGoal(next: string) {
    setGoal(next);
    void chrome.storage.local.set({ [GOAL_KEY]: next });
  }
  function saveJobDescription(next: string) {
    setJobDescription(next);
    void chrome.storage.local.set({ [JOB_DESCRIPTION_KEY]: next });
  }

  async function onPickDocument(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDocBusy(true);
    setDocNote("");
    try {
      const prepared = await prepareDocument(file);
      await setStoredDocument(prepared.stored);
      setDocName(prepared.stored.name);
      if (prepared.extractable) {
        setDocNote(
          prepared.images.length
            ? `reading ${prepared.images.length} page image(s)…`
            : "reading document text…"
        );
        const text = await extractProfileFromDoc({
          images: prepared.images,
          text: prepared.text,
        });
        if (text.trim()) {
          saveProfile(text.trim());
          setDocNote("profile updated from document");
        } else {
          setDocNote("attached (nothing extracted)");
        }
      } else {
        setDocNote("attached (can't read this type — used for uploads only)");
      }
    } catch (err) {
      setDocNote(err instanceof Error ? err.message : "failed to read document");
    } finally {
      setDocBusy(false);
    }
  }

  // Answers the agent asks are appended to the profile text and reused next time.
  async function onSendAnswer() {
    const text = answerText.trim();
    const label = pending?.kind === "ask" ? pending.key : null;
    if (label && text) setProfile(await appendFact(label, text));
    answer(answerText);
    setAnswerText("");
  }

  function exportProfile() {
    const blob = new Blob([profile], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agauto-profile.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function importProfile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    if (text.trim()) saveProfile(text.trim());
  }

  async function previewMatches() {
    setMatching(true);
    setMatches(null);
    try {
      const pageState = await scanActiveTab();
      setMatches(await matchFieldsToFacts(pageState, textToFacts(profile)));
    } catch {
      setMatches([]);
    } finally {
      setMatching(false);
    }
  }

  const busy = status === "running" || status === "paused";

  return (
    <div className="p-3 flex flex-col gap-2.5">
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-3 shadow-sm ring-1 ring-slate-900/[0.02] dark:ring-white/[0.03] flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex-1 truncate flex items-center gap-1.5">
            <DocIcon /> Document{docName ? `: ${docName}` : " (resume, cover letter…)"}
          </span>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={docBusy}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium px-2.5 py-1.5 disabled:opacity-50 transition"
          >
            {docBusy ? "Reading…" : docName ? "Replace" : "Upload"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.doc,.docx,image/*,text/plain,application/pdf"
            onChange={onPickDocument}
            className="hidden"
          />
        </div>
        {docNote && <p className="text-[11px] text-slate-500 dark:text-slate-400">{docNote}</p>}
      </div>

      <details className="rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden shadow-sm ring-1 ring-slate-900/[0.02] dark:ring-white/[0.03]">
        <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="flex-1">Profile</span>
          <span className="text-slate-400 dark:text-slate-500 font-normal">{profile.length} chars</span>
          <span className="text-slate-400 dark:text-slate-500">▾</span>
        </summary>
        <div className="px-3 pb-3 flex flex-col gap-1.5">
          <div className="flex justify-end gap-3 text-[11px]">
            <button onClick={exportProfile} className="text-slate-500 dark:text-slate-400 hover:underline">
              Export
            </button>
            <button
              onClick={() => importInput.current?.click()}
              className="text-slate-500 dark:text-slate-400 hover:underline"
            >
              Import
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".txt,.md,text/plain"
              onChange={importProfile}
              className="hidden"
            />
          </div>
          <textarea
            value={profile}
            onChange={(e) => saveProfile(e.target.value)}
            placeholder="Your profile — upload a document to fill this, or type it here."
            className="w-full h-56 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 p-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </details>

      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 px-0.5">
        Instructions
      </label>
      <textarea
        value={goal}
        onChange={(e) => saveGoal(e.target.value)}
        placeholder='e.g. "I can start immediately; emphasize my MCP server and agent work; keep answers concise."'
        className="-mt-1 w-full h-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 p-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-300"
      />

      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500 dark:text-slate-400 select-none">
          Job description (optional — tailors the answers)
        </summary>
        <textarea
          value={jobDescription}
          onChange={(e) => saveJobDescription(e.target.value)}
          placeholder="Paste the JD here — the agent tailors cover-letter / open-ended answers to it."
          className="mt-1 w-full h-28 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 p-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </details>

      <div className="flex gap-2">
        {status === "running" ? (
          <>
            <button
              onClick={pause}
              className="flex-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2.5 shadow-sm transition"
            >
              Pause
            </button>
            <button
              onClick={stop}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 shadow-sm transition"
            >
              Stop
            </button>
          </>
        ) : status === "paused" ? (
          <>
            <button
              onClick={resume}
              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 shadow-sm transition"
            >
              Resume
            </button>
            <button
              onClick={stop}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 shadow-sm transition"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => start(profile, goal, jobDescription, autoSubmit)}
              disabled={status === "waiting"}
              className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-sm font-semibold py-2.5 shadow-md shadow-indigo-500/25 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <SparkIcon /> Fill this form
            </button>
            <button
              onClick={previewMatches}
              disabled={matching}
              title="Semantically match this form's fields to your profile"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium px-3 shadow-sm disabled:opacity-50 transition"
            >
              {matching ? "…" : "Preview"}
            </button>
            {(log.length > 0 || pending !== null) && (
              <button
                onClick={reset}
                title="Reset session (keeps form fields filled)"
                className="rounded-lg bg-sky-500 hover:bg-sky-600 text-white px-3 shadow-sm transition flex items-center justify-center"
              >
                <RefreshIcon />
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSubmit}
            onChange={(e) => saveAutoSubmit(e.target.checked)}
          />
          Auto-submit (skip approval)
        </label>
        <button
          onClick={selectAreaToFill}
          disabled={busy || picking}
          title="Drag a rectangle over the page and fill only the fields inside it"
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
        >
          {picking ? "drag a box on the page…" : "Select area to fill"}
        </button>
      </div>

      {autoSubmit && (
        <p className="-mt-1 text-[11px] text-amber-700">
          ⚠ Auto-submit is on — the form will be submitted without asking you.
        </p>
      )}

      {status === "idle" && !pending && !matches && log.length === 0 && (
        <div className="mt-6 flex flex-col items-center text-center gap-2.5 px-6">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 grid place-items-center text-indigo-500 shadow-inner ring-1 ring-indigo-200/50">
            <BigSparkIcon />
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Ready to autofill</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed max-w-[240px]">
            Open a form in this tab, then hit{" "}
            <span className="font-medium text-slate-500">Fill this form</span>. AgAuto reads
            the whole page and fills it from your profile — you approve before anything submits.
          </p>
        </div>
      )}

      {matches && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-2 text-xs">
          <div className="font-medium text-slate-600 dark:text-slate-300 mb-1">
            Semantic matches (field → best fact)
          </div>
          {matches.length === 0 ? (
            <p className="text-slate-400 dark:text-slate-500">
              No fields/facts to match (or embeddings unavailable).
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {matches.map((m) => (
                <li key={m.fieldIndex} className="flex items-center gap-2">
                  <span
                    className={`rounded px-1 py-0.5 font-mono text-[10px] ${
                      m.score >= 0.78
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {m.score.toFixed(2)}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300 truncate">{m.fieldLabel}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-800 dark:text-slate-100 truncate font-medium">
                    {m.factLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pending?.kind === "ask" && (
        <Prompt title="The agent needs input" tone="amber">
          <p className="text-sm mb-2">{pending.question}</p>
          <div className="flex gap-2">
            <input
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
              placeholder="Your answer (saved to your profile)"
            />
            <button onClick={onSendAnswer} className="rounded bg-slate-800 text-white text-sm px-3">
              Send
            </button>
          </div>
        </Prompt>
      )}

      {pending?.kind === "fix" && (
        <Prompt title="A field failed — fix it, then resume" tone="red">
          <p className="text-sm mb-1">
            <span className="font-medium">{pending.label}</span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            {pending.actionDesc} — {pending.message}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            Fix the field on the page (or leave it), optionally tell the agent what to do,
            then resume.
          </p>
          <div className="flex gap-2">
            <input
              value={fixText}
              onChange={(e) => setFixText(e.target.value)}
              className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
              placeholder="Optional note, e.g. 'I filled it myself' or 'use X'"
            />
            <button
              onClick={() => {
                resumeFix(fixText);
                setFixText("");
              }}
              className="rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3"
            >
              Resume
            </button>
          </div>
          <div className="flex justify-between mt-2">
            <button
              onClick={() => {
                resumeFix("Skip this field entirely and continue with the rest of the form.");
                setFixText("");
              }}
              className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
            >
              Skip this field & continue
            </button>
            <button onClick={stop} className="text-xs text-red-600 hover:underline">
              Stop
            </button>
          </div>
        </Prompt>
      )}

      {pending?.kind === "approval" && (
        <Prompt title="Ready to submit — your approval" tone="indigo">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
            Filled fields are outlined in green on the page — review them, then approve.
          </p>
          <p className="text-sm whitespace-pre-wrap mb-3">{pending.summary}</p>
          <div className="flex gap-2 mb-2">
            <button
              onClick={approve}
              className="flex-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-1.5"
            >
              {pending.submitIndex !== undefined ? "Approve & submit" : "Approve (no submit button)"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={rejectText}
              onChange={(e) => setRejectText(e.target.value)}
              className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
              placeholder="Or tell the agent what to change…"
            />
            <button
              onClick={() => {
                reject(rejectText);
                setRejectText("");
              }}
              className="rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm px-3"
            >
              Revise
            </button>
          </div>
        </Prompt>
      )}

      {pending?.kind === "done" && (
        <Prompt title="Done" tone="emerald">
          <p className="text-sm whitespace-pre-wrap">{pending.summary}</p>
        </Prompt>
      )}

      {pending?.kind === "error" && (
        <Prompt title="Error" tone="red">
          <p className="text-sm">{pending.error}</p>
        </Prompt>
      )}

      {log.length > 0 && (
        <div className="mt-1">
          <div className="text-xs font-medium text-slate-500 mb-1">Activity</div>
          <pre className="rounded-md bg-slate-900 text-slate-100 text-[11px] leading-relaxed p-2 max-h-64 overflow-auto whitespace-pre-wrap">
            {log.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 shrink-0">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </svg>
  );
}

function BigSparkIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.9 5.9L20 9.8l-6.1 1.9L12 18l-1.9-6.3L4 9.8l6.1-1.9L12 2z" />
      <path d="M19 13l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6L15.5 16.5l2.6-.9L19 13z" opacity="0.55" />
    </svg>
  );
}

function Prompt({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "amber" | "indigo" | "emerald" | "red";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    amber: "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
    indigo: "border-indigo-300 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10",
    emerald: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    red: "border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">{title}</div>
      {children}
    </div>
  );
}
