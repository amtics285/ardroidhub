// node tests/ui_test.mjs  - escaping + import/export consistency of the site modules
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { html, raw, esc, safeUrl, fmtSize, permName } from "../site/js/ui.js";

const evil = `<img src=x onerror=alert(1)>"'&`;
assert.equal(html`<p>${evil}</p>`.__raw, "<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>");
assert.equal(html`<ul>${["<a>", "b"].map((x) => html`<li>${x}</li>`)}</ul>`.__raw, "<ul><li>&lt;a&gt;</li><li>b</li></ul>");
assert.equal(html`${raw("<b>ok</b>")}`.__raw, "<b>ok</b>");
assert.equal(html`${null}${undefined}${0}`.__raw, "0");
assert.equal(safeUrl("javascript:alert(1)"), "");
assert.equal(safeUrl("data:text/html,x"), "");
assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
assert.equal(fmtSize(5 * 1024 * 1024), "5.0 MB");
assert.equal(permName("android.permission.READ_SMS"), "read sms");

// every named import from ./ui.js, ./config.js must exist
const root = "site/js";
const exportsOf = {};
for (const f of ["ui.js", "config.js"]) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  exportsOf[f] = new Set([...src.matchAll(/export (?:async )?(?:function|const|let) ([\w$]+)/g)].map((m) => m[1]));
}
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") && files.push(path.join(d, e.name)); })(root);
// names the Firebase SDK really exports (modular v10)
const FIREBASE = new Set(`auth db app onAuthStateChanged signOut createUserWithEmailAndPassword signInWithEmailAndPassword updateProfile sendPasswordResetEmail doc setDoc serverTimestamp collection query where getDocs limit getDoc addDoc updateDoc deleteField deleteDoc onSnapshot increment`.split(" "));
let checked = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const target = m[2];
    for (const n of names) {
      checked++;
      if (/\/fb\.js$/.test(target)) assert.ok(FIREBASE.has(n), `${f}: unknown firebase name ${n}`);
      else if (target.startsWith(".")) {
        const dest = path.join(path.dirname(f), target);
        const src2 = fs.readFileSync(dest, "utf8");
        const esc = n.replace(/\$/g, "\\$");
        const ok = new RegExp(`export (?:async )?(?:function|const|let) ${esc}(?![\\w$])`).test(src2);
        assert.ok(ok, `${f}: ${dest} has no export ${n}`);
      }
    }
  }
}
console.log(`ui tests passed (${checked} imports checked across ${files.length} files)`);
