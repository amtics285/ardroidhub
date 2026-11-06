// Minimal SMTP client (implicit TLS, AUTH LOGIN) for Cloudflare Workers.
// `connect` is the `connect` function from "cloudflare:sockets" (passed in so tests can fake it).

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(str) {
  return btoa(String.fromCharCode(...enc.encode(str)));
}

function b64Lines(str) {
  const raw = btoa(String.fromCharCode(...enc.encode(str)));
  return raw.replace(/(.{76})/g, '$1\r\n');
}

const noCrlf = (s) => !/[\r\n\0]/.test(s);

export function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = 'b_' + crypto.randomUUID().replace(/-/g, '');
  const head = [
    `From: =?UTF-8?B?${b64(fromName)}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@ardroidhub>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const part = (type, body) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Lines(body)}\r\n`;
  return `${head}\r\n\r\n${part('text/plain', text)}${html ? part('text/html', html) : ''}--${boundary}--\r\n`;
}

export async function smtpSend(connect, { host, port = 465, user, pass, to, subject, text, html, fromName = 'AR DroidHub' }) {
  for (const v of [host, user, pass, to, subject, fromName]) {
    if (typeof v !== 'string' || !noCrlf(v)) throw new Error('bad mail field');
  }
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buf = '';

  async function readReply() {
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          buf = lines.slice(i + 1).join('\r\n');
          return Number(lines[i].slice(0, 3));
        }
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SMTP timeout')), 15000)),
      ]);
      if (chunk.done) throw new Error('SMTP connection closed');
      buf += dec.decode(chunk.value, { stream: true });
    }
  }
  async function cmd(line, ok) {
    await writer.write(enc.encode(line + '\r\n'));
    const code = await readReply();
    if (!ok.includes(code)) throw new Error('SMTP error ' + code);
  }

  try {
    if ((await readReply()) !== 220) throw new Error('SMTP greeting failed');
    await cmd('EHLO ardroidhub.workers.dev', [250]);
    await cmd('AUTH LOGIN', [334]);
    await cmd(b64(user), [334]);
    await cmd(b64(pass), [235]);
    await cmd(`MAIL FROM:<${user}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    await writer.write(enc.encode(buildMessage({ from: user, fromName, to, subject, text, html }) + '\r\n.\r\n'));
    if ((await readReply()) !== 250) throw new Error('SMTP message rejected');
    try { await cmd('QUIT', [221]); } catch { /* already done */ }
  } finally {
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { await socket.close(); } catch { /* ignore */ }
  }
}
