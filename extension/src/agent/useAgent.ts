import { useRef, useState } from "react";
import type { Action, ActionResult, PageState } from "@agauto/shared";
import { captureAnnotatedScreenshot, clearHighlights, highlightFields, runAction, scanActiveTab } from "../lib/tab";
import { getStoredDocument } from "../lib/storage";
import { getProfileText, textToFacts } from "../lib/profile";
import { buildHints, matchFieldsToFacts } from "../lib/match";
import { addHistory } from "../lib/history";
import { AgentEngine, type EngineStep } from "./engine";

export type Pending =
  | { kind: "ask"; question: string; key: string }
  | { kind: "approval"; summary: string; submitIndex?: number }
  | { kind: "fix"; label: string; actionDesc: string; message: string }
  | { kind: "done"; summary: string }
  | { kind: "error"; error: string }
  | null;

export type AgentStatus = "idle" | "running" | "waiting" | "paused";

export function useAgent() {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);

  const engine = useRef(new AgentEngine());
  const filled = useRef<Set<number>>(new Set());
  const filledDetails = useRef<Map<number, { label: string; value: string }>>(new Map());
  const lastState = useRef<PageState | null>(null);
  const sessionHost = useRef<string | null>(null);
  const autoSubmit = useRef(false);
  const aborted = useRef(false);
  const paused = useRef(false);
  const resumeStep = useRef<EngineStep | null>(null);

  const append = (line: string) => setLog((l) => [...l, line]);

  async function drive(first: EngineStep) {
    let step = first;
    for (let i = 0; i < 100; i++) {
      if (aborted.current) {
        append("■ stopped");
        setStatus("idle");
        setPending(null);
        void clearHighlights().catch(() => {});
        return;
      }
      if (paused.current) {
        resumeStep.current = step;
        append("⏸ paused");
        setStatus("paused");
        return;
      }

      if (step.kind === "actions") {
        const results: { toolCallId: string; result: ActionResult }[] = [];
        let rescan = false;
        let failedFill: { action: Action; message: string } | null = null;
        for (const { toolCallId, action } of step.actions) {
          append(`→ ${describe(action)}`);
          try {
            const result = await execute(action);
            append(
              `   ${result.ok ? "✓" : "✗"}` +
                (result.value !== undefined ? ` ${JSON.stringify(result.value)}` : "") +
                (result.message ? ` — ${result.message}` : "")
            );
            results.push({ toolCallId, result });
            if (result.ok && FILL_ACTIONS.has(action.type)) {
              filled.current.add(action.index);
              const el = lastState.current?.elements.find((e) => e.index === action.index);
              filledDetails.current.set(action.index, {
                label: el?.label ?? el?.name ?? `field #${action.index}`,
                value: actionValue(action),
              });
            }
            if (!result.ok && FILL_ACTIONS.has(action.type)) {
              failedFill = { action, message: result.message ?? "action failed" };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : "action failed";
            append(`   ✗ ${msg}`);
            results.push({
              toolCallId,
              result: { ok: false, index: action.index, action: action.type, message: msg },
            });
            if (FILL_ACTIONS.has(action.type)) failedFill = { action, message: msg };
          }
          if (action.type === "click" || action.type === "pick_option") rescan = true;
        }
        engine.current.addResults(results);
        // A field the agent tried to FILL failed — stop here so the user can
        // fix it (or the page) and hit Resume, instead of plowing ahead.
        if (failedFill) {
          const el = lastState.current?.elements.find(
            (e) => e.index === failedFill!.action.index
          );
          append("⏸ field failed — waiting for you to fix & resume");
          setStatus("waiting");
          setPending({
            kind: "fix",
            label: el?.label ?? el?.name ?? `field #${failedFill.action.index}`,
            actionDesc: describe(failedFill.action),
            message: failedFill.message,
          });
          return;
        }
        if (rescan) {
          const ps = await scanActiveTab();
          const navigated = hostOf(ps.url) !== hostOf(lastState.current?.url ?? "");
          const urlChanged = ps.url !== lastState.current?.url;
          lastState.current = ps;
          // Re-screenshot only on real navigation (new page/step) — not after every
          // field fill, which would add 300–500 ms of latency per step for no benefit.
          const shot = urlChanged ? await tryScreenshot(ps) : undefined;
          engine.current.addPageState(ps, shot);
          if (navigated) sessionHost.current = hostOf(ps.url);
        }
        step = await engine.current.advance();
        continue;
      }

      if (step.kind === "ask") {
        setStatus("waiting");
        setPending({ kind: "ask", question: step.question, key: step.key });
        return;
      }
      if (step.kind === "approval") {
        if (autoSubmit.current) {
          append("auto-submit on — submitting");
          await clearHighlights().catch(() => {});
          submitAndRecord(step.submitIndex);
          setStatus("idle");
          setPending({ kind: "done", summary: "Submitted." });
          return;
        }
        setStatus("waiting");
        void highlightFields([...filled.current]).catch(() => {});
        setPending({ kind: "approval", summary: step.summary, submitIndex: step.submitIndex });
        return;
      }
      if (step.kind === "done") {
        append("✓ done");
        setStatus("idle");
        setPending({ kind: "done", summary: step.summary });
        return;
      }
      setStatus("idle");
      setPending({ kind: "error", error: step.error });
      return;
    }
    setStatus("idle");
    setPending({ kind: "error", error: "Stopped after 100 steps (safety limit)." });
  }

  async function start(
    profile: string,
    goal: string,
    jobDescription?: string,
    autoSubmitEnabled = false
  ) {
    setLog([]);
    setPending(null);
    setStatus("running");
    filled.current.clear();
    filledDetails.current.clear();
    aborted.current = false;
    paused.current = false;
    resumeStep.current = null;
    autoSubmit.current = autoSubmitEnabled;
    void clearHighlights().catch(() => {});
    try {
      append("scanning page…");
      const pageState = await scanActiveTab();
      lastState.current = pageState;
      sessionHost.current = hostOf(pageState.url);
      const doc = await getStoredDocument();

      let hints: string | undefined;
      try {
        append("matching fields to your profile…");
        const matches = await matchFieldsToFacts(pageState, textToFacts(await getProfileText()));
        hints = buildHints(matches) || undefined;
        if (hints) append(`matched ${hints.split("\n").length} field(s)`);
      } catch {
        /* embeddings optional */
      }

      const screenshot = await tryScreenshot(pageState);

      engine.current.start({
        profile,
        goal,
        jobDescription,
        hints,
        hasDocument: !!doc,
        pageState,
        screenshot,
      });
      await drive(await engine.current.advance());
    } catch (e) {
      fail(e);
    }
  }

  async function ensureSameSite(): Promise<PageState | null> {
    let ps: PageState;
    try {
      ps = await scanActiveTab();
    } catch (e) {
      fail(e);
      return null;
    }
    if (sessionHost.current && hostOf(ps.url) !== sessionHost.current) {
      setStatus("idle");
      setPending({
        kind: "error",
        error: "You're on a different site now — click 'Fill this form' to start a new session.",
      });
      return null;
    }
    lastState.current = ps;
    return ps;
  }

  async function answer(text: string) {
    setPending(null);
    setStatus("running");
    const ps = await ensureSameSite();
    if (!ps) return;
    engine.current.addAnswer(text);
    engine.current.addPageState(ps);
    try {
      await drive(await engine.current.advance());
    } catch (e) {
      fail(e);
    }
  }

  function submitAndRecord(submitIndex: number | undefined) {
    if (filledDetails.current.size) {
      void addHistory({
        id: String(Date.now()),
        at: Date.now(),
        url: lastState.current?.url ?? "",
        title: lastState.current?.title ?? "",
        outcome: "submitted",
        fields: [...filledDetails.current.values()],
      }).catch(() => {});
    }
    if (submitIndex !== undefined) {
      append(`→ submit (click #${submitIndex})`);
      void runAction({ type: "click", index: submitIndex })
        .then((r) => append(`   ${r.ok ? "✓ submitted" : "✗ submit failed"}`))
        .catch(() => append("   ✗ submit failed"));
    }
  }

  async function approve() {
    if (pending?.kind !== "approval") return;
    const submitIndex = pending.submitIndex;
    setPending(null);
    setStatus("running");
    await clearHighlights().catch(() => {});
    const ps = await ensureSameSite();
    if (!ps) return;
    submitAndRecord(submitIndex);
    setStatus("idle");
    setPending({ kind: "done", summary: "Submitted." });
  }

  /**
   * Continue after a "fix" stop: rescan the page (the user may have fixed the
   * field or the page manually), pass an optional note, and let the agent go on.
   */
  async function resumeFix(note: string) {
    setPending(null);
    setStatus("running");
    const ps = await ensureSameSite();
    if (!ps) return;
    engine.current.addPageState(ps);
    engine.current.addUserMessage(
      note.trim()
        ? `User intervened on the failed field: ${note.trim()}. Re-check the updated page state and continue.`
        : "User reviewed the failed field (may have fixed it manually). Re-check the updated page state; if it now has a correct value, move on to the remaining fields — otherwise skip it and continue."
    );
    try {
      await drive(await engine.current.advance());
    } catch (e) {
      fail(e);
    }
  }

  async function reject(correction: string) {
    setPending(null);
    setStatus("running");
    await clearHighlights().catch(() => {});
    const ps = await ensureSameSite();
    if (!ps) return;
    engine.current.addRejection(correction);
    engine.current.addPageState(ps);
    try {
      await drive(await engine.current.advance());
    } catch (e) {
      fail(e);
    }
  }

  function fail(e: unknown) {
    setStatus("idle");
    setPending({ kind: "error", error: e instanceof Error ? e.message : "failed" });
  }

  function stop() {
    aborted.current = true;
    paused.current = false;
    resumeStep.current = null;
    setStatus("idle");
    setPending(null);
    void clearHighlights().catch(() => {});
    append("■ stopping…");
  }

  function pause() {
    paused.current = true;
    append("⏸ pausing after the current step…");
  }

  function resume() {
    if (!resumeStep.current) return;
    paused.current = false;
    setStatus("running");
    const step = resumeStep.current;
    resumeStep.current = null;
    void drive(step);
  }

  return { status, log, pending, start, answer, approve, reject, resumeFix, stop, pause, resume };
}

