<div align="center">

<img src="./assets/logo.png" alt="AgAuto logo" width="120" height="120" />

# AgAuto

### AI agent that fills web forms from your resume — you approve before it submits.

A Chrome extension that reads any web form (job applications, signups, surveys), fills every
field from your profile using an AI agent, writes tailored cover-letter answers, and stops for
your approval before anything is submitted. **Runs entirely in your browser** — bring your own
OpenAI-compatible model.

</div>

---

## ✨ Features

- **Whole-form perception** — reads the entire form, including off-screen fields, shadow DOM, and same-origin iframes.
- **Fills everything** — text, email, dropdowns (native *and* custom), radios, checkboxes, date pickers, `+/-` steppers, and file uploads.
- **Resume → profile** — upload a PDF/image (read by vision) or `.txt`; AgAuto transcribes the **full** content into an editable profile.
- **AI-written answers** — composes cover letters and "why this role?" responses from your profile, tailored to a pasted **job description**.
- **Plain-language steering** — an *Instructions* box: *"I'm available immediately; emphasize my MCP work; keep it concise."*
- **Semantic answer bank** — matches form fields to your facts by *meaning* (optional embeddings), and remembers answers it asks you for.
- **Approve before submit** — a dry-run preview highlights every filled field in green; nothing submits until you say so (or enable auto-submit).
- **Precise control** — drag a rectangle to fill **only a selected area**, and **Pause / Resume / Stop** any run.
- **History** — every submitted form is logged locally; promote answers back into your profile.
- **Light & dark themes.**
- **100% local & private** — your profile, documents, and API key live only in the browser. No backend, no server.

## 🖼️ Screens

> _Add screenshots here for the Chrome Web Store listing_ — e.g. `assets/screenshot-agent.png`, `assets/screenshot-fill.png`.

## 🚀 Install

### From source (Developer mode)

```bash
git clone <your-repo> && cd agauto
npm install
npm run build:extension        # builds → extension/dist
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select `extension/dist`
4. Click the AgAuto toolbar icon to open the side panel.

### From a packaged zip

```bash
./package.sh                   # → agauto-extension.zip
```
Unzip, then **Load unpacked** the folder (or upload the zip to the Chrome Web Store).

## ⚙️ Configure your model

Open the side panel → **⚙ Settings** and enter your **OpenAI-compatible** endpoint:

| Field | Example |
|---|---|
| Base URL | `https://api.openai.com/v1` |
| API key | `sk-…` |
| Model | `gpt-4o` (needs **function calling** + **vision**) |

Click **Test** → you should see `✓ connected`. Embeddings (for semantic matching) are optional —
leave blank to reuse the chat endpoint, or point at any valid-TLS embeddings endpoint.

## 📋 Use it

1. Open a form (e.g. a job application).
2. **Upload** your resume once — the profile fills in automatically (editable, collapsed by default).
3. *(optional)* Add **Instructions** and paste a **Job description** to tailor answers.
4. Hit **Fill this form** → watch it fill; filled fields glow green.
5. **Approve & submit** — or **Revise** with a note, or answer any question it asks (saved for next time).

Extras: **Select area to fill** (drag a box) · **Auto-submit** toggle · **Pause / Resume / Stop** · **History** tab.

## 🔒 Privacy & permissions

AgAuto is **local-first**. Your profile text, uploaded document, learned answers, and API key are
stored only in the extension's local storage (`chrome.storage.local`) on your machine. They are
sent **only** to the model endpoint *you* configure, and nowhere else — there is no AgAuto server.

| Permission | Why |
|---|---|
| `sidePanel` | The app UI |
| `storage`, `unlimitedStorage` | Store your profile, settings, and document locally |
| `activeTab`, `scripting` | Read and fill the form on the tab you're on |
| `host_permissions: http/https` | Call the model endpoint you configure, and run on the form's page |

## 🧠 How it works

Everything runs client-side. The **content script** perceives and acts on the page; the **side panel**
runs the agent loop; the **background service worker** makes the model API calls (it can reach the
`http`/`https` host you configure). No Python, no Node server at runtime.

```
Side panel (agent loop) ──▶ Background worker ──▶ your OpenAI-compatible model
        │  scan / act
        ▼
   Content script (reads & fills the page)
```

## 🛠️ Development

```bash
npm run build:extension    # build the extension (extension/dist)
npm run dev:extension      # rebuild on change
./run.sh                   # build if needed, then run the (legacy) local backend
./package.sh               # build + zip for distribution
```

- `extension/` — the MV3 extension (Vite + React + Tailwind + TypeScript)
- `shared/` — TypeScript types shared across the app
- `app.py`, `backend/` — a **legacy** local backend (no longer required; the extension is standalone)

## ⚠️ Requirements & limits

- Your model must support **function calling** (for the agent) and **vision** (for PDF/image resumes).
- The browser can't accept **self-signed TLS** certs — an embeddings endpoint must be valid-https or http.
- It does **not** solve CAPTCHAs or bypass anti-bot walls — those are handed back to you.
- Reliability on unusual/custom widgets varies; it degrades gracefully and asks when unsure.

## 📄 License

MIT — see `LICENSE`.
