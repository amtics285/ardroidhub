import { auth, onAuthStateChanged, signOut } from "./fb.js";
import { $, html, render, toast } from "./ui.js";
import { me, loadMe, initial } from "./state.js";
import { icon } from "./icons.js";
import { renderHome, prefetchApps } from "./pages/home.js";
import { renderApp } from "./pages/app.js";

// Start loading the app list right away, in parallel with the sign-in check.
prefetchApps();

const view = $("#view");
const drawer = $("#drawer");
const scrim = $("#scrim");
const menuBtn = $("#menuBtn");
let cleanup = null; // unsubscribe function of the current page
let authReady = false;
let routeToken = 0;

/* ---------- menu (hamburger drawer) ---------- */

function openMenu(open) {
  drawer.classList.toggle("open", open);
  scrim.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  drawer.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("no-scroll", open);
  if (open) {
    const here = location.hash.split("?")[0] || "#/";
    drawer.querySelectorAll("a.drawer-link").forEach((a) => {
      const on = a.getAttribute("href") === here || (here === "" && a.getAttribute("href") === "#/");
      a.classList.toggle("current", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    drawer.querySelector("a,button")?.focus();
  }
}

const item = (href, ico, label, cls = "") =>
  html`<a class="drawer-link ${cls}" href="${href}">${icon(ico)}<span>${label}</span></a>`;

function drawerContent(user) {
  const links = html`
    <div class="drawer-sep"></div>
    ${item("#/about", "info", "About us")}
    ${item("#/privacy", "shield", "Privacy policy")}
    ${item("#/support", "help", "Support")}
    ${item("#/company", "building", "Our company")}
    ${item("#/terms", "code", "Developer policy")}`;
  if (!user) {
    return html`
      <div class="drawer-head"><img class="drawer-logo" src="img/logo-64.png" alt="" width="44" height="44">
        <div class="drawer-who"><b>Welcome to AR DroidHub</b><span class="muted small">Log in to manage your account</span></div></div>
      ${item("#/", "home", "Home")}
      ${item("#/login", "login", "Log in")}
      ${item("#/register", "userplus", "Create account")}
      ${item("#/become-developer", "code", "Become a developer", "strong")}
      ${links}`;
  }
  return html`
    <div class="drawer-head">
      <div class="avatar" aria-hidden="true">${initial(user) || icon("user", 22)}</div>
      <div class="drawer-who"><b>${user.displayName || "Your account"}</b><span class="muted small">${user.email}</span></div>
    </div>
    ${item("#/", "home", "Home")}
    ${item("#/account", "user", "Account")}
    ${item("#/downloads", "grid", "My apps")}
    ${item("#/profile", "edit", "Edit profile")}
    ${me.dev
      ? html`${item("#/dashboard", "chart", "Developer dashboard", "strong")}`
      : item("#/become-developer", "code", "Become a developer", "strong")}
    ${links}
    <div class="drawer-sep"></div>
    <button class="drawer-link linklike" id="logoutBtn" type="button">${icon("logout")}<span>Log out</span></button>`;
}

function setNav(user) {
  render($("#nav"), user
    ? html`<a class="avatar" href="#/account" title="Your account" aria-label="Your account">${initial(user) || icon("user", 22)}</a>`
    : html`<a class="navlink" href="#/login">Log in</a><a class="btn small" href="#/register">Sign up</a>`);
  render(drawer, html`
    <div class="drawer-top">
      <span class="drawer-title">Menu</span>
      <button class="drawer-close" id="menuClose" type="button" aria-label="Close menu">&times;</button>
    </div>
    ${drawerContent(user)}`);
  $("#menuClose").onclick = () => openMenu(false);
  const out = $("#logoutBtn");
  if (out) {
    out.onclick = async () => {
      openMenu(false);
      await signOut(auth);
      location.hash = "#/";
      toast("Logged out");
    };
  }
}

menuBtn.onclick = () => openMenu(!drawer.classList.contains("open"));
scrim.onclick = () => openMenu(false);
drawer.addEventListener("click", (e) => {
  if (e.target.closest("a")) openMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) {
    openMenu(false);
    menuBtn.focus();
  }
});

/* ---------- routing ---------- */
// Home and app pages are loaded up front; every other page is downloaded only when it is opened.
// `needsMe` pages wait until we know whether the person is a developer.

const lazy = (file, name) => async () => (await import(file))[name];
const routes = [
  [/^#?\/?$/, async () => renderHome],
  [/^#\/app\/([A-Za-z0-9]+)$/, async () => renderApp],
  [/^#\/login$/, lazy("./pages/auth.js", "renderLogin")],
  [/^#\/register$/, lazy("./pages/auth.js", "renderRegister")],
  [/^#\/reset$/, lazy("./pages/auth.js", "renderReset")],
  [/^#\/account$/, lazy("./pages/account.js", "renderAccount"), true],
  [/^#\/profile$/, lazy("./pages/account.js", "renderProfile"), true],
  [/^#\/become-developer$/, lazy("./pages/account.js", "renderBecomeDeveloper"), true],
  [/^#\/dashboard$/, lazy("./pages/dashboard.js", "renderDashboard"), true],
  [/^#\/downloads$/, lazy("./pages/mine.js", "renderMyApps")],
  [/^#\/upload(?:\/([A-Za-z0-9]+))?$/, lazy("./pages/upload.js", "renderUpload"), true],
  [/^#\/verify$/, lazy("./pages/verify.js", "renderVerify")],
  [/^#\/terms$/, lazy("./pages/terms.js", "renderTerms")],
  [/^#\/about$/, lazy("./pages/info.js", "renderAbout")],
  [/^#\/privacy$/, lazy("./pages/info.js", "renderPrivacy")],
  [/^#\/support$/, lazy("./pages/info.js", "renderSupport")],
  [/^#\/company$/, lazy("./pages/info.js", "renderCompany")],
];

async function route() {
  if (!authReady) return;
  const mine = ++routeToken;
  if (typeof cleanup === "function") {
    cleanup();
    cleanup = null;
  }
  openMenu(false);
  const path = location.hash.split("?")[0] || "#/";
  for (const [re, load, needsMe] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    window.scrollTo(0, 0);
    try {
      const fn = await load();
      if (needsMe) await me.ready;
      if (mine !== routeToken) return; // the person already went somewhere else
      const result = (await fn(view, m.slice(1), auth.currentUser)) || null;
      if (mine !== routeToken) {
        if (typeof result === "function") result();
        return;
      }
      cleanup = result;
    } catch (e) {
      console.error(e);
      if (mine === routeToken) render(view, html`<div class="empty"><h2>Something went wrong</h2><p>${e.message || "Please try again."}</p></div>`);
    }
    return;
  }
  render(view, html`<div class="empty"><h2>Page not found</h2><p><a href="#/">Go to the store</a></p></div>`);
}

$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#searchInput").value.trim();
  location.hash = q ? `#/?q=${encodeURIComponent(q)}` : "#/";
});

onAuthStateChanged(auth, (user) => {
  // Show the page now. Whether the person is a developer is looked up in the background.
  me.user = user;
  me.dev = null;
  setNav(user);
  me.ready = loadMe(user).then(() => {
    if (auth.currentUser === user) setNav(user);
  });
  const first = !authReady;
  authReady = true;
  route();
  if (first) window.addEventListener("hashchange", route);
});

// Share button (app cards and app page): native share sheet, else copy the link.
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-share]");
  if (!b) return;
  e.preventDefault();
  const url = location.origin + location.pathname + "#/app/" + b.dataset.share;
  const name = b.dataset.name || "this app";
  try {
    if (navigator.share) { await navigator.share({ title: name, text: "Get " + name + " on AR DroidHub", url }); return; }
  } catch (err) { if (err && err.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Link copied", "ok"); }
  catch { window.prompt("Copy this link", url); }
});
