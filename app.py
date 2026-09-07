#!/usr/bin/env python3
"""
AgAuto — single-file backend + test-form server (Python stdlib only).

Replaces the Node backend. Run it and load extension/dist in Chrome:

    python3 app.py

Routes (http://127.0.0.1:8787):
    GET  /health
    GET  /form/                 test forms (index.html, advanced.html)
    POST /api/chat
    POST /api/embed
    POST /api/profile/extract
    POST /api/session/start
    POST /api/session/step

Config is read from backend/.env if present, else env vars, else the defaults
below. No third-party packages required.
"""
import json
import os
import ssl
import sys
import urllib.request
import urllib.error
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

def _load_env():
    cfg = {}
    path = os.path.join(HERE, "backend", ".env")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()

    def get(key, default):
        return os.environ.get(key) or cfg.get(key) or default

    return get


_get = _load_env()
PORT = int(_get("PORT", "8787"))
# Configure via backend/.env (see backend/.env.example) or environment variables.
CHAT_BASE = _get("OPENAI_BASE_URL", "https://api.openai.com/v1")
CHAT_KEY = _get("OPENAI_API_KEY", "")
MODEL = _get("OPENAI_MODEL", "gpt-4o")
EMBED_BASE = _get("EMBED_BASE_URL", "") or CHAT_BASE
EMBED_KEY = _get("EMBED_API_KEY", "") or CHAT_KEY
EMBED_MODEL = _get("EMBED_MODEL", "text-embedding-3-small")

# --------------------------------------------------------------------------- #
# OpenAI-compatible HTTP calls
# --------------------------------------------------------------------------- #

_UNVERIFIED = ssl._create_unverified_context()


def _post(base, key, path, payload, timeout=180):
    url = base.rstrip("/") + path
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    ctx = _UNVERIFIED if url.startswith("https") else None
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"{e.code} {body[:400]}")


def chat_completion(messages, tools=None, tool_choice="auto"):
    payload = {"model": MODEL, "messages": messages}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice
        payload["parallel_tool_calls"] = False
    resp = _post(CHAT_BASE, CHAT_KEY, "/chat/completions", payload)
    return resp["choices"][0]["message"]


def embed(texts):
    resp = _post(EMBED_BASE, EMBED_KEY, "/embeddings", {"model": EMBED_MODEL, "input": texts})
    return [d["embedding"] for d in resp["data"]]


# --------------------------------------------------------------------------- #
# Agent: prompt, tools, loop
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = """You are AgAuto, an agent that fills out web forms on the user's behalf.

You are given the user's profile and a list of the page's interactive elements,
each with a numeric index (#N). Use the tools to fill the form ONE action at a time.

Rules:
- Fill fields from the profile, inferring reasonable values where you safely can.
- For open-ended writing fields (cover letter, "why do you want this role?",
  "tell us about yourself", short essays), COMPOSE a concise, professional answer
  yourself from the profile and context - do NOT ask the user for these.
- Use ask_user ONLY for specific personal values you cannot infer or generate
  (e.g. exact desired salary, earliest start date, a yes/no you have no basis for).
  When you do, also provide field_label: a short canonical label (e.g. "Desired salary")
  so the answer can be saved and reused.
- Follow the user's Instructions exactly (e.g. availability, points to emphasize).
- If a Job description is provided, tailor open-ended answers to it - emphasize the
  most relevant experience and align phrasing with the role.
- Match values to fields by their labels. For native <select>, pass an option value or
  label that appears in the options list.
- For CUSTOM (non-native) dropdowns and date pickers, click the control to OPEN it. The
  page then updates and the options/days appear as new elements - click the correct one.
- For +/- stepper or quantity controls, click the increment (+) or decrement (-) button
  repeatedly, re-checking the field's value after each click, until it reaches the target.
  Native range sliders can be set with type_text (the numeric value).
- Some forms span MULTIPLE pages/steps. When the current page's fields are complete and a
  Next/Continue button exists, click it to proceed; the page updates and you continue.
  Only call finish when the ENTIRE application is complete and the final submit is present.
- NEVER click a submit/apply button yourself. When the form is fully filled and ready,
  call finish with a short summary and the index of the submit button (if present).
- To attach the user's document (resume/CV, cover letter, etc.) to a file-upload
  field, call upload_document with that field's index (only if a document is available).
- Prefer visible, enabled fields. Skip fields that are already correct.
- Be concise. Take one tool action per turn."""


