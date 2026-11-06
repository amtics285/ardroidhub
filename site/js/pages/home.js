import { db, collection, getDocs, query, where, limit } from "../fb.js";
import { html, render, $, fmtSize, fmtNum, avgRating, stars } from "../ui.js";
import { icon } from "../icons.js";
import { CATEGORIES } from "../config.js";

const CACHE_KEY = "ardh_apps_v2";
let inflight = null;
let inflightAt = 0;

// Only the fields the cards need, so the saved copy stays small.
function slim(d) {
  const x = d.data();
  return {
    id: d.id, name: x.name, developerName: x.developerName, category: x.category, size: x.size, iconUrl: x.iconUrl,
    shortDesc: x.shortDesc, package: x.package, at: x.publishedAt?.seconds || 0,
    downloads: x.downloads || 0, ratingSum: x.ratingSum || 0, ratingCount: x.ratingCount || 0,
  };
}

function fetchApps() {
  inflightAt = Date.now();
  inflight = (async () => {
    const snap = await getDocs(query(collection(db, "apps"), where("status", "==", "approved"), limit(200)));
    const apps = snap.docs.map(slim).sort((a, b) => b.at - a.at);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(apps)); } catch { /* storage full or private mode */ }
    return apps;
  })();
  return inflight;
}

// Called once at startup (main.js) so the list loads while the sign-in check is still running.
export function prefetchApps() {
  fetchApps().catch(() => { inflight = null; });
}

function cachedApps() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
}

export function appCard(a) {
  const avg = avgRating(a);
  return html`
    <div class="card-wrap"><a class="card app-card" href="#/app/${a.id}">
      <img class="icon" src="${a.iconUrl}" alt="" loading="lazy" decoding="async" width="72" height="72">
      <div class="app-card-text">
        <div class="app-name">${a.name}</div>
        <div class="muted small">${a.developerName}</div>
        <div class="app-meta small">
          ${a.ratingCount ? html`<span class="rate">${avg.toFixed(1)} ${stars(avg)}</span>` : html`<span class="muted">New</span>`}
          <span class="muted">${a.downloads ? fmtNum(a.downloads) + " downloads" : a.category}${a.size ? " · " + fmtSize(a.size) : ""}</span>
        </div>
      </div>
    </a>
    <button class="share-btn" type="button" data-share="${a.id}" data-name="${a.name}" aria-label="Share ${a.name}" title="Share">${icon("share", 18)}</button></div>`;
}

const skeleton = html`<div class="grid">${[1, 2, 3, 4, 5, 6].map(() => html`
  <div class="card app-card"><div class="icon skel"></div><div class="app-card-text grow"><div class="skel line w60"></div><div class="skel line w40"></div><div class="skel line w80"></div></div></div>`)}</div>`;

function tile(a, i) {
  const avg = avgRating(a);
  return html`
    <div class="card-wrap tile-wrap"><a class="tile" href="#/app/${a.id}">
      <span class="rank">${i + 1}</span>
      <img class="icon" src="${a.iconUrl}" alt="" loading="lazy" decoding="async" width="88" height="88">
      <div class="app-name">${a.name}</div>
      <div class="muted small">${a.category}</div>
      <div class="small tile-meta">${a.ratingCount ? html`<span class="rate">${avg.toFixed(1)} ★</span>` : html`<span class="muted">New</span>`}${a.downloads ? html`<span class="muted">${fmtNum(a.downloads)}↓</span>` : ""}</div>
    </a></div>`;
}

export async function renderHome(el) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = (params.get("q") || "").trim().toLowerCase();
  const cat = params.get("cat") || "";
  const searchBox = $("#searchInput");
  if (searchBox) searchBox.value = params.get("q") || "";

  let shown = ""; // JSON of what is on screen, to skip pointless redraws
  const draw = (apps) => {
    const sig = JSON.stringify(apps);
    if (sig === shown) return;
    shown = sig;
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
          <p>Apps will show up here soon. Check back in a little while.</p>
          <p class="small">Are you a developer? <a href="#/become-developer">Become a developer</a> and publish yours.</p>
        </div>`;
    } else if (!filtered.length) {
      body = html`<div class="empty"><h2>Nothing found</h2><p>Try a different search or category.</p></div>`;
    } else {
      const plain = !q && !cat;
      const top = plain && apps.length >= 3 ? [...apps].sort((x, y) => (y.downloads || 0) - (x.downloads || 0)).slice(0, 10) : [];
      const rated = plain && apps.length >= 3 ? [...apps].filter((x) => x.ratingCount).sort((x, y) => avgRating(y) - avgRating(x)).slice(0, 10) : [];
      body = html`
        ${top.length ? html`<h2 class="section-title">Top downloads</h2><div class="rail">${top.map(tile)}</div>` : ""}
        ${rated.length >= 3 ? html`<h2 class="section-title">Top rated</h2><div class="rail">${rated.map(tile)}</div>` : ""}
        <h2 class="section-title">${q || cat ? `Results (${filtered.length})` : "New & updated"}</h2>
        <div class="grid">${filtered.map(appCard)}</div>`;
    }

    render(el, html`
      ${!q && !cat ? html`
        <section class="hero">
          <h1>Find Android apps you can trust</h1>
          <p>Download free Android apps straight to your phone. No account needed.</p>
          <form class="hero-search" id="heroSearch" role="search">
            <input type="search" id="heroQ" placeholder="Search apps and games" aria-label="Search apps and games" autocomplete="off">
            <button class="btn" type="submit">Search</button>
          </form>
          <div class="hero-stats">
            <div><b>${fmtNum(apps.length)}</b><span>Apps</span></div>
            <div><b>${fmtNum(apps.reduce((n, x) => n + (x.downloads || 0), 0))}</b><span>Downloads</span></div>
            <div><b>Free</b><span>Always</span></div>
          </div>
        </section>` : ""}
      ${chips}
      ${body}`);
    const hs = $("#heroSearch");
    if (hs) hs.onsubmit = (e) => {
      e.preventDefault();
      const v = $("#heroQ").value.trim();
      location.hash = v ? "#/?q=" + encodeURIComponent(v) : "#/";
    };
  };

  // 1) paint at once from the saved copy (or a skeleton), 2) swap in the fresh list when it arrives
  const saved = cachedApps();
  if (saved) draw(saved);
  else render(el, html`${skeleton}`);
  try {
    draw(await (inflight && Date.now() - inflightAt < 30000 ? inflight : fetchApps()));
  } catch (e) {
    console.error(e);
    if (!saved) render(el, html`<div class="empty"><h2>Could not load apps</h2><p>Check your internet and refresh the page.</p></div>`);
  }
}
