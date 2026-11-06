import { auth } from "./fb.js";
import { WORKER_URL } from "./config.js";

// POST JSON to the Worker. With { login: true } the person's sign-in token is sent along.
export async function post(path, body, { login = true } = {}) {
  if (WORKER_URL.includes("__WORKER_URL__")) throw new Error("The server is not connected yet.");
  const headers = { "Content-Type": "application/json" };
  if (login) headers.Authorization = "Bearer " + (await auth.currentUser.getIdToken());
  let r;
  try {
    r = await fetch(WORKER_URL + path, { method: "POST", headers, body: JSON.stringify(body || {}) });
  } catch {
    throw new Error("Network problem. Please try again.");
  }
  let data = {};
  try {
    data = await r.json();
  } catch { /* ignore */ }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// Count a download: once per app per browser per 12 hours, and never in the way of the download itself.
export function countDownload(appId) {
  const key = "ardh_dl_" + appId;
  try {
    if (Date.now() - Number(localStorage.getItem(key) || 0) < 12 * 3600 * 1000) return;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* private mode: count anyway */ }
  if (WORKER_URL.includes("__WORKER_URL__")) return;
  fetch(WORKER_URL + "/download", {
    method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId }),
  }).catch(() => {});
}
