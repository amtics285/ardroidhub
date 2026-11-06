import { db, collection, getDocs, doc, deleteDoc } from "../fb.js";
import { html, render, $, $$, fmtDate, toast } from "../ui.js";

function card(a, kind) {
  const when = kind === "downloads" && a.lastAt
    ? `Downloaded ${a.count > 1 ? a.count + " times, last on " : "on "}${fmtDate(a.lastAt)}`
    : kind === "saved" && a.savedAt ? `Saved on ${fmtDate(a.savedAt)}` : "";
  return html`
    <div class="card app-card mine-card">
      <a class="app-link" href="#/app/${a.id}">
        <img class="icon" src="${a.iconUrl}" alt="" loading="lazy" width="72" height="72">
        <div class="app-card-text">
          <div class="app-name">${a.name}</div>
          <div class="muted small">${a.developerName}${a.category ? " \u00b7 " + a.category : ""}</div>
          <div class="muted small">${when}</div>
        </div>
      </a>
      <button class="btn small ghost danger" data-rm="${a.id}" type="button" aria-label="Remove ${a.name}">Remove</button>
    </div>`;
}

export async function renderMyApps(el, _p, user) {
  if (!user) {
    toast("Please log in first.");
    location.hash = "#/login";
    return;
  }
  const tab = new URLSearchParams(location.hash.split("?")[1] || "").get("tab") === "saved" ? "saved" : "downloads";
  const label = tab === "saved" ? "Saved apps" : "Downloaded";
  render(el, html`
    <h1>My apps</h1>
    <div class="tabs" role="tablist">
      <a class="tab ${tab === "downloads" ? "active" : ""}" role="tab" href="#/downloads">Downloaded</a>
      <a class="tab ${tab === "saved" ? "active" : ""}" role="tab" href="#/downloads?tab=saved">Saved</a>
    </div>
    <div id="list"><div class="muted">Loading\u2026</div></div>`);

  let items = [];
  try {
    const snap = await getDocs(collection(db, "users", user.uid, tab));
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    render($("#list"), html`<div class="error">Could not load this list. Please refresh.</div>`);
    return;
  }
  items.sort((a, b) => ((b.lastAt || b.savedAt)?.seconds || 0) - ((a.lastAt || a.savedAt)?.seconds || 0));

  const list = $("#list");
  if (!items.length) {
    render(list, html`
      <div class="empty">
        <h2>${tab === "saved" ? "No saved apps yet" : "No downloads yet"}</h2>
        <p>${tab === "saved" ? "Press \u201cSave for later\u201d on an app page to keep it here." : "Apps you download while logged in will show up here."}</p>
        <p><a class="btn" href="#/">Browse apps</a></p>
      </div>`);
    return;
  }
  render(list, html`<p class="muted small">${label}: ${items.length}</p><div class="grid">${items.map((a) => card(a, tab))}</div>`);
  $$("[data-rm]", list).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await deleteDoc(doc(db, "users", user.uid, tab, b.dataset.rm));
        b.closest(".app-card").remove();
      } catch {
        toast("Could not remove it.", "err");
        b.disabled = false;
      }
    };
  });
}
