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

/* ---------- fast path: direct verify + SMTP (faked) ---------- */
import { generateKeyPairSync } from "node:crypto";
import { smtpSend, buildMessage } from "../worker/src/smtp.js";
const { privateKey: saKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "sa@test.iam.gserviceaccount.com", private_key: saKey });
let updates = [], failUpdate = false;
const baseFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
  if (url.includes("identitytoolkit.googleapis.com")) {
    if (failUpdate) return new Response("{}", { status: 500 });
    updates.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  }
  return baseFetch(url, init);
};
await test("email/verify: right code marks the account verified RIGHT AWAY (no workflow)", async () => {
  reset();
  await sendCodeReq();
  const code = await issuedCode();
  dispatches.length = 0; updates = [];
  const r = await verifyReq(code);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.done, true);
  assert.equal(dispatches.length, 0);
  assert.deepEqual(updates[0].body, { localId: "user1", emailVerified: true });
  assert.equal(updates[0].auth, "Bearer tok");
});
await test("email/verify: if the direct update fails, the workflow is the fallback", async () => {
  reset();
  await sendCodeReq();
  const code = await issuedCode();
  dispatches.length = 0; failUpdate = true;
  const r = await verifyReq(code);
  failUpdate = false;
  assert.equal(r.status, 200);
  assert.deepEqual(dispatches.at(-1), { wf: "verify-email.yml", ref: "main", inputs: { uid: "user1" } });
});

// A tiny fake SMTP server behind the `connect` function.
function fakeSmtp({ rejectAuth = false } = {}) {
  const seen = [];
  const enc = new TextEncoder();
  let push;
  const readable = new ReadableStream({ start(c) { push = (s) => c.enqueue(enc.encode(s)); push("220 smtp.test ready\r\n"); } });
  let inData = false, dataBuf = "", stage = 0;
  const writable = new WritableStream({
    write(chunk) {
      const t = new TextDecoder().decode(chunk);
      if (inData) {
        dataBuf += t;
        if (dataBuf.endsWith("\r\n.\r\n")) { inData = false; seen.push({ data: dataBuf }); push("250 queued\r\n"); }
        return;
      }
      const line = t.replace(/\r\n$/, "");
      seen.push(line);
      if (line.startsWith("EHLO")) push("250-smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
      else if (line === "AUTH LOGIN") { stage = 1; push("334 VXNlcm5hbWU6\r\n"); }
      else if (stage === 1) { stage = 2; push("334 UGFzc3dvcmQ6\r\n"); }
      else if (stage === 2) { stage = 3; push(rejectAuth ? "535 bad credentials\r\n" : "235 ok\r\n"); }
      else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) push("250 ok\r\n");
      else if (line === "DATA") { inData = true; push("354 go\r\n"); }
      else if (line === "QUIT") push("221 bye\r\n");
    },
  });
  return { seen, connect: () => ({ readable, writable, close: async () => {} }) };
}
await test("smtp: sends a multipart mail after a normal AUTH LOGIN dialogue", async () => {
  const f = fakeSmtp();
  await smtpSend(f.connect, { host: "smtp.test", port: 465, user: "bot@x.test", pass: "pw", to: "dev@x.test", subject: "123456 is your code", text: "plain 123456", html: "<b>123456</b>" });
  assert.ok(f.seen.includes("MAIL FROM:<bot@x.test>") && f.seen.includes("RCPT TO:<dev@x.test>"));
  const msg = f.seen.find((x) => x.data).data;
  assert.match(msg, /multipart\/alternative/);
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  const b64 = msg.split("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
  assert.equal(Buffer.from(b64, "base64").toString(), "plain 123456");
});
await test("smtp: wrong credentials -> error, no mail sent; header injection refused", async () => {
  const f = fakeSmtp({ rejectAuth: true });
  await assert.rejects(smtpSend(f.connect, { host: "smtp.test", user: "bot@x.test", pass: "bad", to: "dev@x.test", subject: "s", text: "t" }), /535/);
  assert.ok(!f.seen.some((x) => x.data));
  await assert.rejects(smtpSend(fakeSmtp().connect, { host: "smtp.test", user: "bot@x.test", pass: "pw", to: "dev@x.test\r\nBcc: evil@x.test", subject: "s", text: "t" }), /bad mail field/);
});
await test("email/send: SMTP configured but unavailable here -> falls back to the workflow", async () => {
  reset();
  env.SMTP_USER = "bot@x.test"; env.SMTP_PASS = "pw";
  const r = await sendCodeReq();
  delete env.SMTP_USER; delete env.SMTP_PASS;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.via, "workflow");
  assert.equal(dispatches.at(-1).wf, "send-code.yml");
});