def _fn(name, description, properties, required):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


TOOLS = [
    _fn("type_text", "Type text into a text input, textarea, or contenteditable field.",
        {"index": {"type": "integer"}, "text": {"type": "string"}}, ["index", "text"]),
    _fn("select_option", "Choose an option in a native <select>. Provide value or label from its options.",
        {"index": {"type": "integer"}, "value": {"type": "string"}, "label": {"type": "string"}}, ["index"]),
    _fn("set_checkbox", "Check or uncheck a checkbox or radio.",
        {"index": {"type": "integer"}, "checked": {"type": "boolean"}}, ["index", "checked"]),
    _fn("click", "Click a button, link, radio, or custom control (e.g. Next, expand a section).",
        {"index": {"type": "integer"}}, ["index"]),
    _fn("scroll_to", "Scroll an element into view.", {"index": {"type": "integer"}}, ["index"]),
    _fn("upload_document", "Attach the user's stored document to a file-upload field.",
        {"index": {"type": "integer"}}, ["index"]),
    _fn("ask_user", "Ask the user for a specific personal value you cannot infer or generate.",
        {"question": {"type": "string"},
         "field_label": {"type": "string", "description": "short canonical label, e.g. 'Desired salary'"}},
        ["question", "field_label"]),
    _fn("finish", "Call when the form is fully filled and ready to submit. Do NOT click submit yourself.",
        {"summary": {"type": "string"}, "submit_index": {"type": "integer"}}, ["summary"]),
]


def serialize_state(state):
    lines = []
    for e in state.get("elements", []):
        parts = [f"#{e['index']}", f"[{e['kind']}]"]
        if e.get("label"):
            parts.append(json.dumps(e["label"]))
        if e.get("required"):
            parts.append("(required)")
        if e.get("options"):
            parts.append("options=[" + " | ".join(o.get("label") or o.get("value") for o in e["options"]) + "]")
        if e.get("value"):
            parts.append("value=" + json.dumps(e["value"]))
        if e["kind"] in ("checkbox", "radio"):
            parts.append("checked=" + ("yes" if e.get("checked") else "no"))
        if not e.get("geometry", {}).get("visible", True):
            parts.append("<hidden>")
        lines.append(" ".join(parts))
    return f"Page: {state.get('title','')} ({state.get('url','')})\nInteractive elements:\n" + "\n".join(lines)


def _to_action(name, args):
    idx = int(args.get("index", -1))
    if name == "type_text":
        return {"type": "type_text", "index": idx, "text": str(args.get("text", ""))}
    if name == "select_option":
        return {"type": "select_option", "index": idx, "value": args.get("value"), "label": args.get("label")}
    if name == "set_checkbox":
        return {"type": "set_checkbox", "index": idx, "checked": bool(args.get("checked"))}
    if name == "click":
        return {"type": "click", "index": idx}
    if name == "scroll_to":
        return {"type": "scroll_to", "index": idx}
    if name == "upload_document":
        return {"type": "upload_document", "index": idx}
    return None


SESSIONS = {}


def _parse_args(raw):
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _advance(session):
    msg = chat_completion(session["messages"], TOOLS, "auto")
    session["messages"].append(msg)
    sid = session["id"]

    calls = msg.get("tool_calls") or []
    if not calls:
        return {"kind": "done", "sessionId": sid, "summary": msg.get("content") or "Done."}

    call = calls[0]
    name = call["function"]["name"]
    args = _parse_args(call["function"].get("arguments"))
    session["pending_tool_call_id"] = call["id"]

    if name == "ask_user":
        return {"kind": "ask", "sessionId": sid,
                "question": str(args.get("question", "?")),
                "key": str(args.get("field_label") or args.get("question") or "answer")}
    if name == "finish":
        submit = args.get("submit_index")
        return {"kind": "approval", "sessionId": sid,
                "summary": str(args.get("summary", "Ready to submit.")),
                "submitIndex": int(submit) if submit is not None else None}

    action = _to_action(name, args)
    if action is None:
        session["messages"].append({"role": "tool", "tool_call_id": call["id"], "content": f"unknown tool: {name}"})
        return _advance(session)

    return {"kind": "actions", "sessionId": sid, "actions": [{"toolCallId": call["id"], "action": action}]}


