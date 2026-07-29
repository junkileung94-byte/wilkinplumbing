'use strict';
/* A very small SMTP client — enough to email Roy when a booking request arrives.
 *
 * This app has no dependencies and this file keeps it that way: the whole feature is
 * one plaintext message to one mailbox, which is a few hundred lines of socket work
 * rather than a package tree. It speaks EHLO → (STARTTLS) → AUTH → MAIL → RCPT → DATA
 * and nothing else. No attachments, no queue — but it does send multipart/alternative,
 * because the appointment confirmation is a branded HTML email with a plain-text twin.
 *
 * It is deliberately fail-soft. Email is a courtesy on top of the admin inbox, so a
 * dead mail server must never cost the customer their booking: every failure resolves
 * to {sent:false, ...} and is reported in the admin, never thrown into the request.
 *
 * Configure in the Hostinger environment:
 *   SMTP_HOST      smtp.example.com          (unset = feature off)
 *   SMTP_PORT      587 (STARTTLS) | 465 (implicit TLS) | 25
 *   SMTP_USER      login, if the server wants one
 *   SMTP_PASS      password
 *   SMTP_FROM      "Wilkin Plumbing <site@wilkinplumbing.ca>"  (defaults to SMTP_USER)
 *   SMTP_SECURE    1 to force implicit TLS regardless of port
 */

const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

const TIMEOUT_MS = 15000;

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v);
}

function config() {
  const host = env('SMTP_HOST').trim();
  const port = Number(env('SMTP_PORT', '587')) || 587;
  return {
    host,
    port,
    user: env('SMTP_USER').trim(),
    pass: env('SMTP_PASS'),
    from: env('SMTP_FROM').trim() || env('SMTP_USER').trim(),
    secure: env('SMTP_SECURE') === '1' || port === 465,
    rejectUnauthorized: env('SMTP_TLS_INSECURE') !== '1',
  };
}

function enabled() {
  const c = config();
  return !!(c.host && c.from);
}

/** What the admin shows about mail setup, without ever exposing the password. */
function status() {
  const c = config();
  if (!c.host) return { configured: false, reason: 'SMTP_HOST is not set' };
  if (!c.from) return { configured: false, reason: 'SMTP_FROM (or SMTP_USER) is not set' };
  return {
    configured: true,
    host: c.host,
    port: c.port,
    secure: c.secure,
    from: c.from,
    auth: c.user ? 'password' : 'none',
  };
}

// ------------------------------------------------------------------ headers ---
/* RFC 2047 for anything outside ASCII, so an accented street name in a subject line
 * doesn't arrive as mojibake. */
function encodeHeader(value) {
  const s = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?utf-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/* Header injection guard: an address is only ever a single clean line.
 *
 * The angle brackets are load-bearing, so they are rebuilt here rather than stripped:
 * `Wilkin Plumbing <info@…>` is a valid RFC 5322 mailbox and `Wilkin Plumbing info@…`
 * is not. Lenient receivers accept the second form, strict ones score it as forged —
 * which is the kind of difference that decides whether Outlook shows a message at all.
 */
function formatAddress(value) {
  const s = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, 320);
  if (!s) return '';

  const m = /^(.*?)\s*<([^<>]*)>\s*$/.exec(s);
  const addr = (m ? m[2] : s).replace(/[<>\s]+/g, '');
  let name = m ? m[1].trim() : '';
  if (name.length > 1 && name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
  if (!name) return `<${addr}>`;

  // A display name is either an encoded-word or a quoted string, never both: quoting an
  // encoded-word stops it being decoded, so only the plain-ASCII branch gets quotes.
  const encoded = encodeHeader(name);
  const needsQuote = encoded === name && /[()<>@,;:\\".[\]]/.test(name);
  const display = needsQuote ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encoded;
  return `${display} <${addr}>`;
}

function addressOnly(value) {
  const cleaned = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
  const m = /<([^>]+)>/.exec(cleaned);
  return (m ? m[1] : cleaned).replace(/[<>\s]+/g, '').trim().slice(0, 320);
}

/* Base64 in 76-column lines, as RFC 2045 wants. Also the reason nothing here needs SMTP
 * dot-stuffing: the base64 alphabet cannot produce a line starting with a period. */
function b64(value) {
  return Buffer.from(String(value == null ? '' : value).replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function buildMessage({ from, to, subject, text, html, replyTo }) {
  const headers = [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@wilkinplumbing.ca>`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) headers.push(`Reply-To: ${formatAddress(replyTo)}`);

  if (!html) {
    headers.push(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      'Auto-Submitted: auto-generated',
    );
    return `${headers.join('\r\n')}\r\n\r\n${b64(text)}\r\n`;
  }

  /* multipart/alternative, plain part first — that is the order the spec asks for, and
   * it means a client that will not render HTML still shows the whole message rather
   * than an empty body. `text` is therefore never optional when `html` is given. */
  const boundary = `=_wp_${crypto.randomBytes(12).toString('hex')}`;
  headers.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'Auto-Submitted: auto-generated',
  );
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n`;
}

// -------------------------------------------------------------- conversation ---
/** Wraps a socket in a promise-per-command SMTP dialogue. */
function dialogue(socket) {
  let buffer = '';
  let waiting = null;
  let closed = null;

  function flush() {
    if (!waiting) return;
    // A reply ends on a line shaped "250 text". "250-text" means more is coming, so
    // an EHLO's capability list arrives as one reply rather than several.
    const lines = buffer.split('\r\n').filter((l) => l.length);
    const last = lines[lines.length - 1];
    if (!last || !/^\d{3}(?: |$)/.test(last)) return;
    const reply = { code: Number(last.slice(0, 3)), text: lines.join('\n') };
    buffer = '';
    const w = waiting;
    waiting = null;
    w.resolve(reply);
  }

  socket.on('data', (chunk) => { buffer += chunk.toString('utf8'); flush(); });
  socket.on('close', () => {
    closed = closed || new Error('The mail server closed the connection.');
    if (waiting) { const w = waiting; waiting = null; w.reject(closed); }
  });
  socket.on('error', (err) => {
    closed = err;
    if (waiting) { const w = waiting; waiting = null; w.reject(err); }
  });

  function expect() {
    if (closed) return Promise.reject(closed);
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      flush();
    });
  }

  function send(line) {
    socket.write(`${line}\r\n`);
    return expect();
  }

  return { expect, send, socket };
}

function ok(reply, allowed, what) {
  if (!allowed.includes(reply.code)) {
    const first = String(reply.text).split('\n')[0];
    throw new Error(`${what} failed: ${first}`);
  }
  return reply;
}

function connect(c) {
  return new Promise((resolve, reject) => {
    const opts = { host: c.host, port: c.port };
    const socket = c.secure
      ? tls.connect({ ...opts, servername: c.host, rejectUnauthorized: c.rejectUnauthorized }, () => resolve(socket))
      : net.connect(opts, () => resolve(socket));
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy(new Error('The mail server did not respond in time.'));
    });
    socket.once('error', reject);
  });
}

function upgrade(socket, c) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect(
      { socket, servername: c.host, rejectUnauthorized: c.rejectUnauthorized },
      () => resolve(secure),
    );
    secure.setTimeout(TIMEOUT_MS, () => {
      secure.destroy(new Error('The mail server did not respond in time.'));
    });
    secure.once('error', reject);
  });
}

