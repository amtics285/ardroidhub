import { auth } from "./fb.js";
import { WORKER_URL } from "./config.js";

async function post(path, body) {
  if (WORKER_URL.includes("__WORKER_URL__")) throw new Error("The email service is not connected yet.");
  const token = await auth.currentUser.getIdToken();
  let r;
  try {
    r = await fetch(WORKER_URL + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
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

// Remember (per browser tab) when the last code was requested, so the page can show a countdown.
const KEY = "ardh_code_sent_at";
export const lastSentAt = () => Number(sessionStorage.getItem(KEY) || 0);
const markSent = () => sessionStorage.setItem(KEY, String(Date.now()));

// The request that is currently sending a code (if any), so the verify page can show "Sending...".
let pending = null;
export const pendingSend = () => pending;

export function sendCode() {
  markSent(); // start the 60 s countdown right away
  const p = post("/email/send")
    .catch((e) => {
      sessionStorage.removeItem(KEY);
      throw e;
    })
    .finally(() => {
      if (pending === p) pending = null;
    });
  pending = p;
  return p;
}

export const verifyCode = (code) => post("/email/verify", { code });
