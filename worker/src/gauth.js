// Google service-account access for the Worker: marks an email as verified immediately
// (instead of waiting for a GitHub Actions run).

const enc = new TextEncoder();
let cached = { token: '', exp: 0 };

const b64u = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function accessToken(sa) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const pem = String(sa.private_key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${body}.${b64u(sig)}`,
    }),
  });
  if (!r.ok) throw new Error('token request failed ' + r.status);
  const data = await r.json();
  cached = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function adminToken(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('no service account');
  return accessToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT));
}

const fsRoot = (env) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
export const fsDocName = (env, path) => `${fsRoot(env)}/${path}`;

// Read one document as the service account. Returns its fields, or null if it does not exist.
export async function adminGet(env, path) {
  const token = await adminToken(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/${fsDocName(env, path)}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('firestore get failed ' + r.status);
  return (await r.json()).fields || {};
}

// Several writes in ONE atomic commit (so counters and reviews can never disagree).
export async function adminCommit(env, writes) {
  const token = await adminToken(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/${fsRoot(env)}:commit`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  if (!r.ok) throw new Error('firestore commit failed ' + r.status);
}

export async function setEmailVerified(env, uid) {
  const token = await adminToken(env);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!r.ok) throw new Error('accounts:update failed ' + r.status);
}

// ---------- admin helpers (used by the admin panel) ----------

const fval = (f) => {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('timestampValue' in f) return f.timestampValue;
  return undefined;
};
export const plainDoc = (d) => {
  const o = { id: d.name.split('/').pop() };
  for (const [k, v] of Object.entries(d.fields || {})) {
    const x = fval(v);
    if (x !== undefined) o[k] = x;
  }
  return o;
};

export async function adminListApps(env) {
  const token = await adminToken(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'apps' }], limit: 500 } }),
  });
  if (!r.ok) throw new Error('list apps failed ' + r.status);
  return (await r.json()).filter((x) => x.document).map((x) => plainDoc(x.document));
}

export async function adminListIds(env, path) {
  const token = await adminToken(env);
  const r = await fetch(`https://firestore.googleapis.com/v1/${fsDocName(env, path)}?pageSize=300&mask.fieldPaths=rating`, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return [];
  return ((await r.json()).documents || []).map((d) => d.name);
}

export async function lookupEmail(env, uid) {
  const token = await adminToken(env);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!r.ok) throw new Error('lookup failed ' + r.status);
  const u = ((await r.json()).users || [])[0];
  return u && u.email ? { email: u.email, name: u.displayName || '' } : null;
}
