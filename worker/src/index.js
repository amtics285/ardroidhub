// AR DroidHub upload proxy.
// Verifies the Firebase login token, then stores files in a *draft* GitHub release
// (drafts are invisible to the public) and queues the review bot.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const APP_ID_RE = /^[A-Za-z0-9]{10,40}$/;
const MB = 1024 * 1024;
const KINDS = {
  icon: { types: ['image/png', 'image/jpeg'], max: 2 * MB },
  apk: { types: null, max: 95 * MB }, // Cloudflare free plan body limit is 100 MB
};
for (let i = 1; i <= 8; i++) KINDS['ss' + i] = { types: ['image/png', 'image/jpeg'], max: 8 * MB };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      if (!originAllowed(request.headers.get('Origin'), env)) throw new HttpError(403, 'Origin not allowed');

      switch (url.pathname) {
        case '/init':
          return json(await handleInit(request, env, url), 200, cors);
        case '/upload':
          return json(await handleUpload(request, env, url), 200, cors);
        case '/submit':
          return json(await handleSubmit(request, env, url), 200, cors);
        default:
          throw new HttpError(404, 'Not found');
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error('Unhandled error', err && err.stack ? err.stack : err);
      return json({ error: 'Server error' }, 500, cors);
    }
  },
};

/* ---------- handlers ---------- */

async function handleInit(request, env, url) {
  const auth = await authenticate(request, env);
  const appId = getAppId(url);
  const app = await loadOwnedApp(env, appId, auth);
  if (app.status !== 'draft') throw new HttpError(409, 'This app can not be edited right now');
  const rel = await findOrCreateDraft(env, appId);
  return { ok: true, files: (rel.assets || []).map((a) => a.name) };
}

async function handleUpload(request, env, url) {
  const auth = await authenticate(request, env);
  const appId = getAppId(url);
  const kind = url.searchParams.get('kind') || '';
  const spec = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!spec) throw new HttpError(400, 'Unknown file kind');

  const app = await loadOwnedApp(env, appId, auth);
  if (app.status !== 'draft') throw new HttpError(409, 'This app can not be edited right now');

  const len = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, 'Content-Length required');
  if (len > spec.max) throw new HttpError(413, `File too large (max ${Math.floor(spec.max / MB)} MB)`);

  let contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  let fileName;
  if (kind === 'apk') {
    fileName = 'app.apk';
    contentType = 'application/vnd.android.package-archive';
  } else {
    if (!spec.types.includes(contentType)) throw new HttpError(415, 'Only PNG or JPG images are allowed');
    fileName = `${kind}.${EXT[contentType]}`;
  }
  if (!request.body) throw new HttpError(400, 'Empty body');

  const rel = await findOrCreateDraft(env, appId);

  // Replace any earlier upload of the same slot (e.g. icon.png -> icon.jpg).
  for (const a of rel.assets || []) {
    const same = kind === 'apk' ? a.name === 'app.apk' : a.name.startsWith(kind + '.');
    if (same) await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/releases/assets/${a.id}`, { method: 'DELETE' });
  }

  const up = await fetch(
    `https://uploads.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      headers: ghHeaders(env, { 'Content-Type': contentType, 'Content-Length': String(len) }),
      body: request.body,
    }
  );
  if (!up.ok) {
    console.error('GitHub upload failed', up.status, await up.text());
    throw new HttpError(502, 'Storage upload failed, please try again');
  }
  return { ok: true, name: fileName };
}

async function handleSubmit(request, env, url) {
  const auth = await authenticate(request, env);
  const appId = getAppId(url);
  const app = await loadOwnedApp(env, appId, auth);
  if (app.status !== 'draft' && app.status !== 'pending') {
    throw new HttpError(409, 'This app was already reviewed');
  }

  const rel = await findDraft(env, appId);
  if (!rel) throw new HttpError(400, 'Upload your files first');
  const names = (rel.assets || []).filter((a) => a.state === 'uploaded').map((a) => a.name);
  const hasIcon = names.some((n) => /^icon\.(png|jpg)$/.test(n));
  const shots = names.filter((n) => /^ss[1-8]\.(png|jpg)$/.test(n)).length;
  const hasApk = names.includes('app.apk');
  if (!hasIcon) throw new HttpError(400, 'App icon is missing');
  if (shots < 2) throw new HttpError(400, 'At least 2 screenshots are required');
  if (!hasApk) throw new HttpError(400, 'APK file is missing');

  if (app.status === 'draft') await setStatus(env, appId, auth.token, 'pending');

  const r = await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/review.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { app_id: appId, action: 'review' } }),
  });
  if (!r.ok) {
    console.error('Dispatch failed', r.status, await r.text());
    throw new HttpError(502, 'Could not start the review. Press Submit again.');
  }
  return { ok: true };
}

