import {
  db, doc, getDoc, getDocs, collection, query, orderBy, limit, setDoc, deleteDoc, serverTimestamp, increment,
} from "../fb.js";
import { html, render, $, $$, toast, fmtSize, fmtNum, fmtDate, safeUrl, badge, permName, STATUS, stars, avgRating } from "../ui.js";
import { post, countDownload } from "../api.js";
import { initial } from "../state.js";
import { icon } from "../icons.js";

function statsStrip(a) {
  const avg = avgRating(a);
  return html`
    <div class="stat"><b>${a.ratingCount ? avg.toFixed(1) + " ★" : "New"}</b><span>${a.ratingCount ? fmtNum(a.ratingCount) + (a.ratingCount === 1 ? " rating" : " ratings") : "No ratings yet"}</span></div>
    <div class="stat"><b>${fmtNum(a.downloads || 0)}</b><span>Downloads</span></div>
    <div class="stat"><b>${fmtSize(a.size) || "-"}</b><span>Size</span></div>
    <div class="stat"><b>${a.minSdk ? "Android " + a.minSdk + "+" : "-"}</b><span>Requires</span></div>`;
}

function ratingBox(a) {
  const avg = avgRating(a);
  return html`
    <div class="rating-big">${a.ratingCount ? avg.toFixed(1) : "–"}</div>
    <div>
      <div>${stars(avg)}</div>
      <div class="muted small">${a.ratingCount ? `${fmtNum(a.ratingCount)} rating${a.ratingCount === 1 ? "" : "s"}` : "Be the first to rate this app"}${a.reviewCount ? ` · ${fmtNum(a.reviewCount)} review${a.reviewCount === 1 ? "" : "s"}` : ""}</div>
    </div>`;
}

function reviewItem(r, mine) {
  const ini = initial({ displayName: r.userName });
  return html`
    <article class="review">
      <div class="avatar sm" aria-hidden="true">${ini || icon("user", 16)}</div>
      <div class="grow">
        <div class="review-head"><b>${r.userName || "User"}</b>${mine ? html` <span class="badge gray">You</span>` : ""}
          <span class="muted small">${fmtDate(r.updatedAt)}</span></div>
        <div>${stars(r.rating)}</div>
        ${r.text ? html`<p class="pre review-text">${r.text}</p>` : ""}
        ${mine ? html`<button class="linklike small danger-text" data-delrev type="button">Delete my review</button>` : ""}
      </div>
    </article>`;
}

