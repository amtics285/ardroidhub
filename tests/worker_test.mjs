// Runs the Worker against fake Google / Firestore / GitHub servers:  node tests/worker_test.mjs
import worker from "../worker/src/index.js";
import assert from "node:assert/strict";

const PROJECT = "test-project";
const MAIL_KEY = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
const env = {
  FIREBASE_PROJECT_ID: PROJECT, GH_OWNER: "o", GH_REPO: "r", GH_PAT: "pat",
  ALLOWED_ORIGIN: "https://site.example", MAIL_KEY, CODE_SECRET: "test-code-secret",
};
const ORIGIN = "https://site.example";
const APP = "aB3dE5gH7jK9mN1pQ3rS";

/* ---- token factory ---- */
const kp = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function makeToken(over = {}, kid = "k1") {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: "user1", iat: now - 5,
    exp: now + 3600, email_verified: true, ...over };
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

/* ---- fake backends ---- */
let appDoc, draftAssets, log, priv, dispatches;
function reset() {
  appDoc = { ownerUid: "user1", status: "draft" };
  priv = { codesSent: 0, verifyTries: 0, lastCodeAt: 0 }; // developersPrivate/user1
  draftAssets = [];
  dispatches = [];
  log = [];
}
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const method = init.method || "GET";
  const respond = (code, body) => new Response(body === undefined ? null : JSON.stringify(body), { status: code });
  if (url.includes("googleapis.com/service_accounts")) return respond(200, { keys: [jwk] });
  if (url.includes("firestore.googleapis.com") && url.includes("/developersPrivate/")) {
    log.push(`${method} firestore-private`);
    if (!priv) return respond(404, {});
    if (method === "GET") {
      const f = { codesSent: { integerValue: String(priv.codesSent) }, verifyTries: { integerValue: String(priv.verifyTries) } };
      if (priv.lastCodeAt) f.lastCodeAt = { timestampValue: new Date(priv.lastCodeAt).toISOString() };
      return respond(200, { fields: f });
    }
    // PATCH: behave like the security rules (+1 steps only, 60 s cooldown, caps)
    const f = JSON.parse(init.body).fields;
    if (f.codesSent) {
      const n = Number(f.codesSent.integerValue);
      const at = Date.parse(f.lastCodeAt.timestampValue);
      if (n !== priv.codesSent + 1 || n > 20 || Date.now() < priv.lastCodeAt + 60000 || Math.abs(Date.now() - at) > 30000) return respond(403, {});
      priv.codesSent = n; priv.lastCodeAt = at;
    } else if (f.verifyTries) {
      const n = Number(f.verifyTries.integerValue);
      if (n !== priv.verifyTries + 1 || n > 30) return respond(403, {});
      priv.verifyTries = n;
    } else return respond(403, {});
    return respond(200, {});
  }
  if (url.includes("firestore.googleapis.com")) {
    log.push(`${method} firestore`);
    if (!appDoc) return respond(404, {});
    if (method === "PATCH") { appDoc.status = JSON.parse(init.body).fields.status.stringValue; return respond(200, {}); }
    return respond(200, { fields: { ownerUid: { stringValue: appDoc.ownerUid }, status: { stringValue: appDoc.status } } });
  }
  if (url.startsWith("https://uploads.github.com")) {
    const name = new URL(url).searchParams.get("name");
    log.push(`UPLOAD ${name} ct=${init.headers["Content-Type"]} len=${init.headers["Content-Length"]}`);
    if (init.body) { const r = init.body.getReader ? init.body.getReader() : null; if (r) while (!(await r.read()).done); }
    draftAssets.push({ id: draftAssets.length + 100, name, state: "uploaded" });
    return respond(201, { name });
  }
  if (url.startsWith("https://api.github.com")) {
    const path = url.replace("https://api.github.com", "");
    log.push(`${method} ${path.split("?")[0]}`);
    if (method === "GET" && path.startsWith("/repos/o/r/releases?")) {
      return respond(200, [{ id: 7, draft: true, name: "pending-" + APP, assets: draftAssets }]);
    }
    if (method === "DELETE") { draftAssets = draftAssets.filter((a) => !path.endsWith("/" + a.id)); return respond(204); }
    if (path.endsWith("/dispatches")) {
      const wf = path.split("/workflows/")[1].split("/")[0];
      dispatches.push({ wf, ...JSON.parse(init.body) });
      log.push("DISPATCH " + wf);
      return respond(204);
    }
  }
  return respond(500, { error: "unexpected " + method + " " + url });
};