def start_session(body):
    profile = body.get("profile", {}).get("raw", "")
    goal = body.get("goal") or "Fill out this form using my profile."
    page = body["pageState"]
    content = f"My profile:\n{profile}\n\n"
    if body.get("hasDocument"):
        content += "A document file is attached and can be uploaded via upload_document.\n\n"
    content += f"Instructions: {goal}\n\n"
    if (body.get("jobDescription") or "").strip():
        content += f"Job description to tailor answers to:\n{body['jobDescription'].strip()}\n\n"
    if (body.get("hints") or "").strip():
        content += f"Semantic field->fact suggestions (verify before using):\n{body['hints'].strip()}\n\n"
    content += f"Current page:\n{serialize_state(page)}"

    session = {
        "id": str(uuid.uuid4()),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        "pending_tool_call_id": None,
    }
    SESSIONS[session["id"]] = session
    return _advance(session)


def step_session(body):
    sid = body.get("sessionId")
    session = SESSIONS.get(sid)
    if not session:
        return {"kind": "error", "sessionId": sid, "error": "unknown session"}

    results = body.get("results")
    if results:
        for r in results:
            session["messages"].append(
                {"role": "tool", "tool_call_id": r["toolCallId"], "content": json.dumps(r["result"])}
            )
    elif body.get("userAnswer") is not None and session["pending_tool_call_id"]:
        session["messages"].append(
            {"role": "tool", "tool_call_id": session["pending_tool_call_id"],
             "content": "User answered: " + body["userAnswer"]}
        )
    elif body.get("approved") is not None and session["pending_tool_call_id"]:
        if body["approved"]:
            session["messages"].append(
                {"role": "tool", "tool_call_id": session["pending_tool_call_id"],
                 "content": "User approved and the form was submitted."}
            )
            session["pending_tool_call_id"] = None
            return {"kind": "done", "sessionId": sid, "summary": "Submitted."}
        session["messages"].append(
            {"role": "tool", "tool_call_id": session["pending_tool_call_id"],
             "content": "User did NOT approve. Feedback: " + (body.get("userAnswer") or "please revise")}
        )

    session["pending_tool_call_id"] = None
    if body.get("pageState"):
        session["messages"].append({"role": "user", "content": "Updated page:\n" + serialize_state(body["pageState"])})

    return _advance(session)


# --------------------------------------------------------------------------- #
# Document extraction (vision + text) -> open facts
# --------------------------------------------------------------------------- #

EXTRACT_SYSTEM = ("You read a resume/CV or profile document and transcribe its FULL content into "
                  "a clean, well-organized plain-text profile, preserving every detail. "
                  "Return ONLY the profile text.")

EXTRACT_INSTRUCTIONS = """Transcribe the FULL content of this document into a clean, well-organized
plain-text profile. Preserve ALL details - do NOT summarize, shorten, or omit anything. This is the
agent's complete knowledge base for filling forms, so completeness matters more than brevity.

Include (only what's present):

Name / Email / Phone / Location / Work authorization / Links
Summary: <the full summary/objective, verbatim>
Skills: <every skill listed>
Experience:
  - <Title> @ <Company> (<dates>)
      - <every bullet point / responsibility / achievement, one per line>
Projects:
  - <Project name> - <full description, technologies, links>
Education:
  - <Degree>, <School> (<year>) - <details>
Certifications / Awards / Publications:
  - <each item>

Capture every bullet point and every project. Do not invent anything. Return only the profile
text (no JSON, no code fences, no commentary)."""


def _to_facts(data):
    facts = []

    def stringify(v):
        if v is None:
            return ""
        if isinstance(v, str):
            return v.strip()
        if isinstance(v, (int, float, bool)):
            return str(v)
        if isinstance(v, list):
            return ", ".join(stringify(x) for x in v if x not in (None, ""))
        if isinstance(v, dict):
            return " · ".join(str(x) for x in v.values() if isinstance(x, (str, int, float)))
        return ""

    def push(label, value):
        l = str(label).strip()
        s = stringify(value)
        if l and s:
            facts.append({"label": l, "value": s})

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                if "label" in item or "value" in item:
                    push(item.get("label"), item.get("value"))
                else:
                    for k, v in item.items():
                        push(k, v)
    elif isinstance(data, dict):
        for k, v in data.items():
            push(k, v)
    return facts


