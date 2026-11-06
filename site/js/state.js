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

// First letter of the person's name, or "" (then the pages show a person icon instead of a digit).
export function initial(user) {
  const first = [...String((user && user.displayName) || (user && user.email) || "").trim()][0] || "";
  return /^\p{L}$/u.test(first) ? first.toUpperCase() : "";
}

