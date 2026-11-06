import { auth, db, collection, query, where, onSnapshot, doc, deleteDoc, getDocs, orderBy, limit } from "../fb.js";
import { html, render, $, $$, badge, STATUS, toast, phases, fmtNum, fmtDate, stars, avgRating } from "../ui.js";
import { me } from "../state.js";
import { icon } from "../icons.js";

function reportList(a) {
  const items = a.report || [];
  if (!items.length) return "";
  const mark = { pass: "✓", warn: "!", fail: "✗" };
  return html`
    <details class="report">
      <summary>Review report</summary>
      <ul>${items.map((r) => html`<li class="${r.status}"><b>${mark[r.status] || "•"} ${r.check}</b> <span>${r.detail}</span></li>`)}</ul>
    </details>`;
}

function metrics(a) {
  if (a.status !== "approved") return "";
  const avg = avgRating(a);
  return html`
    <div class="metrics">
      <div class="metric">${icon("download", 18)}<b>${fmtNum(a.downloads || 0)}</b><span>downloads</span></div>
      <div class="metric">${icon("star", 18)}<b>${a.ratingCount ? avg.toFixed(1) : "–"}</b><span>${a.ratingCount ? `from ${fmtNum(a.ratingCount)} rating${a.ratingCount === 1 ? "" : "s"}` : "no ratings yet"}</span></div>
      <div class="metric">${icon("edit", 18)}<b>${fmtNum(a.reviewCount || 0)}</b><span>review${a.reviewCount === 1 ? "" : "s"}</span></div>
    </div>
    ${a.ratingCount ? html`<details class="report" data-rev="${a.id}"><summary>Read reviews</summary><div class="rev-body muted small">Loading…</div></details>` : ""}`;
}

function row(a) {
  const st = STATUS[a.status] || {};
  const editable = a.status === "draft" || a.status === "rejected";
  return html`
    <div class="card pad app-row" data-id="${a.id}">
      <div class="app-row-main">
        ${a.iconUrl || a.iconThumb ? html`<img class="icon" src="${a.iconUrl || a.iconThumb}" alt="" width="56" height="56">` : html`<div class="icon placeholder"></div>`}
        <div class="grow">
          <div class="app-name">${a.name || "(no name)"} ${badge(a.status)}</div>
          <div class="muted small">${st.help || ""}</div>
          ${a.status === "rejected" && a.reason ? html`<div class="error small">${a.reason}</div>` : ""}
          ${a.botError ? html`<div class="muted small">A temporary delay happened. Your app is still in the queue.</div>` : ""}
        </div>
        <div class="actions">
          ${a.status === "approved" ? html`<a class="btn small ghost" href="#/app/${a.id}">View</a>` : ""}
          ${editable ? html`<a class="btn small" href="#/upload/${a.id}">${a.status === "rejected" ? "Fix & resubmit" : "Continue"}</a>` : ""}
          ${editable ? html`<button class="btn small ghost danger" data-del="${a.id}" type="button">Delete</button>` : ""}
        </div>
      </div>
      ${metrics(a)}
      ${["pending", "checking", "approved", "rejected"].includes(a.status) ? phases(a) : ""}
      ${reportList(a)}
    </div>`;
}

function kpis(apps) {
  const live = apps.filter((a) => a.status === "approved");
  const downloads = live.reduce((n, a) => n + (a.downloads || 0), 0);
  const ratings = live.reduce((n, a) => n + (a.ratingCount || 0), 0);
  const sum = live.reduce((n, a) => n + (a.ratingSum || 0), 0);
  const reviews = live.reduce((n, a) => n + (a.reviewCount || 0), 0);
  const avg = ratings ? sum / ratings : 0;
  const card = (ico, value, label, extra = "") => html`
    <div class="card kpi"><div class="kpi-ico">${icon(ico, 22)}</div><div><div class="kpi-val">${value}</div><div class="muted small">${label}</div>${extra}</div></div>`;
  return html`
    ${card("download", fmtNum(downloads), "Total downloads")}
    ${card("star", ratings ? avg.toFixed(1) : "–", ratings ? `Average rating (${fmtNum(ratings)})` : "Average rating", ratings ? stars(avg) : "")}
    ${card("edit", fmtNum(reviews), "Reviews")}
    ${card("grid", `${live.length} / ${apps.length}`, "Apps published")}`;
}

