import { auth, onAuthStateChanged, signOut } from "./fb.js";
import { $, html, render, toast } from "./ui.js";
import { renderHome } from "./pages/home.js";
import { renderApp } from "./pages/app.js";
import { renderLogin, renderRegister, renderReset } from "./pages/auth.js";
import { renderDashboard } from "./pages/dashboard.js";
import { renderUpload } from "./pages/upload.js";
import { renderTerms } from "./pages/terms.js";
import { renderVerify } from "./pages/verify.js";

const view = $("#view");
let cleanup = null; // unsubscribe function of the current page
let authReady = false;

function setNav(user) {
  const nav = $("#nav");
  if (user) {
    render(nav, html`
      <a class="btn small" href="#/upload">+ Publish app</a>
      <a class="navlink" href="#/dashboard">My apps</a>
      <button class="navlink linklike" id="logoutBtn" type="button">Log out</button>`);
    $("#logoutBtn").onclick = async () => {
      await signOut(auth);
      location.hash = "#/";
      toast("Logged out");
    };
  } else {
    render(nav, html`
      <a class="navlink" href="#/login">Log in</a>
      <a class="btn small" href="#/register">Developer sign up</a>`);
  }
}

const routes = [
  [/^#?\/?$/, renderHome],
  [/^#\/app\/([A-Za-z0-9]+)$/, renderApp],
  [/^#\/login$/, renderLogin],
  [/^#\/register$/, renderRegister],
  [/^#\/reset$/, renderReset],
  [/^#\/dashboard$/, renderDashboard],
  [/^#\/upload(?:\/([A-Za-z0-9]+))?$/, renderUpload],
  [/^#\/verify$/, renderVerify],
  [/^#\/terms$/, renderTerms],
];

async function route() {
  if (!authReady) return;
  if (typeof cleanup === "function") {
    cleanup();
    cleanup = null;
  }
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

onAuthStateChanged(auth, (user) => {
  setNav(user);
  const first = !authReady;
  authReady = true;
  route();
  if (first) window.addEventListener("hashchange", route);
});