export async function renderApp(el, [id], user) {
  render(el, html`<div class="app-head"><div class="icon big skel"></div><div class="grow"><div class="skel line w40"></div><div class="skel line w60"></div></div></div>`);
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
  let a = snap.data();
  const published = a.status === "approved";
  const privacy = safeUrl(a.privacyUrl);
  const perms = a.permissions || [];

  render(el, html`
    ${!published ? html`<div class="notice">This is your own app and it is not public yet. Status: ${badge(a.status)} ${STATUS[a.status]?.help || ""}</div>` : ""}
    <section class="app-head">
      ${a.iconUrl ? html`<img class="icon big" src="${a.iconUrl}" alt="" width="120" height="120">` : html`<div class="icon big placeholder"></div>`}
      <div class="grow">
        <h1>${a.name}</h1>
        <div class="dev">${a.developerName}</div>
        <div class="muted">${a.category} · ${a.appType === "game" ? "Game" : "App"}</div>
        ${a.shortDesc ? html`<p class="muted app-tagline">${a.shortDesc}</p>` : ""}
      </div>
    </section>

    <section class="stats" id="stats">${statsStrip(a)}</section>

    ${published
      ? html`<p class="head-actions">
               <a class="btn big" id="installBtn" href="${a.apkUrl}" rel="noopener">${icon("download", 20)} Install (download APK)</a>
               <button class="btn big ghost" id="saveBtn" type="button">Save for later</button>
             </p>
             <p class="muted small">Android may ask you to allow installs from this browser. This is normal for apps outside Google Play.
               ${user ? "" : html`<a href="#/login">Log in</a> to keep a history of the apps you download.`}</p>`
      : ""}

    ${(a.screenshots || []).length
      ? html`<div class="shots">${a.screenshots.map((s, i) => html`<img src="${s}" alt="Screenshot ${i + 1}" loading="lazy" decoding="async">`)}</div>`
      : ""}

    <h2 class="section-title">About this app</h2>
    <p class="pre">${a.fullDesc || a.shortDesc}</p>

    ${a.whatsNew ? html`<h2 class="section-title">What's new</h2><p class="pre">${a.whatsNew}</p>` : ""}

    ${published ? html`
      <h2 class="section-title">Ratings &amp; reviews</h2>
      <div class="card pad rating-box" id="ratingBox">${ratingBox(a)}</div>
      <div id="rform"></div>
      <div id="rlist"></div>` : ""}

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
      ${a.versionName ? html`<dt>Version</dt><dd>${a.versionName}</dd>` : ""}
      ${a.publishedAt ? html`<dt>Published</dt><dd>${fmtDate(a.publishedAt)}</dd>` : ""}
      ${a.sha256 ? html`<dt>SHA-256</dt><dd class="mono">${a.sha256}</dd>` : ""}
    </dl>
  `);

  if (!published) return;
  let alive = true;
  const brief = { name: a.name || "", iconUrl: a.iconUrl || "", developerName: a.developerName || "", category: a.category || "" };

  // ----- install: count it, and keep a history for logged-in people. Never delays the download. -----
  $("#installBtn").addEventListener("click", () => {
    countDownload(id);
    if (!user) return;
    setDoc(doc(db, "users", user.uid, "downloads", id), { ...brief, lastAt: serverTimestamp(), count: increment(1) }, { merge: true })
      .catch((e) => console.error(e));
  });

  // ----- save for later -----
  const saveBtn = $("#saveBtn");
  let saved = false;
  const paintSave = () => { saveBtn.textContent = saved ? "Saved ✓" : "Save for later"; };
  paintSave();
  if (user) {
    getDoc(doc(db, "users", user.uid, "saved", id)).then((s) => { saved = s.exists(); if (alive) paintSave(); }).catch(() => {});
  }
  saveBtn.onclick = async () => {
    if (!user) {
      toast("Log in to save apps.");
      location.hash = "#/login";
      return;
    }
    saveBtn.disabled = true;
    try {
      const ref = doc(db, "users", user.uid, "saved", id);
      if (saved) await deleteDoc(ref);
      else await setDoc(ref, { ...brief, savedAt: serverTimestamp() });
      saved = !saved;
      paintSave();
    } catch (e) {
      console.error(e);
      toast("Could not update your saved apps.", "err");
    }
    saveBtn.disabled = false;
  };

  // ----- ratings and reviews -----
  let reviews = [];
  let chosen = 0;

  const paintHeader = () => {
    if (!alive) return;
    $("#stats").innerHTML = statsStrip(a).__raw;
    $("#ratingBox").innerHTML = ratingBox(a).__raw;
  };

  async function refreshApp() {
    try {
      const s = await getDoc(doc(db, "apps", id));
      if (s.exists()) a = s.data();
    } catch { /* keep what we have */ }
    paintHeader();
  }

  function drawForm() {
    const box = $("#rform");
    if (!box) return;
    const own = user ? reviews.find((r) => r.id === user.uid) : null;
    if (!user) {
      render(box, html`<p class="muted"><a href="#/login">Log in</a> to rate this app and write a review.</p>`);
      return;
    }
    if (a.ownerUid === user.uid) {
      render(box, html`<p class="muted small">You can not review your own app.</p>`);
      return;
    }
    if (!user.emailVerified) {
      render(box, html`<p class="muted"><a href="#/verify">Verify your email</a> to rate this app.</p>`);
      return;
    }
    if (!chosen && own) chosen = own.rating;
    render(box, html`
      <form class="card pad review-form" id="rf" novalidate>
        <b>${own ? "Edit your review" : "Rate this app"}</b>
        <div class="star-input" role="radiogroup" aria-label="Your rating">
          ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class="star-btn ${n <= chosen ? "on" : ""}" data-v="${n}" role="radio" aria-checked="${n === chosen}" aria-label="${n} star${n > 1 ? "s" : ""}">${icon("star", 30)}</button>`)}
        </div>
        <label>Your review <small>(optional, up to 500 characters)</small>
          <textarea name="text" rows="3" maxlength="500" placeholder="What did you like or dislike?">${own ? own.text || "" : ""}</textarea></label>
        <p class="error small" id="rerr" hidden></p>
        <button class="btn" type="submit">${own ? "Update review" : "Post review"}</button>
      </form>`);
    $$(".star-btn", box).forEach((b) => {
      b.onclick = () => {
        chosen = Number(b.dataset.v);
        $$(".star-btn", box).forEach((x) => {
          x.classList.toggle("on", Number(x.dataset.v) <= chosen);
          x.setAttribute("aria-checked", String(Number(x.dataset.v) === chosen));
        });
      };
    });
    $("#rf").onsubmit = async (e) => {
      e.preventDefault();
      const err = $("#rerr");
      err.hidden = true;
      if (!chosen) { err.textContent = "Please choose 1 to 5 stars."; err.hidden = false; return; }
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        await post("/review", { appId: id, rating: chosen, text: e.target.text.value.trim() });
        toast("Thanks! Your review is posted.", "ok");
        await Promise.all([loadReviews(), refreshApp()]);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = own ? "Update review" : "Post review";
      }
    };
  }

  function drawList() {
    const box = $("#rlist");
    if (!box) return;
    if (!reviews.length) {
      render(box, html`<p class="muted">No reviews yet.</p>`);
      return;
    }
    const shown = reviews.filter((r) => r.text || (user && r.id === user.uid));
    render(box, html`<div class="reviews">${shown.length ? shown.map((r) => reviewItem(r, user && r.id === user.uid)) : html`<p class="muted">No written reviews yet.</p>`}</div>`);
    const del = $("[data-delrev]", box);
    if (del) {
      del.onclick = async () => {
        if (!confirm("Delete your review?")) return;
        try {
          await post("/review/delete", { appId: id });
          chosen = 0;
          toast("Review deleted.");
          await Promise.all([loadReviews(), refreshApp()]);
        } catch (ex) {
          toast(ex.message, "err");
        }
      };
    }
  }

  async function loadReviews() {
    try {
      const snap = await getDocs(query(collection(db, "apps", id, "reviews"), orderBy("updatedAt", "desc"), limit(40)));
      reviews = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(e);
      reviews = [];
    }
    if (!alive) return;
    drawForm();
    drawList();
  }
  loadReviews();

  return () => { alive = false; };
}