export function renderDashboard(el, _p, user) {
  if (!user) {
    location.hash = "#/login";
    return;
  }
  if (!me.dev) {
    location.hash = "#/become-developer";
    return;
  }

  const banner = user.emailVerified
    ? ""
    : html`<div class="notice">
        Please verify your email (<b>${user.email}</b>) before publishing apps.
        <a class="btn small" href="#/verify">Enter email code</a>
        <button class="btn small ghost" id="recheck" type="button">I already verified</button>
      </div>`;

  render(el, html`
    <div class="page-head">
      <div>
        <h1>Developer dashboard</h1>
        <p class="muted">Welcome, ${me.dev.name}. Here is how your apps are doing.</p>
      </div>
      <a class="btn" href="#/upload">+ New app</a>
    </div>
    ${banner}
    <div class="kpis" id="kpis"></div>
    <h2 class="section-title">Your apps</h2>
    <div id="list"><div class="muted">Loading…</div></div>`);

  if (!user.emailVerified) {
    $("#recheck").onclick = async () => {
      await user.reload();
      await user.getIdToken(true);
      location.reload();
    };
  }

  const openRev = new Set(); // reviews panels the developer has open (kept across live updates)
  const revCache = {};

  async function fillReviews(box, id) {
    const body = $(".rev-body", box);
    if (revCache[id]) body.innerHTML = revCache[id];
    try {
      const snap = await getDocs(query(collection(db, "apps", id, "reviews"), orderBy("updatedAt", "desc"), limit(50)));
      const items = snap.docs.map((d) => d.data());
      const out = items.length
        ? html`<div class="reviews">${items.map((r) => html`
            <article class="review"><div class="grow">
              <div class="review-head"><b>${r.userName || "User"}</b> <span class="muted small">${fmtDate(r.updatedAt)}</span></div>
              <div>${stars(r.rating)}</div>
              ${r.text ? html`<p class="pre review-text">${r.text}</p>` : ""}
            </div></article>`)}</div>`
        : html`<p class="muted">No reviews yet.</p>`;
      revCache[id] = out.__raw;
      body.innerHTML = out.__raw;
    } catch (e) {
      console.error(e);
      body.textContent = "Could not load reviews.";
    }
  }

  const q = query(collection(db, "apps"), where("ownerUid", "==", user.uid));
  return onSnapshot(
    q,
    (snap) => {
      const apps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      apps.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      const list = $("#list");
      if (!list) return;
      render($("#kpis"), kpis(apps));
      render(list, apps.length
        ? html`${apps.map(row)}`
        : html`<div class="card pad empty">
            <h2>Publish your first app</h2>
            <p class="muted">Your downloads, ratings and reviews will show up here once an app is live.</p>
            <p><a class="btn big" href="#/upload">+ New app</a></p>
          </div>`);
      $$("details[data-rev]", list).forEach((d) => {
        const id = d.dataset.rev;
        if (openRev.has(id)) { d.open = true; fillReviews(d, id); }
        d.addEventListener("toggle", () => {
          if (d.open) { openRev.add(id); fillReviews(d, id); } else openRev.delete(id);
        });
      });
      $$("[data-del]", list).forEach((b) => {
        b.onclick = async () => {
          if (!confirm("Delete this app? This can not be undone.")) return;
          try {
            await deleteDoc(doc(db, "apps", b.dataset.del));
            toast("App deleted.");
          } catch {
            toast("Could not delete this app.", "err");
          }
        };
      });
    },
    (err) => {
      console.error(err);
      const list = $("#list");
      if (list) render(list, html`<div class="error">Could not load your apps. Please refresh.</div>`);
    }
  );
}
