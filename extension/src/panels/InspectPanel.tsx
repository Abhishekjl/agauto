import { useState } from "react";
import type { ReactNode } from "react";
import type {
  Action,
  ActionResult,
  InteractiveElement,
  PageState,
} from "@agauto/shared";
import { runAction, scanActiveTab } from "../lib/tab";

const TEXT_KINDS = new Set([
  "text",
  "textarea",
  "email",
  "password",
  "number",
  "tel",
  "url",
  "date",
  "contenteditable",
]);

export default function InspectPanel() {
  const [state, setState] = useState<PageState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ActionResult | null>(null);

  async function scan() {
    setScanning(true);
    setError("");
    setState(null);
    setToast(null);
    try {
      setState(await scanActiveTab());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      setError(
        msg.includes("Receiving end does not exist")
          ? "Content script isn't on this page. Reload the tab (won't run on chrome:// or the Web Store)."
          : msg
      );
    } finally {
      setScanning(false);
    }
  }

  async function run(action: Action) {
    setToast(null);
    try {
      setToast(await runAction(action));
    } catch (e) {
      setToast({
        ok: false,
        index: action.index,
        action: action.type,
        message: e instanceof Error ? e.message : "Action failed",
      });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60">
        <span className="text-xs text-slate-500 flex-1">
          Manual scan &amp; act — useful for debugging perception/actions.
        </span>
        <button
          onClick={scan}
          disabled={scanning}
          className="rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Scan page"}
        </button>
      </div>

      {toast && (
        <div
          className={`px-4 py-2 text-xs border-b ${
            toast.ok
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          [{toast.action} #{toast.index}] {toast.ok ? "ok" : "failed"}
          {toast.value !== undefined && ` → ${JSON.stringify(toast.value)}`}
          {toast.message && ` — ${toast.message}`}
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            {error}
          </div>
        )}
        {state && (
          <>
            <div className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{state.elementCount}</span>{" "}
              elements · <span className="text-slate-400">{hostOf(state.url)}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {state.elements.map((el) => (
                <ElementRow key={el.index} el={el} onAction={run} />
              ))}
            </ul>
          </>
        )}
        {!state && !error && (
          <p className="text-sm text-slate-500">
            Click <b>Scan page</b> to see every interactive element AgAuto perceives.
          </p>
        )}
      </div>
    </div>
  );
}

function ElementRow({
  el,
  onAction,
}: {
  el: InteractiveElement;
  onAction: (a: Action) => void;
}) {
  const [text, setText] = useState("");

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 font-mono">
          {el.index}
        </span>
        <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 font-medium">
          {el.kind}
        </span>
        <span className="font-medium text-slate-800 truncate">
          {el.label ?? <span className="text-slate-400 italic">no label</span>}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {el.required && <Tag className="bg-amber-100 text-amber-700">req</Tag>}
          {!el.geometry.visible && <Tag className="bg-slate-100 text-slate-500">hidden</Tag>}
          {el.geometry.visible && !el.geometry.inViewport && (
            <Tag className="bg-slate-100 text-slate-500">off-screen</Tag>
          )}
          {el.framePath.length > 0 && (
            <Tag className="bg-violet-100 text-violet-700">frame {el.framePath.join(".")}</Tag>
          )}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {TEXT_KINDS.has(el.kind) && (
          <>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={el.value ? `now: ${el.value}` : "text to fill"}
              className="flex-1 min-w-[120px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 px-1.5 py-1"
            />
            <ActionBtn onClick={() => onAction({ type: "type_text", index: el.index, text })}>
              Fill
            </ActionBtn>
          </>
        )}
        {el.kind === "select" && el.options && <SelectControl el={el} onAction={onAction} />}
        {(el.kind === "checkbox" || el.kind === "radio") && (
          <>
            <ActionBtn onClick={() => onAction({ type: "set_checkbox", index: el.index, checked: true })}>
              Check
            </ActionBtn>
            <ActionBtn onClick={() => onAction({ type: "set_checkbox", index: el.index, checked: false })}>
              Uncheck
            </ActionBtn>
          </>
        )}
        {(el.kind === "button" || el.kind === "link") && (
          <ActionBtn onClick={() => onAction({ type: "click", index: el.index })}>Click</ActionBtn>
        )}
        {el.kind === "file" && (
          <span className="text-slate-400 italic">file input — agent attaches your document</span>
        )}
        <ActionBtn variant="ghost" onClick={() => onAction({ type: "scroll_to", index: el.index })}>
          Scroll
        </ActionBtn>
      </div>
    </li>
  );
}

function SelectControl({
  el,
  onAction,
}: {
  el: InteractiveElement;
  onAction: (a: Action) => void;
}) {
  const [value, setValue] = useState(el.value ?? "");
  return (
    <>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 min-w-[120px] rounded border border-slate-300 px-1.5 py-1"
      >
        {el.options!.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label || o.value}
          </option>
        ))}
      </select>
      <ActionBtn onClick={() => onAction({ type: "select_option", index: el.index, value })}>
        Set
      </ActionBtn>
    </>
  );
}

function ActionBtn({
  children,
  onClick,
  variant = "solid",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "solid" | "ghost";
}) {
  const cls =
    variant === "ghost"
      ? "border border-slate-300 text-slate-600 hover:bg-slate-100"
      : "bg-slate-800 text-white hover:bg-slate-700";
  return (
    <button onClick={onClick} className={`rounded px-2 py-1 font-medium ${cls}`}>
      {children}
    </button>
  );
}

function Tag({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${className}`}>{children}</span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
