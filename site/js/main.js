import { auth, onAuthStateChanged, signOut } from "./fb.js";
import { $, html, render, toast } from "./ui.js";
import { me, loadMe, initial } from "./state.js";
import { icon } from "./icons.js";
import { renderHome } from "./pages/home.js";
import { renderApp } from "./pages/app.js";
import { renderLogin, renderRegister, renderReset } from "./pages/auth.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderUpload } from "./pages/upload.js";
import { renderTerms } from "./pages/terms.js";
import { renderVerify } from "./pages/verify.js";
import { renderAccount, renderProfile, renderBecomeDeveloper } from "./pages/account.js";
import { renderAbout, renderCompany, renderSupport, renderPrivacy } from "./pages/info.js";

const view = $("#view");
const drawer = $("#drawer");
const scrim = $("#scrim");
const menuBtn = $("#menuBtn");
let cleanup = null; // unsubscribe function of the current page
let authReady = false;

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
      <div class="avatar" aria-hidden="true">${initial(user)}</div>
      <div class="drawer-who"><b>${user.displayName || "Your account"}</b><span class="muted small">${user.email}</span></div>
    </div>
    ${item("#/", "home", "Home")}
    ${item("#/account", "user", "Account")}
    ${item("#/profile", "edit", "Edit profile")}
    ${me.dev
      ? html`${item("#/upload", "upload", "Publish an app", "strong")}${item("#/dashboard", "grid", "My apps")}`
      : item("#/become-developer", "code", "Become a developer", "strong")}
    ${links}
    <div class="drawer-sep"></div>
    <button class="drawer-link linklike" id="logoutBtn" type="button">${icon("logout")}<span>Log out</span></button>`;
}

function setNav(user) {
  render($("#nav"), user
    ? html`<a class="avatar" href="#/account" title="Your account" aria-label="Your account">${initial(user)}</a>`
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

const routes = [
  [/^#?\/?$/, renderHome],
  [/^#\/app\/([A-Za-z0-9]+)$/, renderApp],
  [/^#\/login$/, renderLogin],
  [/^#\/register$/, renderRegister],
  [/^#\/reset$/, renderReset],
  [/^#\/account$/, renderAccount],
  [/^#\/profile$/, renderProfile],
  [/^#\/become-developer$/, renderBecomeDeveloper],
  [/^#\/dashboard$/, renderDashboard],
  [/^#\/upload(?:\/([A-Za-z0-9]+))?$/, renderUpload],
  [/^#\/verify$/, renderVerify],
  [/^#\/terms$/, renderTerms],
  [/^#\/about$/, renderAbout],
  [/^#\/privacy$/, renderPrivacy],
  [/^#\/support$/, renderSupport],
  [/^#\/company$/, renderCompany],
];

async function route() {
  if (!authReady) return;
  if (typeof cleanup === "function") {
    cleanup();
    cleanup = null;
  }
  openMenu(false);
  const path = location.hash.split("?")[0] || "#/";
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (m) {
      window.scrollTo(0, 0);
      try {
        cleanup = (await fn(view, m.slice(1), auth.currentUser)) || null;
      } catch (e) {
        console.error(e);
        render(view, html`<div class="empty"><h2>Something went wrong</h2><p>${e.message || "Please try again."}</p></div>`);
      }
      return;
    }
  }
  render(view, html`<div class="empty"><h2>Page not found</h2><p><a href="#/">Go to the store</a></p></div>`);
}

$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#searchInput").value.trim();
  location.hash = q ? `#/?q=${encodeURIComponent(q)}` : "#/";
});

onAuthStateChanged(auth, async (user) => {
  await loadMe(user);
  setNav(user);
  const first = !authReady;
  authReady = true;
  route();
  if (first) window.addEventListener("hashchange", route);
});