/** Execute an action — translating upload_document to an upload_file with stored bytes. */
async function execute(action: Action): Promise<ActionResult> {
  if (action.type === "upload_document") {
    const doc = await getStoredDocument();
    if (!doc) {
      return {
        ok: false,
        index: action.index,
        action: "upload_document",
        message: "no document attached — add one in the Agent tab",
      };
    }
    return runAction({
      type: "upload_file",
      index: action.index,
      filename: doc.name,
      mimeType: doc.mime,
      dataBase64: doc.dataBase64,
    });
  }
  return runAction(action);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const FILL_ACTIONS = new Set<Action["type"]>([
  "type_text",
  "select_option",
  "set_checkbox",
  "pick_option",
  "upload_document",
  "upload_file",
]);

function actionValue(a: Action): string {
  switch (a.type) {
    case "type_text":
      return a.text;
    case "select_option":
      return a.value ?? a.label ?? "";
    case "pick_option":
      return a.option_label;
    case "set_checkbox":
      return a.checked ? "Yes" : "No";
    case "upload_document":
    case "upload_file":
      return "[document]";
    default:
      return "";
  }
}

function describe(a: Action): string {
  switch (a.type) {
    case "type_text":
      return `type ${JSON.stringify(a.text)} → #${a.index}`;
    case "select_option":
      return `select ${a.value ?? a.label ?? "?"} → #${a.index}`;
    case "set_checkbox":
      return `${a.checked ? "check" : "uncheck"} #${a.index}`;
    case "click":
      return `click #${a.index}`;
    case "pick_option":
      return `pick "${a.option_label}" → #${a.index}`;
    case "scroll_to":
      return `scroll to #${a.index}`;
    case "upload_file":
      return `upload ${a.filename} → #${a.index}`;
    case "upload_document":
      return `attach document → #${a.index}`;
  }
}

/** Capture an annotated screenshot; returns undefined on any failure (non-fatal). */
async function tryScreenshot(ps: PageState): Promise<string | undefined> {
  try {
    return await captureAnnotatedScreenshot(ps.elements, ps.viewport);
  } catch {
    return undefined;
  }
}
