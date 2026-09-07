(() => {
  // extension/src/content/scan.ts
  function scanPage() {
    const elements = [];
    let elIndex = 0;
    let frameCounter = 0;
    function walk(root, framePath) {
      const all = root.querySelectorAll("*");
      all.forEach((node) => {
        const el = node;
        if (isInteractive(el)) {
          el.setAttribute("data-agauto-index", String(elIndex));
          elements.push(describe(el, elIndex, framePath));
          elIndex++;
        }
        const sr = el.shadowRoot;
        if (sr) walk(sr, framePath);
        if (el instanceof HTMLIFrameElement) {
          let doc = null;
          try {
            doc = el.contentDocument;
          } catch {
            doc = null;
          }
          if (doc) {
            const frameIndex = frameCounter++;
            el.setAttribute("data-agauto-frame", String(frameIndex));
            walk(doc, [...framePath, frameIndex]);
          }
        }
      });
    }
    walk(document, []);
    return {
      url: location.href,
      title: document.title,
      scannedAt: Date.now(),
      elementCount: elements.length,
      elements
    };
  }
  var INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "checkbox",
    "radio",
    "combobox",
    "textbox",
    "switch",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    // custom-dropdown options (appear after opening)
    "tab"
  ]);
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      return el.type !== "hidden";
    }
    if (tag === "textarea" || tag === "select" || tag === "button") return true;
    if (tag === "a") return el.hasAttribute("href");
    if (el.isContentEditable) return true;
    const role = el.getAttribute("role");
    return role != null && INTERACTIVE_ROLES.has(role);
  }
  function describe(el, index, framePath) {
    const tag = el.tagName.toLowerCase();
    const kind = getKind(el, tag);
    const anyEl = el;
    const item = {
      index,
      kind,
      tag,
      type: el.getAttribute("type") ?? void 0,
      name: el.getAttribute("name") ?? void 0,
      id: el.id || void 0,
      label: getLabel(el),
      placeholder: el.getAttribute("placeholder") ?? void 0,
      ariaLabel: el.getAttribute("aria-label") ?? void 0,
      role: el.getAttribute("role") ?? void 0,
      required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
      disabled: anyEl.disabled === true || el.getAttribute("aria-disabled") === "true",
      readOnly: anyEl.readOnly === true,
      geometry: getGeometry(el),
      framePath,
      selector: `[data-agauto-index="${index}"]`
    };
    if (tag === "select") {
      const sel = el;
      item.options = Array.from(sel.options).map((o) => ({
        value: o.value,
        label: (o.label || o.text || "").trim(),
        selected: o.selected
      }));
      item.value = sel.value;
    } else if (kind === "checkbox" || kind === "radio") {
      const input = el;
      item.checked = input.checked ?? el.getAttribute("aria-checked") === "true";
      item.value = input.value || void 0;
      if (kind === "radio") item.radioGroup = input.name || void 0;
      if (!item.geometry.visible) {
        const lbl = visibleLabelFor(el);
        if (lbl) item.geometry.visible = true;
      }
    } else if (el.isContentEditable) {
      item.value = (el.textContent || "").trim().slice(0, 500);
    } else if (tag === "input" || tag === "textarea") {
      item.value = anyEl.value ?? void 0;
    } else if (tag === "a" || tag === "button" || item.role === "button") {
      item.value = (el.textContent || "").trim().slice(0, 200);
    } else if (item.role === "combobox") {
      item.value = (el.textContent || "").trim().slice(0, 200) || void 0;
    }
    return item;
  }
  function visibleLabelFor(el) {
    const candidates = [el.closest("label")];
    if (el.id) {
      const root = el.getRootNode();
      candidates.push(
        root.querySelector(`label[for="${cssEscape(el.id)}"]`)
      );
    }
    for (const lbl of candidates) {
      if (!lbl) continue;
      const r = lbl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return lbl;
    }
    return null;
  }
  function getKind(el, tag) {
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (el.isContentEditable) return "contenteditable";
    if (tag === "input") {
      const t = el.type;
      switch (t) {
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "email":
          return "email";
        case "password":
          return "password";
        case "number":
          return "number";
        case "tel":
          return "tel";
        case "url":
          return "url";
        case "date":
        case "datetime-local":
        case "month":
        case "week":
        case "time":
          return "date";
        case "file":
          return "file";
        case "submit":
        case "button":
        case "reset":
          return "button";
        default:
          return "text";
      }
    }
    const role = el.getAttribute("role");
    if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox")
      return "checkbox";
    if (role === "radio" || role === "menuitemradio") return "radio";
    if (role === "combobox") return "select";
    if (role === "textbox") return "text";
    if (role === "link") return "link";
    if (role === "button" || role === "option" || role === "tab" || role === "menuitem")
      return "button";
    return "other";
  }
  function getGeometry(el) {
    const rect = el.getBoundingClientRect();
    const hasBox = rect.width > 0 || rect.height > 0;
    const cv = el.checkVisibility;
    const cssVisible = typeof cv === "function" ? cv.call(el, { checkVisibilityCSS: true }) : true;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      inViewport,
      visible: hasBox && cssVisible
    };
  }
  var LABEL_MAX = 400;
  function getLabel(el) {
    const root = el.getRootNode();
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim().slice(0, LABEL_MAX);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const txt = labelledby.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent?.trim()).filter(Boolean).join(" ");
      if (txt) return squash(txt);
    }
    if (el.id) {
      const forLabel = root.querySelector(
        `label[for="${cssEscape(el.id)}"]`
      );
      if (forLabel?.textContent?.trim()) return squash(forLabel.textContent);
    }
    const wrapping = el.closest("label");
    if (wrapping?.textContent?.trim()) return squash(wrapping.textContent);
    const describedby = el.getAttribute("aria-describedby");
    if (describedby) {
      const txt = describedby.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent?.trim()).filter(Boolean).join(" ");
      if (txt) return squash(txt);
    }
    const nearby = nearbyQuestionText(el);
    if (nearby) return nearby;
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return ph.trim();
    const name = el.getAttribute("name");
    if (name) return humanize(name);
    return void 0;
  }
  function nearbyQuestionText(el) {
    let node = el;
    for (let depth = 0; depth < 5 && node; depth++) {
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.querySelector("input, textarea, select, button")) break;
        const t = squash(sib.textContent ?? "");
        if (t && t.length >= 3) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return void 0;
  }
  function squash(raw) {
    return raw.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  }
  function humanize(raw) {
    return raw.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  }
  function cssEscape(value) {
    const CSSref = window.CSS;
    if (CSSref?.escape) return CSSref.escape(value);
    return value.replace(/["\\]/g, "\\$&");
  }

  // extension/src/content/actions.ts
  function performAction(action) {
    const el = findByIndex(action.index);
    if (!el) {
      return fail(action, "element not found \u2014 re-scan the page (DOM may have changed)");
    }
    flash(el);
    switch (action.type) {
      case "type_text":
        return typeText(el, action);
      case "select_option":
        return selectOption(el, action);
      case "set_checkbox":
        return setCheckbox(el, action);
      case "click":
        return click(el, action);
      case "upload_file":
        return uploadFile(el, action);
      case "scroll_to":
        el.scrollIntoView({ block: "center", inline: "nearest" });
        return ok(action);
      case "upload_document":
        return fail(action, "document upload is handled by the side panel");
      default: {
        const _exhaustive = action;
        return { ok: false, index: -1, action: "click", message: "unknown action" };
      }
    }
  }
  function typeText(el, action) {
    el.scrollIntoView({ block: "center" });
    el.focus();
    if (el.isContentEditable) {
      el.textContent = action.text;
      dispatch(el, "input");
      return ok(action, (el.textContent || "").trim());
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, action.text);
      dispatch(el, "input");
      dispatch(el, "change");
      return ok(action, el.value);
    }
    return fail(action, "element is not a text field");
  }
  function selectOption(el, action) {
    if (!(el instanceof HTMLSelectElement)) {
      return fail(
        action,
        "not a native <select> \u2014 for custom dropdowns, click to open then click the option"
      );
    }
    const opt = Array.from(el.options).find(
      (o) => action.value !== void 0 && o.value === action.value || action.label !== void 0 && (o.label || o.text).trim().toLowerCase() === action.label.trim().toLowerCase()
    );
    if (!opt) return fail(action, "no matching option");
    el.value = opt.value;
    dispatch(el, "input");
    dispatch(el, "change");
    return ok(action, el.value);
  }
  function setCheckbox(el, action) {
    const current = isChecked(el);
    if (current !== action.checked) {
      el.scrollIntoView({ block: "center" });
      checkboxClickTarget(el).click();
      if (isChecked(el) !== action.checked && el instanceof HTMLInputElement) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
        if (desc?.set) desc.set.call(el, action.checked);
        else el.checked = action.checked;
        dispatch(el, "input");
        dispatch(el, "change");
      }
    }
    const after = isChecked(el);
    return {
      ok: after === action.checked,
      index: action.index,
      action: action.type,
      value: String(after),
      message: after === action.checked ? void 0 : "state did not change"
    };
  }
  function checkboxClickTarget(el) {
    if (!(el instanceof HTMLInputElement)) return el;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const invisible = r.width < 2 || r.height < 2 || style.opacity === "0" || style.visibility === "hidden";
    if (!invisible) return el;
    const wrapping = el.closest("label");
    if (wrapping) return wrapping;
    if (el.id) {
      const root = el.getRootNode();
      const forLabel = root.querySelector(
        `label[for="${el.id.replace(/["\\]/g, "\\$&")}"]`
      );
      if (forLabel) return forLabel;
    }
    return el;
  }
  function click(el, action) {
    el.scrollIntoView({ block: "center" });
    el.click();
    return ok(action, clickedText(el));
  }
  function clickedText(el) {
    const t = (el.textContent || "").trim() || (el.getAttribute("aria-label") || "").trim() || (el instanceof HTMLInputElement ? el.value : "");
    return t ? t.slice(0, 120) : void 0;
  }
  function uploadFile(el, action) {
    if (!(el instanceof HTMLInputElement) || el.type !== "file") {
      return fail(action, "not a file input");
    }
    try {
      const bytes = base64ToBytes(action.dataBase64);
      const file = new File([bytes], action.filename, { type: action.mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      dispatch(el, "input");
      dispatch(el, "change");
      return {
        ok: el.files.length > 0,
        index: action.index,
        action: action.type,
        value: file.name
      };
    } catch (e) {
      return fail(action, e instanceof Error ? e.message : "upload failed");
    }
  }
  function findByIndex(index) {
    const sel = `[data-agauto-index="${index}"]`;
    function search(root) {
      const direct = root.querySelector(sel);
      if (direct) return direct;
      for (const node of Array.from(root.querySelectorAll("*"))) {
        const el = node;
        if (el.shadowRoot) {
          const found = search(el.shadowRoot);
          if (found) return found;
        }
        if (el instanceof HTMLIFrameElement) {
          let doc = null;
          try {
            doc = el.contentDocument;
          } catch {
            doc = null;
          }
          if (doc) {
            const found = search(doc);
            if (found) return found;
          }
        }
      }
      return null;
    }
    return search(document);
  }
  function isChecked(el) {
    if (el instanceof HTMLInputElement) return el.checked;
    return el.getAttribute("aria-checked") === "true";
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
  }
  function dispatch(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const buffer = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function flash(el) {
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = "2px solid #6366f1";
    el.style.outlineOffset = "1px";
    window.setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, 600);
  }
  function ok(action, value) {
    return { ok: true, index: action.index, action: action.type, value };
  }
  function fail(action, message) {
    return { ok: false, index: action.index, action: action.type, message };
  }

  // tests-e2e/entry.ts
  window.__agauto = { scanPage, performAction };
})();
