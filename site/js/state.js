// Who is signed in, and are they a developer? Filled in by main.js on every auth change.
import { db, doc, getDoc } from "./fb.js";

export const me = { user: null, dev: null };

export async function loadMe(user) {
  me.user = user;
  me.dev = null;
  if (!user) return;
  try {
    const s = await getDoc(doc(db, "developers", user.uid));
    me.dev = s.exists() ? s.data() : null;
  } catch (e) {
    console.error(e);
  }
}

export function setDev(data) {
  me.dev = data;
}

export const isDev = () => !!me.dev;

export function initial(user) {
  const n = (user && (user.displayName || user.email)) || "?";
  return n.trim().charAt(0).toUpperCase();
}

// "Where to go after verifying the email" (set when a page needs a verified account).
export function setNext(hash) {
  try { sessionStorage.setItem("next", hash); } catch { /* private mode */ }
}
export function takeNext(fallback) {
  try {
    const n = sessionStorage.getItem("next");
    sessionStorage.removeItem("next");
    if (n && /^#\/[\w/?=&%-]*$/.test(n)) return n;
  } catch { /* ignore */ }
  return fallback;
}