/* ---------- downloads and reviews ---------- */
import fs from "node:fs";
import { BLOCKED_WORDS } from "../worker/src/words.js";

await test("review word list covers every blocked word of the bot policy", async () => {
  const py = fs.readFileSync("bot/policy.py", "utf8");
  const block = py.slice(py.indexOf("BLOCKED_WORDS = ("), py.indexOf("# Piracy"));
  const words = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(words.length > 20);
  for (const w of words) assert.ok(BLOCKED_WORDS.includes(w), "missing in worker/src/words.js: " + w);
});

// fake Firestore documents for the admin (service account) calls
let store, commits;
const resetStore = () => {
  store = { "apps/APPX": { status: { stringValue: "approved" }, ownerUid: { stringValue: "owner9" } } };
  commits = [];
};
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const m = /\/documents\/(apps\/[^?:]+)$/.exec(url);
  if (m && (init.method || "GET") === "GET" && url.includes("firestore.googleapis.com")) {
    const f = store[decodeURIComponent(m[1])];
    return new Response(JSON.stringify(f ? { fields: f } : {}), { status: f ? 200 : 404 });
  }
  if (url.endsWith("/documents:commit")) {
    const { writes } = JSON.parse(init.body);
    commits.push(writes);
    for (const w of writes) {
      if (w.update) store[w.update.name.split("/documents/")[1]] = { ...(store[w.update.name.split("/documents/")[1]] || {}), ...w.update.fields };
      if (w.delete) delete store[w.delete.split("/documents/")[1]];
    }
    return new Response("{}", { status: 200 });
  }
  return prevFetch(url, init);
};
const ID = "APPX".padEnd(12, "x");           // valid 10+ char id
const idPath = (id) => `apps/${id}`;
const addApp = (id, over = {}) => { store[idPath(id)] = { status: { stringValue: "approved" }, ownerUid: { stringValue: "owner9" }, ...over }; };
const post = (path, token, body) => call(path, { token, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const incs = (writes) => Object.fromEntries(writes.flatMap((w) => w.transform ? w.transform.fieldTransforms.map((t) => [t.fieldPath, Number(t.increment.integerValue)]) : []));

await test("download: counts once, needs no login, only approved apps", async () => {
  resetStore(); addApp(ID); addApp("DRAFTAPP12345", { status: { stringValue: "draft" } });
  const r = await post("/download", null, { appId: ID });
  assert.equal(r.status, 200); assert.equal(r.json.counted, true);
  assert.deepEqual(incs(commits[0]), { downloads: 1 });
  assert.equal((await post("/download", null, { appId: ID })).json.counted, false); // 30 s throttle
  assert.equal((await post("/download", null, { appId: "DRAFTAPP12345" })).status, 404);
  assert.equal((await post("/download", null, { appId: "nope" })).status, 400);
  assert.equal((await post("/download", null, { appId: "zzzzzzzzzzzzzzzz" })).status, 404);
});

await test("review: new review writes the review and updates the counters in ONE commit", async () => {
  resetStore(); addApp(ID);
  const t = await makeToken({ sub: "rev1", name: "Asha <b>K</b>" });
  const r = await post("/review", t, { appId: ID, rating: 4, text: "  Very useful app  " });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(commits.length, 1);
  const up = commits[0].find((w) => w.update).update;
  assert.ok(up.name.endsWith(`/apps/${ID}/reviews/rev1`));
  assert.equal(up.fields.rating.integerValue, "4");
  assert.equal(up.fields.text.stringValue, "Very useful app");
  assert.equal(up.fields.userName.stringValue, "Asha bKb");   // tags stripped
  assert.ok(up.fields.createdAt);
  assert.deepEqual(incs(commits[0]), { ratingSum: 4, ratingCount: 1, reviewCount: 1 });
});

await test("review: editing changes only the difference, rating-only review has no text count", async () => {
  resetStore(); addApp(ID);
  const t = await makeToken({ sub: "rev1", name: "Asha" });
  await post("/review", t, { appId: ID, rating: 2, text: "meh" });
  commits.length = 0;
  await post("/review", t, { appId: ID, rating: 5, text: "" });
  const up = commits[0].find((w) => w.update);
  assert.ok(!up.update.fields.createdAt && !up.updateMask.fieldPaths.includes("createdAt"));
  assert.deepEqual(incs(commits[0]), { ratingSum: 3, reviewCount: -1 }); // count unchanged, text removed
});

await test("review: delete takes the review and its numbers away", async () => {
  resetStore(); addApp(ID);
  const t = await makeToken({ sub: "rev1", name: "Asha" });
  await post("/review", t, { appId: ID, rating: 3, text: "ok app" });
  commits.length = 0;
  assert.equal((await post("/review/delete", t, { appId: ID })).status, 200);
  assert.ok(commits[0].some((w) => w.delete));
  assert.deepEqual(incs(commits[0]), { ratingSum: -3, ratingCount: -1, reviewCount: -1 });
  commits.length = 0;
  assert.equal((await post("/review/delete", t, { appId: ID })).status, 200); // nothing left: no-op
  assert.equal(commits.length, 0);
});

await test("review: rules - login, verified email, valid stars, length, words, not your own app", async () => {
  resetStore(); addApp(ID);
  assert.equal((await post("/review", null, { appId: ID, rating: 5 })).status, 401);
  const unv = await makeToken({ sub: "rev2", email_verified: false });
  assert.equal((await post("/review", unv, { appId: ID, rating: 5 })).status, 403);
  const t = await makeToken({ sub: "rev3", name: "Ravi" });
  for (const rating of [0, 6, 2.5, "x", null]) assert.equal((await post("/review", t, { appId: ID, rating })).status, 400, String(rating));
  assert.equal((await post("/review", t, { appId: ID, rating: 5, text: "a".repeat(501) })).status, 400);
  const bad = await post("/review", t, { appId: ID, rating: 1, text: "you people are Chutiya" });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /respectful/);
  assert.equal((await post("/review", await makeToken({ sub: "owner9" }), { appId: ID, rating: 5 })).status, 403);
  addApp("DRAFTAPP12345", { status: { stringValue: "draft" } });
  assert.equal((await post("/review", t, { appId: "DRAFTAPP12345", rating: 5 })).status, 404);
  assert.equal(commits.length, 0, "nothing may be written for rejected reviews");
});

await test("admin: needs the secret key, never opens without it", async () => {
  const call = (key, path = "/admin/apps") => worker.fetch(new Request("https://w.example" + path, { method: "POST", headers: { "X-Admin-Key": key, "Content-Type": "application/json" }, body: "{}" }), e2);
  const e2 = { ...env, FIREBASE_SERVICE_ACCOUNT: "{}" };
  let r = await worker.fetch(new Request("https://w.example/admin/apps", { method: "POST", body: "{}" }), { ...env }); // no ADMIN_KEY set
  assert.equal(r.status, 503);
  e2.ADMIN_KEY = "k".repeat(32);
  assert.equal((await call("wrong-key-wrong-key-wrong-key-00")).status, 401);
  assert.equal((await call("")).status, 401);
  r = await worker.fetch(new Request("https://w.example/admin/apps", { method: "OPTIONS" }), e2);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Headers").includes("X-Admin-Key"), true);
});

globalThis.fetch = prevFetch;

console.log(`\n${passed} worker tests passed`);
