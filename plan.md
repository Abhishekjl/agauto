# AgAuto — Agentic Form-Filling Chrome Extension

## Decisions (locked)
- **Architecture:** Backend server + Chrome extension. Extension = eyes/hands; server = agent brain, profile store, LLM keys.
- **Autonomy default:** Approve-before-submit. Agent fills everything autonomously, previews in-page, waits for user OK before clicking Submit.
- **First target:** Job applications (Greenhouse, Lever, Workday, LinkedIn Easy Apply).

---

## 1. Requirements

### Functional
| # | Requirement |
|---|---|
| F1 | Chrome extension (MV3), runs in user's real logged-in session |
| F2 | Agent-based AI loop: perceive → reason → act → verify |
| F3 | Full-form perception — read entire form incl. off-screen / multi-step |
| F4 | Fill inputs, dropdowns, radios, checkboxes, date pickers, custom widgets |
| F5 | Click buttons (Next, Submit, Continue, expand) |
| F6 | File upload (resume/docs) to native + custom uploaders |
| F7 | Send messages / cover-letter / chat fields |
| F8 | Watch screen — observe state, validation errors, confirm success |
| F9 | Resume/doc ingestion → structured profile data |
| F10 | History-based preference learning across forms |

### Non-functional
- N1 Human-in-the-loop: pause, approve-before-submit, stop, correct
- N2 Privacy/security of resume PII (explicit consent; consider local-first later)
- N3 Anti-bot / ToS risk (mitigated by real-session extension)
- N4 Reliability on unknown ATS DOMs (iframes, shadow DOM, dynamic load)
- N5 Cost/latency (DOM-first, vision-on-demand)
- N6 Auditability (log every field filled)

---

## 2. Architecture

```
Chrome Extension (MV3)
  content script  — DOM perception + action execution (fill/click/upload/scroll)
  side panel UI   — controls, approve-before-submit, progress, logs
  service worker  — orchestrates, talks to backend
        │  state = full DOM snapshot (+ screenshot on demand)
        ▼
Agent Backend (server)
  agent loop (OpenAI-compatible model, function calling)
  tools: click, type, select, upload, scroll, extract, verify, done
  profile store: resume-extracted JSON + form-history answer bank (RAG)
```

### Perception (F3) — DOM-primary, vision-fallback
1. Content script walks full DOM incl. shadow DOM + same-origin iframes → indexed interactive elements (label, ARIA, placeholder, value, geometry, visibility). Captures off-screen fields without scrolling.
2. Vision (screenshot) only when DOM is ambiguous (canvas/custom widgets). Keeps cost down vs. vision-every-step.

### Agent loop (F2)
`get_state → LLM picks action → execute → observe → repeat → verify → (approve) → submit`
Verifier re-reads the form before submit: all required fields filled + match intent.

### Profile & history (F9/F10)
- Resume: PDF/DOCX → text → LLM extraction → structured JSON profile.
- History "answer bank": `semantic-question-key → chosen value`, matched via embeddings. Handles what resumes don't (work authorization, salary, notice period, EEO).
- Per-field confidence: low confidence → pause and ask user inline instead of guessing.

---

## 3. Differentiators vs. browser-use / Skyvern
- Runs in user's real session (extension) — both competitors use server-side browsers.
- Approve-before-submit gate as a first-class mode.
- Semantic preference learning across sites (the moat).
- Cost-tiered perception (DOM-first) — cheaper than Skyvern, more robust than DOM-only browser-use.
- Dry-run preview: fill + highlight in-page, edit, then submit.
- Multi-page workflow memory (Workday-style).

---

## 4. Open risks
- N2 resume PII → cloud LLM (need consent; local-first option later)
- N3 ToS on LinkedIn/Indeed/Workday
- N4 custom dropdowns, date pickers, file uploaders = 80% of failures

---

## 5. Tech Stack

### Chrome Extension (client — eyes & hands)
- **Manifest V3**, **TypeScript** throughout.
- **UI:** React + Vite via `@crxjs/vite-plugin`, rendered in a **Side Panel** (`chrome.sidePanel`) — persistent across page navigations.
- **Styling:** Tailwind CSS.
- **Content script:** vanilla TS + DOM APIs; walks shadow DOM + same-origin iframes.
- **Messaging:** `chrome.runtime` (content script ↔ service worker ↔ side panel).
- **Screenshots:** `chrome.tabs.captureVisibleTab` (vision fallback).