const call = async (path, { method = "POST", token, headers = {}, body, origin = ORIGIN } = {}) => {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (token) h.Authorization = "Bearer " + token;
  const res = await worker.fetch(new Request("https://w.example" + path, { method, headers: h, body }), env);
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, headers: res.headers };
};
const bytes = (n) => new Uint8Array(n).fill(1);
let passed = 0;
const test = async (name, fn) => { reset(); await fn(); passed++; console.log("ok -", name); };

await test("health + CORS preflight", async () => {
  assert.equal((await call("/health", { method: "GET" })).status, 200);
  const pre = await call("/upload", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});
await test("evil origin is blocked and gets no CORS header", async () => {
  const r = await call(`/init?appId=${APP}`, { token: await makeToken(), origin: "https://evil.example" });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});
await test("no token -> 401", async () => assert.equal((await call(`/init?appId=${APP}`)).status, 401));
await test("garbage token -> 401", async () => assert.equal((await call(`/init?appId=${APP}`, { token: "a.b.c" })).status, 401));
await test("token signed by another key -> 401", async () => {
  const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
  const t = await makeToken();
  const [h, p] = t.split(".");
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", other.privateKey, new TextEncoder().encode(`${h}.${p}`));
  assert.equal((await call(`/init?appId=${APP}`, { token: `${h}.${p}.${b64u(sig)}` })).status, 401);
});
await test("expired / wrong audience / wrong issuer / unknown kid -> 401", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const over of [{ exp: now - 10 }, { aud: "other" }, { iss: "https://evil" }]) {
    assert.equal((await call(`/init?appId=${APP}`, { token: await makeToken(over) })).status, 401, JSON.stringify(over));
  }
  assert.equal((await call(`/init?appId=${APP}`, { token: await makeToken({}, "nokid") })).status, 401);
});
await test("unverified email -> 403", async () => {
  assert.equal((await call(`/init?appId=${APP}`, { token: await makeToken({ email_verified: false }) })).status, 403);
});
await test("bad app id -> 400", async () => {
  assert.equal((await call(`/init?appId=../x`, { token: await makeToken() })).status, 400);
});
await test("someone else's app -> 403", async () => {
  appDoc.ownerUid = "someone";
  assert.equal((await call(`/init?appId=${APP}`, { token: await makeToken() })).status, 403);
});
await test("missing app -> 404", async () => {
  appDoc = null;
  assert.equal((await call(`/init?appId=${APP}`, { token: await makeToken() })).status, 404);
});
await test("upload icon ok, name derived from content-type, not from the client", async () => {
  const r = await call(`/upload?appId=${APP}&kind=icon`, { token: await makeToken(), headers: { "Content-Type": "image/png", "Content-Length": "1000" }, body: bytes(1000) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.name, "icon.png");
  assert.ok(log.some((l) => l.startsWith("UPLOAD icon.png ct=image/png len=1000")));
});
await test("upload replaces older file of the same slot", async () => {
  draftAssets.push({ id: 5, name: "icon.jpg", state: "uploaded" });
  await call(`/upload?appId=${APP}&kind=icon`, { token: await makeToken(), headers: { "Content-Type": "image/png", "Content-Length": "10" }, body: bytes(10) });
  assert.ok(log.includes("DELETE /repos/o/r/releases/assets/5"));
  assert.deepEqual(draftAssets.map((a) => a.name), ["icon.png"]);
});
await test("upload apk always stored as app.apk", async () => {
  const r = await call(`/upload?appId=${APP}&kind=apk`, { token: await makeToken(), headers: { "Content-Type": "text/evil", "Content-Length": "500" }, body: bytes(500) });
  assert.equal(r.json.name, "app.apk");
});
await test("rejects path-like kinds, bad types and oversize files", async () => {
  const t = await makeToken();
  assert.equal((await call(`/upload?appId=${APP}&kind=../../x`, { token: t, headers: { "Content-Type": "image/png", "Content-Length": "10" }, body: bytes(10) })).status, 400);
  assert.equal((await call(`/upload?appId=${APP}&kind=__proto__`, { token: t, headers: { "Content-Type": "image/png", "Content-Length": "10" }, body: bytes(10) })).status, 400);
  assert.equal((await call(`/upload?appId=${APP}&kind=icon`, { token: t, headers: { "Content-Type": "image/svg+xml", "Content-Length": "10" }, body: bytes(10) })).status, 415);
  assert.equal((await call(`/upload?appId=${APP}&kind=icon`, { token: t, headers: { "Content-Type": "image/png", "Content-Length": String(3 * 1024 * 1024) }, body: bytes(10) })).status, 413);
  assert.equal((await call(`/upload?appId=${APP}&kind=ss9`, { token: t, headers: { "Content-Type": "image/png", "Content-Length": "10" }, body: bytes(10) })).status, 400);
});
await test("cannot upload once the app is no longer a draft", async () => {
  appDoc.status = "approved";
  assert.equal((await call(`/upload?appId=${APP}&kind=icon`, { token: await makeToken(), headers: { "Content-Type": "image/png", "Content-Length": "10" }, body: bytes(10) })).status, 409);
});
await test("submit needs icon, 2 screenshots and apk", async () => {
  const t = await makeToken();
  draftAssets.push({ id: 1, name: "icon.png", state: "uploaded" }, { id: 2, name: "ss1.png", state: "uploaded" });
  let r = await call(`/submit?appId=${APP}`, { token: t });
  assert.equal(r.status, 400); assert.match(r.json.error, /2 screenshots/);
  draftAssets.push({ id: 3, name: "ss2.png", state: "uploaded" });
  r = await call(`/submit?appId=${APP}`, { token: t });
  assert.equal(r.status, 400); assert.match(r.json.error, /APK/);
  assert.equal(appDoc.status, "draft");
});
await test("submit ok -> status pending + workflow dispatched with the app id", async () => {
  draftAssets.push(...["icon.png", "ss1.png", "ss2.jpg", "app.apk"].map((name, i) => ({ id: i + 1, name, state: "uploaded" })));
  const r = await call(`/submit?appId=${APP}`, { token: await makeToken() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(appDoc.status, "pending");
  assert.deepEqual(dispatches, [{ wf: "review.yml", ref: "main", inputs: { app_id: APP, action: "review" } }]);
});
await test("submit again while pending re-dispatches but does not touch Firestore status", async () => {
  appDoc.status = "pending";
  draftAssets.push(...["icon.png", "ss1.png", "ss2.jpg", "app.apk"].map((name, i) => ({ id: i + 1, name, state: "uploaded" })));
  const r = await call(`/submit?appId=${APP}`, { token: await makeToken() });
  assert.equal(r.status, 200);
  assert.ok(!log.includes("PATCH firestore"));
});
await test("half-uploaded asset (state != uploaded) does not count", async () => {
  draftAssets.push(...["icon.png", "ss1.png", "ss2.jpg"].map((name, i) => ({ id: i + 1, name, state: "uploaded" })), { id: 9, name: "app.apk", state: "starter" });
  assert.equal((await call(`/submit?appId=${APP}`, { token: await makeToken() })).status, 400);
});

/* ---------- email codes ---------- */
import { webcrypto } from "node:crypto";
async function decryptPayload(b64u) {
  const raw = Buffer.from(b64u, "base64url");
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(MAIL_KEY, "base64"), "AES-GCM", false, ["decrypt"]);
  const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
const unverified = () => makeToken({ email_verified: false, email: "Dev@Example.com", name: "Dev One" });
const sendCodeReq = async (t) => call("/email/send", { token: t ?? (await unverified()) });
const verifyReq = async (code, t) => call("/email/verify", { token: t ?? (await unverified()), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
const issuedCode = async () => (await decryptPayload(dispatches.at(-1).inputs.payload)).code;

await test("email/send: unverified user gets an ENCRYPTED payload, public input never shows the email or code", async () => {
  const r = await sendCodeReq();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].wf, "send-code.yml");
  const raw = JSON.stringify(dispatches[0]);
  assert.ok(!raw.includes("example.com") && !raw.toLowerCase().includes("dev one"), "plaintext leaked in dispatch");
  const data = await decryptPayload(dispatches[0].inputs.payload);
  assert.equal(data.to, "Dev@Example.com");
  assert.match(data.code, /^\d{6}$/);
  assert.equal(priv.codesSent, 1);
  if (process.env.INTEROP_OUT) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.INTEROP_OUT, JSON.stringify({ payload: dispatches[0].inputs.payload, key: MAIL_KEY, to: data.to, code: data.code }));
  }
});
await test("email/send: needs a login, bad tokens fail", async () => {
  assert.equal((await call("/email/send")).status, 401);
  assert.equal((await call("/email/send", { token: "a.b.c" })).status, 401);
});
await test("email/send: already verified -> nothing sent", async () => {
  const r = await sendCodeReq(await makeToken());
  assert.equal(r.json.already, true);
  assert.equal(dispatches.length, 0);
});
await test("email/send: 60 s cooldown and 20-code cap", async () => {
  assert.equal((await sendCodeReq()).status, 200);
  const again = await sendCodeReq();
  assert.equal(again.status, 429); assert.match(again.json.error, /wait/);
  assert.equal(dispatches.length, 1);
  priv.lastCodeAt = 0; priv.codesSent = 20;
  const capped = await sendCodeReq();
  assert.equal(capped.status, 429); assert.match(capped.json.error, /Too many/);
});
await test("email/send: if the rules deny the counter update (race), no email is sent", async () => {
  priv.lastCodeAt = Date.now() - 61000;          // Worker thinks it is fine ...
  const realPatch = globalThis.fetch;
  globalThis.fetch = async (u, i = {}) => (String(u).includes("/developersPrivate/") && i.method === "PATCH" ? new Response("{}", { status: 403 }) : realPatch(u, i));
  const r = await sendCodeReq();
  globalThis.fetch = realPatch;
  assert.equal(r.status, 429);
  assert.equal(dispatches.length, 0);
});
await test("email/send: missing developer profile -> 400", async () => {
  priv = null;
  assert.equal((await sendCodeReq()).status, 400);
});
await test("email/verify: right code -> verify-email workflow with the uid from the TOKEN", async () => {
  await sendCodeReq();
  const code = await issuedCode();
  const r = await verifyReq(code);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(dispatches.at(-1), { wf: "verify-email.yml", ref: "main", inputs: { uid: "user1" } });
});
await test("email/verify: wrong code, malformed code, wrong user", async () => {
  await sendCodeReq();
  const code = await issuedCode();
  const wrong = code === "000000" ? "000001" : "000000";
  assert.equal((await verifyReq(wrong)).status, 400);
  assert.equal((await verifyReq("12ab56")).status, 400);
  assert.equal((await verifyReq("12345")).status, 400);
  // same code, different account (other uid) must not work
  const other = await makeToken({ email_verified: false, email: "Dev@Example.com", sub: "user2" });
  priv = { codesSent: 0, verifyTries: 0, lastCodeAt: 0 };
  assert.equal((await verifyReq(code, other)).status, 400);
  // same code but the account email differs
  const other2 = await makeToken({ email_verified: false, email: "x@example.com" });
  assert.equal((await verifyReq(code, other2)).status, 400);
  assert.ok(!dispatches.some((d) => d.wf === "verify-email.yml"));
});
await test("email/verify: previous 10-minute window still works, two windows ago does not", async () => {
  await sendCodeReq();
  const realNow = Date.now;
  const code = await issuedCode();
  Date.now = () => realNow() + 600 * 1000;
  assert.equal((await verifyReq(code)).status, 200);
  Date.now = () => realNow() + 1300 * 1000;
  priv.verifyTries = 0;
  assert.equal((await verifyReq(code)).status, 400);
  Date.now = realNow;
});
await test("email/verify: guesses are counted and capped at 30", async () => {
  for (let i = 0; i < 30; i++) assert.equal((await verifyReq("000000")).status === 429 ? "capped" : "ok", "ok", "capped too early at " + i);
  assert.equal(priv.verifyTries, 30);
  const r = await verifyReq("000000");
  assert.equal(r.status, 429);
  // even the RIGHT code is refused once the cap is hit
  await (async () => { priv.lastCodeAt = 0; await sendCodeReq(); })();
  assert.equal((await verifyReq(await issuedCode())).status, 429);
});
await test("email/verify: verified user -> already", async () => {
  assert.equal((await verifyReq("123456", await makeToken())).json.already, true);
  assert.equal(dispatches.length, 0);
});
await test("email codes need server config (no secret -> 500, never a weak code)", async () => {
  const saved = env.CODE_SECRET; delete env.CODE_SECRET;
  assert.equal((await sendCodeReq()).status, 500);
  env.CODE_SECRET = saved;
  const savedKey = env.MAIL_KEY; env.MAIL_KEY = "c2hvcnQ=";
  assert.equal((await sendCodeReq()).status, 500);
  env.MAIL_KEY = savedKey;
});

console.log(`\n${passed} worker tests passed`);
