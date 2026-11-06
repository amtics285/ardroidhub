// Admin panel API. Protected by one secret key (ADMIN_KEY) sent in the X-Admin-Key header.
import { smtpSend } from './smtp.js';
import { adminCommit, adminListApps, adminListIds, lookupEmail, fsDocName } from './gauth.js';

export class AdminError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mailFor(kind, appName, reason, who) {
  const hello = who ? `Hi ${who.replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 40).trim()},` : 'Hi,';
  const title = kind === 'delete' ? 'Your app was deleted' : 'Your app was removed from the store';
  const line = kind === 'delete'
    ? `Your app "${appName}" has been deleted from AR DroidHub. Its files were removed and it can no longer be downloaded.`
    : `Your app "${appName}" has been removed from the AR DroidHub store and can no longer be downloaded.`;
  const why = reason ? `Reason: ${reason}` : '';
  const text = `${hello}\n\n${line}\n${why ? '\n' + why + '\n' : ''}\nIf you think this is a mistake, please contact us through the Support page on the website.\n\nAR DroidHub\n`;
  const html = '<div style="background:#f6f8f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2328">'
    + '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e1e5e9;border-radius:14px;overflow:hidden">'
    + `<div style="background:#c5221f;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${title}</div>`
    + `<div style="padding:24px"><p style="margin:0 0 14px">${esc(hello)}</p><p style="margin:0 0 14px">${esc(line)}</p>`
    + (why ? `<p style="margin:0 0 14px;padding:12px;background:#fce8e6;border-radius:8px"><b>Reason:</b> ${esc(reason)}</p>` : '')
    + '<p style="margin:0;color:#5f6872;font-size:14px">If you think this is a mistake, please contact us through the Support page on the website.</p>'
    + '</div></div></div>';
  return { subject: `${title}: ${appName}`, text, html };
}

async function sendMail(env, owner, kind, appName, reason) {
  if (!owner || !env.SMTP_USER || !env.SMTP_PASS) return false;
  try {
    const { connect } = await import('cloudflare:sockets');
    const m = mailFor(kind, appName, reason, owner.name);
    await smtpSend(connect, {
      host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 465),
      user: env.SMTP_USER, pass: env.SMTP_PASS, to: owner.email, ...m,
    });
    return true;
  } catch (e) {
    console.error('admin mail failed', e && e.message);
    return false;
  }
}

async function ghDeleteReleases(env, gh, appId) {
  let removed = 0;
  for (let page = 1; page <= 5; page++) {
    const r = await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/releases?per_page=100&page=${page}`);
    if (!r.ok) throw new AdminError(502, 'Could not read the GitHub releases');
    const list = await r.json();
    for (const rel of list) {
      const mine = rel.tag_name.startsWith(`app-${appId}-v`) || rel.tag_name === `pending-${appId}` || rel.name === `pending-${appId}`;
      if (!mine) continue;
      await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/releases/${rel.id}`, { method: 'DELETE' });
      if (!rel.draft) await gh(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/git/refs/tags/${encodeURIComponent(rel.tag_name)}`, { method: 'DELETE' });
      removed++;
    }
    if (list.length < 100) break;
  }
  return removed;
}

export async function handleAdmin(request, env, path, gh) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 16) throw new AdminError(503, 'Admin panel is not set up yet (ADMIN_KEY secret is missing).');
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new AdminError(503, 'FIREBASE_SERVICE_ACCOUNT secret is missing.');
  if (!sameKey(request.headers.get('X-Admin-Key') || '', env.ADMIN_KEY)) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    throw new AdminError(401, 'Wrong admin key.');
  }
  let body = {};
  try { body = await request.json(); } catch { /* list needs no body */ }

  if (path === '/admin/apps') return { apps: await adminListApps(env) };

  const appId = String(body.appId || '');
  if (!/^[A-Za-z0-9]{6,40}$/.test(appId)) throw new AdminError(400, 'Bad app id');
  const reason = String(body.reason || '').trim().slice(0, 300);
  const apps = await adminListApps(env);
  const app = apps.find((a) => a.id === appId);
  if (!app) throw new AdminError(404, 'App not found');
  const name = app.name || 'your app';
  const owner = app.ownerUid ? await lookupEmail(env, app.ownerUid).catch(() => null) : null;

  if (path === '/admin/remove') {
    await adminCommit(env, [{
      update: { name: fsDocName(env, `apps/${appId}`), fields: { status: { stringValue: 'removed' }, reason: { stringValue: reason || 'Removed by the AR DroidHub team' } } },
      updateMask: { fieldPaths: ['status', 'reason'] },
    }]);
    return { ok: true, mailSent: await sendMail(env, owner, 'remove', name, reason) };
  }

  if (path === '/admin/restore') {
    await adminCommit(env, [{
      update: { name: fsDocName(env, `apps/${appId}`), fields: { status: { stringValue: 'approved' } } },
      updateMask: { fieldPaths: ['status'] },
    }, ]);
    return { ok: true };
  }

  if (path === '/admin/delete') {
    const files = await ghDeleteReleases(env, gh, appId);
    const reviews = await adminListIds(env, `apps/${appId}/reviews`);
    await adminCommit(env, [...reviews.map((n) => ({ delete: n })), { delete: fsDocName(env, `apps/${appId}`) }]);
    return { ok: true, releasesDeleted: files, mailSent: await sendMail(env, owner, 'delete', name, reason) };
  }

  throw new AdminError(404, 'Not found');
}