def _parse_json_object(raw):
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except Exception:
                pass
    return {}


def extract_profile(body):
    content = [{"type": "text", "text": EXTRACT_INSTRUCTIONS}]
    if (body.get("text") or "").strip():
        content.append({"type": "text", "text": "Document text:\n" + body["text"].strip()})
    for url in body.get("images") or []:
        content.append({"type": "image_url", "image_url": {"url": url}})

    msg = chat_completion([
        {"role": "system", "content": EXTRACT_SYSTEM},
        {"role": "user", "content": content},
    ])
    text = (msg.get("content") or "").strip()
    # strip stray code fences if the model added them
    if text.startswith("```"):
        text = text.strip("`").lstrip("markdown").lstrip("text").strip()
    print("\n──────── document extraction ────────")
    print(text)
    print("─────────────────────────────────────\n")
    return {"text": text}


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[agauto] " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/api/health"):
            return self._json(200, {"ok": True, "model": MODEL})
        if self.path == "/" or self.path.startswith("/form"):
            return self._serve_form()
        self._json(404, {"error": "not found"})

    def _serve_form(self):
        # /            -> a tiny index
        # /form/x.html -> testform/x.html
        if self.path == "/":
            html = (
                "<h2>AgAuto backend running</h2>"
                "<p>Test forms:</p><ul>"
                "<li><a href='/form/index.html'>/form/index.html</a> (simple)</li>"
                "<li><a href='/form/advanced.html'>/form/advanced.html</a> (custom dropdown + multi-step)</li>"
                "</ul>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self._cors()
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return

        name = self.path[len("/form/"):] or "index.html"
        name = os.path.basename(name)  # prevent traversal
        path = os.path.join(HERE, "testform", name)
        if not os.path.isfile(path):
            return self._json(404, {"error": "form not found"})
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except Exception:
            return self._json(400, {"error": "invalid JSON"})

        try:
            if self.path == "/api/chat":
                msg = chat_completion([
                    {"role": "system", "content": "You are AgAuto. Reply briefly."},
                    {"role": "user", "content": body.get("prompt", "")},
                ])
                return self._json(200, {"reply": msg.get("content") or "", "model": MODEL})

            if self.path == "/api/embed":
                texts = body.get("texts")
                if not isinstance(texts, list) or not texts:
                    return self._json(400, {"error": "texts[] required"})
                return self._json(200, {"vectors": embed(texts)})

            if self.path == "/api/profile/extract":
                if not (body.get("images") or (body.get("text") or "").strip()):
                    return self._json(400, {"error": "images[] or text required"})
                return self._json(200, extract_profile(body))

            if self.path == "/api/session/start":
                if not body.get("profile", {}).get("raw") or not body.get("pageState"):
                    return self._json(400, {"error": "profile.raw and pageState are required"})
                return self._json(200, start_session(body))

            if self.path == "/api/session/step":
                if not body.get("sessionId"):
                    return self._json(400, {"error": "sessionId is required"})
                return self._json(200, step_session(body))

            self._json(404, {"error": "not found"})
        except Exception as e:
            sys.stderr.write(f"[agauto] error on {self.path}: {e}\n")
            self._json(500, {"error": str(e)})


class _Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    print("AgAuto (single-file backend)")
    print(f"  chat   : {MODEL} @ {CHAT_BASE}")
    print(f"  embed  : {EMBED_MODEL} @ {EMBED_BASE}")
    print(f"  listen : http://127.0.0.1:{PORT}")
    print(f"  forms  : http://127.0.0.1:{PORT}/form/index.html")
    if not CHAT_KEY or CHAT_KEY == "not-set":
        print("  WARNING: OPENAI_API_KEY is not set")
    try:
        _Server(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError as e:
        if e.errno == 48:
            print(f"\nERROR: port {PORT} is already in use (another app.py or the Node backend?).")
            print("Free it with:")
            print(f"    lsof -ti tcp:{PORT} | xargs kill -9")
            print(f"Or run app.py on a different port:  PORT=8788 python3 app.py")
            sys.exit(1)
        raise


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye")