/* ---------- auth ---------- */

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, exp: 0 };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodePart(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function getKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.exp) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new HttpError(502, 'Auth service unavailable');
  const data = await r.json();
  const m = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
  jwksCache = { keys: data.keys, exp: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  return jwksCache.keys;
}

async function verifyIdToken(token, projectId) {
  const bad = () => new HttpError(401, 'Please log in again');
  const parts = token.split('.');
  if (parts.length !== 3) throw bad();
  let header, payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw bad();
  }
  if (header.alg !== 'RS256' || !header.kid) throw bad();
  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw bad();
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw bad();
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw bad();
  if (payload.aud !== projectId) throw bad();
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw bad();
  if (!payload.sub || typeof payload.sub !== 'string') throw bad();
  return payload;
}

async function authenticate(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Please log in first');
  const payload = await verifyIdToken(m[1], env.FIREBASE_PROJECT_ID);
  if (payload.email_verified !== true) throw new HttpError(403, 'Please verify your email first');
  return { uid: payload.sub, token: m[1] };
}

/* ---------- Firestore (as the user, so security rules apply) ---------- */

function fsBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function loadOwnedApp(env, appId, auth) {
  const r = await fetch(`${fsBase(env)}/apps/${appId}`, {
    headers: { Authorization: 'Bearer ' + auth.token },
  });
  if (r.status === 404 || r.status === 403) throw new HttpError(404, 'App not found');
  if (!r.ok) throw new HttpError(502, 'Database error');
  const fields = (await r.json()).fields || {};
  if (!fields.ownerUid || fields.ownerUid.stringValue !== auth.uid) throw new HttpError(403, 'This is not your app');
  return { status: fields.status ? fields.status.stringValue : '' };
}

async function setStatus(env, appId, token, status) {
  const r = await fetch(
    `${fsBase(env)}/apps/${appId}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt`,
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          status: { stringValue: status },
          updatedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );
  if (!r.ok) {
    console.error('setStatus failed', r.status, await r.text());
    throw new HttpError(502, 'Could not update the app status');
  }
}

/* ---------- GitHub ---------- */

function ghHeaders(env, extra = {}) {
  return {
    Authorization: 'Bearer ' + env.GH_PAT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ardroidhub-worker',
    ...extra,
  };
}
function gh(env, path, init = {}) {
  const extra = init.body && !init.headers ? { 'Content-Type': 'application/json' } : {};
  return fetch('https://api.github.com' + path, { ...init, headers: ghHeaders(env, { ...extra, ...(init.headers || {}) }) });
}

async function findDraft(env, appId) {
  const name = 'pending-' + appId;
  for (let page = 1; page <= 5; page++) {
    const r = await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/releases?per_page=100&page=${page}`);
    if (!r.ok) throw new HttpError(502, 'Storage error');
    const list = await r.json();
    const hit = list.find((x) => x.draft && x.name === name);
    if (hit) return hit;
    if (list.length < 100) break;
  }
  return null;
}

async function findOrCreateDraft(env, appId) {
  const existing = await findDraft(env, appId);
  if (existing) return existing;
  const r = await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: 'pending-' + appId,
      name: 'pending-' + appId,
      body: 'Pending review',
      draft: true,
      prerelease: false,
      target_commitish: 'main',
    }),
  });
  if (!r.ok) {
    console.error('create draft failed', r.status, await r.text());
    throw new HttpError(502, 'Could not prepare storage');
  }
  return r.json();
}

/* ---------- helpers ---------- */

function getAppId(url) {
  const appId = url.searchParams.get('appId') || '';
  if (!APP_ID_RE.test(appId)) throw new HttpError(400, 'Bad app id');
  return appId;
}

function originAllowed(origin, env) {
  if (!origin) return false;
  if (origin === env.ALLOWED_ORIGIN) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (originAllowed(origin, env)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
