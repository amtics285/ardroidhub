import { auth, onAuthStateChanged, signOut } from "./fb.js";
import { $, html, render, toast } from "./ui.js";
import { me, loadMe, initial } from "./state.js";
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
  if (open) drawer.querySelector("a,button")?.focus();
}

function drawerContent(user) {
  const links = html`
    <div class="drawer-sep"></div>
    <a class="drawer-link" href="#/about">About us</a>
    <a class="drawer-link" href="#/privacy">Privacy policy</a>
    <a class="drawer-link" href="#/support">Support</a>
    <a class="drawer-link" href="#/company">Our company</a>
    <a class="drawer-link" href="#/terms">Developer policy</a>`;
  if (!user) {
    return html`
      <div class="drawer-head"><b>Welcome</b><span class="muted small">Log in to manage your account</span></div>
      <a class="drawer-link" href="#/">Home</a>
      <a class="drawer-link" href="#/login">Log in</a>
      <a class="drawer-link" href="#/register">Create account</a>
      <a class="drawer-link strong" href="#/become-developer">Become a developer</a>
      ${links}`;
  }
  return html`
    <div class="drawer-head">
      <div class="avatar" aria-hidden="true">${initial(user)}</div>
      <div class="drawer-who"><b>${user.displayName || "Your account"}</b><span class="muted small">${user.email}</span></div>
    </div>
    <a class="drawer-link" href="#/">Home</a>
    <a class="drawer-link" href="#/account">Account</a>
    <a class="drawer-link" href="#/profile">Edit profile</a>
    ${me.dev
      ? html`<a class="drawer-link strong" href="#/upload">Publish an app</a>
             <a class="drawer-link" href="#/dashboard">My apps</a>`
      : html`<a class="drawer-link strong" href="#/become-developer">Become a developer</a>`}
    ${links}
    <div class="drawer-sep"></div>
    <button class="drawer-link linklike" id="logoutBtn" type="button">Log out</button>`;
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
