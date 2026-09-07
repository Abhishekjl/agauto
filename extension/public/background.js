// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[agauto] setPanelBehavior failed:", err));
});

// The service worker is the model proxy: it holds no logic beyond making the
// configured HTTP calls. It can reach hosts in host_permissions (incl. http),
// which extension *pages* can't (mixed content). Config lives in chrome.storage.
const SETTINGS_KEY = "agauto_settings";
const DEFAULTS = {
  chatBaseUrl: "https://api.openai.com/v1",
  chatKey: "",
  model: "gpt-4o",
  embedBaseUrl: "",
  embedKey: "",
  embedModel: "text-embedding-3-small",
};

async function getSettings() {
  const v = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({}, DEFAULTS, v[SETTINGS_KEY] || {});
}

function trimUrl(u) {
  return String(u || "").replace(/\/+$/, "");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "LLM_CHAT") {
    handleChat(msg).then(sendResponse).catch((e) => sendResponse({ error: errStr(e) }));
    return true;
  }
  if (msg && msg.type === "LLM_EMBED") {
    handleEmbed(msg).then(sendResponse).catch((e) => sendResponse({ error: errStr(e) }));
    return true;
  }
  return undefined;
});

function errStr(e) {
  return String((e && e.message) || e);
}

async function handleChat(msg) {
  const s = await getSettings();
  if (!s.chatBaseUrl || !s.chatKey || !s.model) {
    return { error: "Model not configured — open the Settings tab." };
  }
  const body = { model: s.model, messages: msg.messages };
  if (msg.tools) {
    body.tools = msg.tools;
    body.tool_choice = "auto";
    body.parallel_tool_calls = false;
  }
  const r = await fetch(trimUrl(s.chatBaseUrl) + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + s.chatKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { error: r.status + " " + text.slice(0, 400) };
  const data = JSON.parse(text);
  const message = data.choices && data.choices[0] && data.choices[0].message;
  if (!message) return { error: "empty model response" };
  return { message, model: data.model };
}

async function handleEmbed(msg) {
  const s = await getSettings();
  const base = s.embedBaseUrl || s.chatBaseUrl;
  const key = s.embedKey || s.chatKey;
  if (!base || !key || !s.embedModel) return { error: "embeddings not configured" };
  const r = await fetch(trimUrl(base) + "/embeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: s.embedModel, input: msg.texts }),
  });
  const text = await r.text();
  if (!r.ok) return { error: r.status + " " + text.slice(0, 400) };
  const data = JSON.parse(text);
  return { vectors: (data.data || []).map((d) => d.embedding) };
}