async function authenticate(chat, c, greeting) {
  if (!c.user) return;
  const offered = String(greeting.text).toUpperCase();
  if (offered.includes('AUTH') && offered.includes('PLAIN')) {
    const token = Buffer.from(`\0${c.user}\0${c.pass}`, 'utf8').toString('base64');
    ok(await chat.send(`AUTH PLAIN ${token}`), [235], 'Sign-in');
    return;
  }
  ok(await chat.send('AUTH LOGIN'), [334], 'Sign-in');
  ok(await chat.send(Buffer.from(c.user, 'utf8').toString('base64')), [334], 'Sign-in');
  ok(await chat.send(Buffer.from(c.pass, 'utf8').toString('base64')), [235], 'Sign-in');
}

/**
 * Deliver one message. Resolves {sent:true} or {sent:false, reason, error} — it never
 * rejects, so callers can await it without a try/catch around the request path.
 */
async function send({ to, subject, text, html, replyTo }) {
  const c = config();
  if (!c.host) return { sent: false, reason: 'not-configured' };
  const rcpt = addressOnly(to);
  if (!rcpt || !rcpt.includes('@')) return { sent: false, reason: 'no-recipient' };
  if (!c.from) return { sent: false, reason: 'not-configured' };

  let socket;
  try {
    socket = await connect(c);
    let chat = dialogue(socket);
    ok(await chat.expect(), [220], 'Connection');

    let greeting = ok(await chat.send('EHLO wilkinplumbing.ca'), [250], 'EHLO');

    if (!c.secure && String(greeting.text).toUpperCase().includes('STARTTLS')) {
      ok(await chat.send('STARTTLS'), [220], 'STARTTLS');
      const secure = await upgrade(socket, c);
      socket = secure;
      chat = dialogue(secure);
      greeting = ok(await chat.send('EHLO wilkinplumbing.ca'), [250], 'EHLO');
    }

    await authenticate(chat, c, greeting);

    ok(await chat.send(`MAIL FROM:<${addressOnly(c.from)}>`), [250], 'MAIL FROM');
    ok(await chat.send(`RCPT TO:<${rcpt}>`), [250, 251], 'RCPT TO');
    ok(await chat.send('DATA'), [354], 'DATA');

    const message = buildMessage({ from: c.from, to: rcpt, subject, text, html, replyTo });
    socket.write(message);
    ok(await chat.send('.'), [250], 'Delivery');

    try { await chat.send('QUIT'); } catch (err) { /* server may just hang up */ }
    socket.end();
    return { sent: true };
  } catch (err) {
    if (socket) socket.destroy();
    return { sent: false, reason: 'error', error: err.message };
  }
}

module.exports = { enabled, status, send, buildMessage, encodeHeader, config };
