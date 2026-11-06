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

export async function sendCode() {
  const res = await post("/email/send");
  markSent();
  return res;
}

export const verifyCode = (code) => post("/email/verify", { code });
