// Tiny helpers. `html` escapes every interpolated value, so user text can never inject markup.

export const raw = (s) => ({ __raw: String(s) });

export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function part(v) {
  if (v && v.__raw !== undefined) return v.__raw;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += part(vals[i]);
  });
  return raw(out);
}

export function render(el, tpl) {
  el.innerHTML = tpl.__raw;
}

// Adds a show/hide (eye) button to every password field inside `root`.
export function enhancePasswords(root = document) {
  const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.parentElement.classList.contains("pw")) return;
    const wrap = document.createElement("span");
    wrap.className = "pw";
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.setAttribute("aria-label", "Show password");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = EYE;
    btn.onclick = (e) => {
      e.preventDefault();
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", String(show));
      input.focus();
    };
    wrap.appendChild(btn);
  });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function fmtDate(ts) {
  const d = ts && ts.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

let toastTimer;
export function toast(msg, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 4500);
}

export const STATUS = {
  draft: { label: "Draft", cls: "gray", help: "Not submitted yet." },
  pending: { label: "In queue", cls: "blue", help: "Waiting for its turn. This usually takes a few minutes." },
  checking: { label: "Reviewing", cls: "blue", help: "We are reviewing your files right now." },
  approved: { label: "Published", cls: "green", help: "Live on the store." },
  rejected: { label: "Rejected", cls: "red", help: "Fix the problems below and submit again." },
};

// Live progress shown to the developer: Submitted > In queue > Checking files > Final checks > Published/Rejected.
export function phases(a) {
  const rejected = a.status === "rejected";
  const at = a.status === "pending" ? 1 : a.status === "checking" ? (a.stage === "final" ? 3 : 2) : 4;
  const labels = ["Submitted", "In queue", "Checking files", "Final checks", rejected ? "Rejected" : "Published"];
  return html`
    <ol class="phases" aria-label="Review progress">
      ${labels.map((l, i) => {
        let cls = "";
        if (a.status === "approved") cls = "done";
        else if (rejected) cls = i < 4 ? "done" : "fail";
        else cls = i < at ? "done" : i === at ? "active" : "";
        return html`<li class="${cls}"><span>${i < at || cls === "done" ? "✓" : i + 1}</span>${l}</li>`;
      })}
    </ol>`;
}

export function badge(status) {
  const s = STATUS[status] || { label: status || "Unknown", cls: "gray" };
  return html`<span class="badge ${s.cls}">${s.label}</span>`;
}

export function permName(p) {
  return String(p).replace(/^android\.permission\./, "").replace(/^com\.android\./, "").replaceAll("_", " ").toLowerCase();
}
