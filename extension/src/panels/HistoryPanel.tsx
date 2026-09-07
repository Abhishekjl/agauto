import { useEffect, useState } from "react";
import { clearHistory, getHistory, type FillRecord } from "../lib/history";
import { appendFact } from "../lib/profile";

export default function HistoryPanel() {
  const [records, setRecords] = useState<FillRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    getHistory().then(setRecords);
  }, []);

  async function saveToProfile(record: FillRecord) {
    // Promote short factual answers; skip long generated text (cover letters etc.).
    const promotable = record.fields.filter(
      (f) => f.value.trim() && f.value.length <= 80 && f.value !== "[document]"
    );
    if (!promotable.length) {
      setNote("nothing short enough to save (long text is skipped)");
      return;
    }
    for (const f of promotable) await appendFact(f.label, f.value);
    setNote(`saved ${promotable.length} answer(s) to your profile`);
  }

  async function onClear() {
    await clearHistory();
    setRecords([]);
    setNote("history cleared");
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 flex-1">
          Every submitted form is recorded here (local only).
        </span>
        {records.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            Clear
          </button>
        )}
      </div>

      {note && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
          {note}
        </div>
      )}

      {records.length === 0 ? (
        <p className="text-sm text-slate-500">
          No fills yet. When you approve &amp; submit a form, it'll show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60"
            >
              <button
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                className="w-full text-left p-2.5 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {r.title || hostOf(r.url)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {hostOf(r.url)} · {new Date(r.at).toLocaleString()} · {r.fields.length} fields
                  </div>
                </div>
                <span className="text-slate-400 text-xs">{openId === r.id ? "▲" : "▼"}</span>
              </button>

              {openId === r.id && (
                <div className="border-t border-slate-100 p-2.5 flex flex-col gap-1.5">
                  <dl className="grid grid-cols-[40%_1fr] gap-x-2 gap-y-1 text-[11px]">
                    {r.fields.map((f, i) => (
                      <div key={i} className="contents">
                        <dt className="text-slate-500 truncate">{f.label}</dt>
                        <dd className="text-slate-800 break-words">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    onClick={() => saveToProfile(r)}
                    className="self-start mt-1 text-xs text-indigo-600 hover:underline"
                  >
                    Save answers to profile
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "unknown";
  }
}