### Backend (brain)
- **Node.js + TypeScript**, **Fastify**.
- **LLM:** official **`openai` SDK** pointed at any **OpenAI-compatible endpoint** via configurable `baseURL` + `model` env vars (works with OpenAI, Azure OpenAI, OpenRouter, Groq, Together, or local vLLM/Ollama/LM Studio). Provider-neutral by design — swap models without code changes.
- **Agent loop:** manual **function-calling** loop (`tools` = functions; not an auto-runner) so we can intercept before submit for the approve-gate.
- **Structured extraction:** OpenAI **Structured Outputs** (`response_format: {type: "json_schema", …}`) where the provider supports it; fall back to function calling + JSON mode + client-side validation (**Zod**) for providers that don't.
- **Resume ingestion:** parse the file **locally** first (`pdf-parse` for PDF, `mammoth` for DOCX) → send text → structured extraction. (OpenAI-compatible APIs have no universal document-block input, so we don't rely on a Files API.) For scanned/image PDFs, fall back to the vision path.
- **Vision fallback:** base64 screenshots sent as `image_url` content parts to a vision-capable model when the DOM is ambiguous.
- **Prompt caching:** rely on the provider's automatic prefix caching (OpenAI) where available; keep the system prompt + tool defs stable at the front of the prompt to benefit. Not guaranteed on all compatible providers.

### Data
- **Postgres** (users, profiles, form history, answer bank) + **pgvector** (semantic field matching).
- **Redis** (multi-page fill session/job state).

### Auth / infra
- Backend holds the Anthropic API key — never in the extension.
- Per-user auth (magic link / OAuth); profiles scoped per user.

### Agent tools (map 1:1 to content-script actions)
`get_page_state`, `type_text`, `select_option`, `set_checkbox`, `click`, `upload_file`, `scroll_to`, `read_screenshot` (vision fallback), `ask_user` (low-confidence pause), `verify_and_finish` (stops for approval before real submit).

---

## 6. Implementation Phases

> Solo-dev rough estimates; parallelizable. Critical path = Phases 1–3 (perception + actions + agent loop). Everything else plugs into that loop.

| Phase | Est. | Deliverable | Done when |
|---|---|---|---|
| **0 — Scaffold** | ~1 wk | MV3 extension (Vite+React+Tailwind+side panel) + Fastify backend + one Claude call | Side panel opens; backend returns a Claude response |
| **1 — Perception** | ~2 wk | Content-script DOM walker → indexed interactive-element JSON (labels, types, values, shadow DOM, iframes, geometry) | On 5 real ATS forms, captures every field incl. off-screen |
| **2 — Action layer** | ~1.5 wk | Content-script executors: type/select/check/click/upload/scroll | Fills + submits a test form on command |
| **3 — Agent loop** | ~2 wk | Backend tool-use loop: perception → Claude → actions, with approve-before-submit gate | Fills a Greenhouse/Lever form end-to-end, waits for OK |
| **4 — Resume & profile** | ~1.5 wk | Local parse (pdf-parse/mammoth) → structured extraction → Postgres profile; agent fills from it | Upload resume once → name/email/experience auto-fill |
| **5 — Answer bank (moat)** | ~2 wk | pgvector store of past answers; semantic field matching; `ask_user` fallback | 2nd application reuses salary/authorization/notice answers |
| **6 — Vision fallback + hardening** | ~2 wk | Screenshot-on-ambiguity; custom dropdowns/date pickers/uploaders; multi-page workflows; dry-run preview | Handles a Workday multi-page app; preview before submit |
| **7 — Polish & pilot** | ~1.5 wk | Auth, audit log, error recovery, UX | Self-apply to 10 real jobs |

**MVP cut (first demo, ~5–6 wk):** Phases 0→3 + minimal Phase 4 (name/email/resume-upload). "Fill this Greenhouse form from my resume, approve before submit."

---

## 7. Shippability / Go-to-Market

Architecture is multi-tenant by design (backend holds keys, per-user data) — onboarding user #2 needs no rework. Gates between "works for me" and "sellable":

- **Chrome Web Store review** — broad host permissions + reads page content + server calls = heightened scrutiny. Needs privacy policy + permission justification. Days-to-weeks, possible rejections.
- **Privacy/compliance** — holding customers' resume PII: privacy policy, data-processing terms, deletion/export, encryption at rest (GDPR/CCPA if EU/CA users).
- **ToS/anti-bot liability at scale** — approve-before-submit mitigates; avoid mass-apply features.
- **Reliability tax** — every weird ATS DOM = a support ticket; ongoing maintenance.
- **SaaS plumbing** — Stripe billing, per-user Claude-cost metering + caps, onboarding, support.

### Maturity ladder
| Stage | Effort beyond MVP | Users |
|---|---|---|
| Personal tool | 0 | Just you (load unpacked) |
| Private beta | ~1–2 wk | 5–20 users (unlisted extension + simple auth) |
| Public Web Store product | ~3–5 wk | Anyone (store review, privacy policy, billing, caps, logging) |
| Compliant SaaS | +ongoing | Paying customers at scale (security, GDPR, support, SLA) |

### Build-for-shippability from day one (cheap early, painful to retrofit)
1. **Per-user API-cost metering + monthly cap** — add in Phase 3/4.
2. **Data deletion/export endpoints + encryption-at-rest** for resumes — Phase 4.
3. **Structured per-fill error/audit log** — Phase 3; makes customer support survivable.

**Launch strategy:** build customer-ready, ship as private beta first.

---

## 8. Immediate Next Steps
1. Scaffold Phase 0: MV3 extension (Vite+React+Tailwind+side panel) + Fastify backend + working OpenAI-compatible chat call (configurable `baseURL`/`model`).
2. Define the shared TypeScript types (page-state schema, tool schemas) used by both extension and backend.
3. Build the Phase 1 DOM walker against 5 real ATS forms as fixtures.
