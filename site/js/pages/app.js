import { db, doc, getDoc } from "../fb.js";
import { html, render, fmtSize, fmtDate, safeUrl, badge, permName, STATUS } from "../ui.js";

export async function renderApp(el, [id], user) {
  render(el, html`<div class="muted">Loading…</div>`);
  let snap;
  try {
    snap = await getDoc(doc(db, "apps", id));
  } catch {
    snap = null; // rules deny access to apps that are not public and not yours
  }
  if (!snap || !snap.exists()) {
    render(el, html`<div class="empty"><h2>App not found</h2><p><a href="#/">Back to the store</a></p></div>`);
    return;
  }
  const a = snap.data();
  const published = a.status === "approved";
  const privacy = safeUrl(a.privacyUrl);
  const perms = a.permissions || [];

  render(el, html`
    ${!published ? html`<div class="notice">This is your own app and it is not public yet. Status: ${badge(a.status)} ${STATUS[a.status]?.help || ""}</div>` : ""}
    <section class="app-head">
      ${a.iconUrl ? html`<img class="icon big" src="${a.iconUrl}" alt="" width="112" height="112">` : html`<div class="icon big placeholder"></div>`}
      <div>
        <h1>${a.name}</h1>
        <div class="dev">${a.developerName}</div>
        <div class="muted">${a.category} · ${a.appType === "game" ? "Game" : "App"}</div>
      </div>
    </section>

    <section class="stats">
      <div><b>${a.versionName || "-"}</b><span>Version</span></div>
      <div><b>${fmtSize(a.size) || "-"}</b><span>Size</span></div>
      <div><b>${a.minSdk ? "Android " + a.minSdk + "+" : "-"}</b><span>API level</span></div>
      <div><b>${a.vt ? "Scanned" : "Checked"}</b><span>By bot</span></div>
    </section>

    ${published
      ? html`<p><a class="btn big" href="${a.apkUrl}" rel="noopener">Install (download APK)</a></p>
             <p class="muted small">Android may ask you to allow installs from this browser. This is normal for apps outside Google Play.</p>`
      : ""}

    ${(a.screenshots || []).length
      ? html`<div class="shots">${a.screenshots.map((s, i) => html`<img src="${s}" alt="Screenshot ${i + 1}" loading="lazy">`)}</div>`
      : ""}

    <h2 class="section-title">About this app</h2>
    <p class="pre">${a.fullDesc || a.shortDesc}</p>

    ${a.whatsNew ? html`<h2 class="section-title">What's new</h2><p class="pre">${a.whatsNew}</p>` : ""}

    ${perms.length
      ? html`<h2 class="section-title">Permissions (${perms.length})</h2>
             <details class="card pad"><summary>Show permissions</summary>
               <ul class="perms">${perms.map((p) => html`<li>${permName(p)}</li>`)}</ul>
             </details>`
      : ""}

    <h2 class="section-title">App info</h2>
    <dl class="info card pad">
      <dt>Developer</dt><dd>${a.developerName}</dd>
      ${a.contactEmail ? html`<dt>Contact</dt><dd>${a.contactEmail}</dd>` : ""}
      ${privacy ? html`<dt>Privacy policy</dt><dd><a href="${privacy}" rel="noopener noreferrer nofollow" target="_blank">${privacy}</a></dd>` : ""}
      ${a.package ? html`<dt>Package</dt><dd>${a.package}</dd>` : ""}
      ${a.publishedAt ? html`<dt>Published</dt><dd>${fmtDate(a.publishedAt)}</dd>` : ""}
      ${a.sha256 ? html`<dt>SHA-256</dt><dd class="mono">${a.sha256}</dd>` : ""}
    </dl>
  `);
}
