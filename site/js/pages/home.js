import { db, collection, getDocs, query, where, limit } from "../fb.js";
import { html, render, $, fmtSize } from "../ui.js";
import { CATEGORIES } from "../config.js";

export function appCard(a) {
  return html`
    <a class="card app-card" href="#/app/${a.id}">
      <img class="icon" src="${a.iconUrl}" alt="" loading="lazy" width="64" height="64">
      <div class="app-card-text">
        <div class="app-name">${a.name}</div>
        <div class="muted small">${a.developerName}</div>
        <div class="muted small">${a.category}${a.size ? " · " + fmtSize(a.size) : ""}</div>
      </div>
    </a>`;
}

export async function renderHome(el) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = (params.get("q") || "").trim().toLowerCase();
  const cat = params.get("cat") || "";
  const searchBox = $("#searchInput");
  if (searchBox) searchBox.value = params.get("q") || "";

  render(el, html`<div class="muted">Loading apps…</div>`);
  const snap = await getDocs(query(collection(db, "apps"), where("status", "==", "approved"), limit(200)));
  let apps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  apps.sort((a, b) => (b.publishedAt?.seconds || 0) - (a.publishedAt?.seconds || 0));

  const filtered = apps.filter((a) => {
    if (cat && a.category !== cat) return false;
    if (!q) return true;
    return [a.name, a.shortDesc, a.developerName, a.package].some((t) => String(t || "").toLowerCase().includes(q));
  });

  const chips = html`
    <div class="chips">
      <a class="chip ${cat ? "" : "active"}" href="#/${q ? "?q=" + encodeURIComponent(q) : ""}">All</a>
      ${CATEGORIES.map((c) => {
        const qs = new URLSearchParams();
        if (q) qs.set("q", q);
        qs.set("cat", c);
        return html`<a class="chip ${cat === c ? "active" : ""}" href="#/?${qs.toString()}">${c}</a>`;
      })}
    </div>`;

  let body;
  if (!apps.length) {
    body = html`
      <div class="empty">
        <h2>No apps yet</h2>
        <p>Be the first to publish an app on AR DroidHub.</p>
        <p><a class="btn" href="#/upload">Publish an app</a></p>
      </div>`;
  } else if (!filtered.length) {
    body = html`<div class="empty"><h2>Nothing found</h2><p>Try a different search or category.</p></div>`;
  } else {
    body = html`
      <h2 class="section-title">${q || cat ? `Results (${filtered.length})` : "New & updated"}</h2>
      <div class="grid">${filtered.map(appCard)}</div>`;
  }

  render(el, html`
    ${!q && !cat ? html`<section class="hero"><h1>Find Android apps</h1><p>Every app is scanned by our bot before it goes live.</p></section>` : ""}
    ${chips}
    ${body}`);
}
