import { auth, db, collection, query, where, onSnapshot, doc, deleteDoc } from "../fb.js";
import { html, render, $, $$, badge, STATUS, toast, phases } from "../ui.js";
import { me } from "../state.js";

function reportList(a) {
  const items = a.report || [];
  if (!items.length) return "";
  const icon = { pass: "✓", warn: "!", fail: "✗" };
  return html`
    <details class="report">
      <summary>Review report</summary>
      <ul>${items.map((r) => html`<li class="${r.status}"><b>${icon[r.status] || "•"} ${r.check}</b> <span>${r.detail}</span></li>`)}</ul>
    </details>`;
}

function row(a) {
  const st = STATUS[a.status] || {};
  const editable = a.status === "draft" || a.status === "rejected";
  return html`
    <div class="card pad app-row" data-id="${a.id}">
      <div class="app-row-main">
        ${a.iconUrl ? html`<img class="icon" src="${a.iconUrl}" alt="" width="56" height="56">` : html`<div class="icon placeholder"></div>`}
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
      ${["pending", "checking", "approved", "rejected"].includes(a.status) ? phases(a) : ""}
      ${reportList(a)}
    </div>`;
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
    <h1>My apps</h1>
    ${banner}
    <p><a class="btn" href="#/upload">+ Publish a new app</a></p>
    <div id="list"><div class="muted">Loading…</div></div>`);

  if (!user.emailVerified) {
    $("#recheck").onclick = async () => {
      await user.reload();
      await user.getIdToken(true);
      location.reload();
    };
  }

  const q = query(collection(db, "apps"), where("ownerUid", "==", user.uid));
  return onSnapshot(
    q,
    (snap) => {
      const apps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      apps.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      const list = $("#list");
      if (!list) return;
      render(list, apps.length
        ? html`${apps.map(row)}`
        : html`<div class="empty"><p>You have not created any apps yet.</p></div>`);
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
