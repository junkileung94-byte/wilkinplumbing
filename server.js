'use strict';
/* Wilkin Plumbing — public site + authenticated /admin content manager.
 *
 * Serves the public site out of site/ (plus the brand/ photos it references), and an
 * admin at /admin that is reachable from the internet but locked behind a password.
 *
 * The admin exists because the site is deployed from a public GitHub repo, so:
 *   · every save is committed back to the repo (lib/github.js) — otherwise the next
 *     deploy would silently revert it
 *   · the eleven location pages are regenerated from index.html on every save
 *     (lib/locations.js) so they never drift from the main page
 *   · no credential is ever written inside the repo (lib/auth.js)
 *
 * Hostinger runs `npm start` and sets process.env.PORT.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* Must run before anything reads process.env at load time (lib/auth.js resolves its
 * state directory that way). Fills in from a .env file only if the host did not
 * already provide the variable. */
const dotenv = require('./lib/env').load();

const auth = require('./lib/auth');
const booking = require('./lib/booking');
const editor = require('./lib/editor');
const locations = require('./lib/locations');
const github = require('./lib/github');
const mailer = require('./lib/mailer');
const templates = require('./lib/mail-templates');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIR = __dirname;
const SITE = path.join(DIR, 'site');
const BRAND = path.join(DIR, 'brand');
const ADMIN_HTML = path.join(DIR, 'admin', 'app.html');
const MAX_BODY = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

// ------------------------------------------------------------------ helpers ---
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* Whether to mark the session cookie Secure. Hostinger terminates TLS in front of the
 * app, so the request itself arrives as plain http — x-forwarded-proto is the signal.
 * ADMIN_COOKIE_SECURE=1 forces it on for proxies that don't set that header. */
function isSecure(req) {
  if (process.env.ADMIN_COOKIE_SECURE === '1') return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/* Booking requests are the one write a stranger can make, so they get their own
 * limiter — same in-memory shape as the login limiter in lib/auth.js. Restarting the
 * app clears it, which is fine: this is here to stop a bored script filling Roy's
 * calendar, not to survive a reboot. */
const bookingHits = new Map();   // ip -> [timestamps]
const BOOKING_WINDOW_MS = 60 * 60 * 1000;
const BOOKING_MAX_PER_IP = 5;

function bookingRateLimited(ip) {
  const now = Date.now();
  const recent = (bookingHits.get(ip) || []).filter((t) => now - t < BOOKING_WINDOW_MS);
  if (recent.length >= BOOKING_MAX_PER_IP) {
    bookingHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  bookingHits.set(ip, recent);
  if (bookingHits.size > 5000) bookingHits.clear();   // crude, but bounded
  return false;
}

function sessionOf(req) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies.wp_admin;
  const session = auth.sessionFor(token);
  return session ? { token, session } : null;
}

/** Guard for every mutating admin route: valid session + matching CSRF token. */
function requireAuth(req, res) {
  const found = sessionOf(req);
  if (!found) {
    sendJson(res, 401, { error: 'Not signed in.' });
    return null;
  }
  if (req.method !== 'GET') {
    const sent = req.headers['x-csrf-token'];
    if (!sent || sent !== found.session.csrf) {
      sendJson(res, 403, { error: 'Session expired — reload the page and sign in again.' });
      return null;
    }
  }
  return found;
}

// -------------------------------------------------------------- static site ---
function resolveStatic(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (err) { return null; }
  if (p.indexOf('\0') !== -1) return null;
  if (p === '/' || p === '') return path.join(SITE, 'index.html');

  let base;
  let rel;
  if (p === '/brand' || p.startsWith('/brand/')) {
    base = BRAND; rel = p.slice('/brand'.length);
  } else {
    base = SITE; rel = p;
  }
  const full = path.normalize(path.join(base, rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null; // no escape
  return full;
}

function serveStatic(req, res) {
  let file = resolveStatic(req.url);
  if (!file) { res.writeHead(400); return res.end('Bad request'); }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, body) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>404</h1>');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(body);
    });
  });
}

// -------------------------------------------------------------- admin: save ---
/** Apply edits, regenerate location pages, commit everything as one commit. */
async function applyEdits({ texts, slots }) {
  const changedRepoPaths = new Set();
  const binaryRepoPaths = new Set();
  let html = editor.readIndex();
  let indexChanged = false;
  const problems = [];

  for (const item of Array.isArray(texts) ? texts : []) {
    if (!item || typeof item.id !== 'string') continue;
    const result = editor.setText(html, item.id, item.html);
    if (!result.found) {
      problems.push(`No text node named "${item.id}" — skipped.`);
      continue;
    }
    html = result.html;
    if (result.changed) indexChanged = true;
  }

  for (const item of Array.isArray(slots) ? slots : []) {
    if (!item || typeof item.slot !== 'string') continue;
    const decoded = editor.decodeDataUrl(item.dataUrl);
    if (decoded.error) { problems.push(`${item.slot}: ${decoded.error}`); continue; }
    const written = editor.writeSlotImage(item.slot, decoded.buf, decoded.ext);
    const result = editor.setSlotSrc(html, item.slot, written.src);
    if (!result.found) {
      problems.push(`No image slot named "${item.slot}" — skipped.`);
      continue;
    }
    html = result.html;
    if (result.changed) indexChanged = true;
    changedRepoPaths.add(written.repoPath);
    binaryRepoPaths.add(written.repoPath);
  }

  if (indexChanged) {
    editor.writeIndex(html);
    changedRepoPaths.add('site/index.html');
  }

  // Location pages are clones of index.html — always rebuild, never let them drift.
  for (const rel of locations.write()) changedRepoPaths.add(rel);

  return { changedRepoPaths: [...changedRepoPaths], binaryRepoPaths, problems, indexChanged };
}

async function commitChanges(changedRepoPaths, binaryRepoPaths, message) {
  const files = changedRepoPaths.map((rel) => {
    const abs = path.join(DIR, rel);
    return binaryRepoPaths.has(rel)
      ? { path: rel, content: fs.readFileSync(abs).toString('base64'), encoding: 'base64' }
      : { path: rel, content: fs.readFileSync(abs, 'utf8'), encoding: 'utf-8' };
  });
  return github.commitFiles(files, message);
}

// ----------------------------------------------------------- booking (public) ---
/* Where a new-request email goes: whatever Roy typed in the admin, else SMTP_TO.
 * Blank means the admin inbox is the only notification, which is a supported setup. */
function notifyAddress(settings) {
  return (settings.notifyEmail || process.env.SMTP_TO || '').trim();
}

function requestEmail(record, settings) {
  const block = settings.blocks.find((b) => b.id === record.block);
  const when = `${booking.prettyDate(record.date)} · `
    + `${block ? `${block.label} (${block.start}–${block.end})` : record.block}`;
  return {
    subject: `Booking request — ${record.name} — ${when}`,
    text: [
      'A new booking request came in through the website.',
      '',
      `When:     ${when}`,
      `Name:     ${record.name}`,
      `Phone:    ${record.phone}`,
      record.email ? `Email:    ${record.email}` : null,
      `Address:  ${record.address}`,
      '',
      'Job:',
      record.job,
      '',
      '---',
      'The slot is held until you confirm or decline it in the admin:',
      'https://wilkinplumbing.ca/admin',
    ].filter((line) => line !== null).join('\n'),
    replyTo: record.email || undefined,
  };
}

/* The receipt the customer gets, when they left an email address — it is an optional
 * field, so plenty of requests won't have one.
 *
 * It deliberately says "request", never "confirmed": the slot is only held until Roy
 * rings to agree it, and a mail that reads like a confirmation would have people
 * waiting in for a visit that was never actually booked.
 *
 * Replies go to Roy's notification address rather than the SMTP_FROM mailbox, which is
 * send-only and unattended. */
function customerEmail(record, settings, reference, replyTo) {
  const when = templates.whenOf(record, settings);
  return {
    subject: `We've got your request — ${when}`,
    text: [
      `Hi ${record.name.split(' ')[0] || record.name},`,
      '',
      'Thanks — your booking request is in. Nothing is confirmed just yet: I will call',
      `you on ${record.phone} to agree the time, usually the same day.`,
      '',
      `Requested:  ${when}`,
      `Address:    ${record.address}`,
      `Reference:  ${reference}`,
      '',
      'What you told me about the job:',
      record.job,
      '',
      'Need to change or cancel? Reply to this email, or call 705 888 2651.',
      '',
      'Roy',
      'Wilkin Plumbing · 705 888 2651',
      'https://wilkinplumbing.ca',
    ].join('\n'),
    replyTo: replyTo || undefined,
  };
}

async function handleBooking(req, res, pathname) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

  if (pathname === '/api/booking/availability' && req.method === 'GET') {
    return sendJson(res, 200, booking.publicAvailability(), headers);
  }

  if (pathname === '/api/booking/request' && req.method === 'POST') {
    const body = await readBody(req);

    // Honeypot: a real person never sees this field, so anything in it is a bot.
    // Answer 200 so the bot learns nothing from the response.
    if (String(body.company || '').trim()) {
      return sendJson(res, 200, { ok: true, reference: 'received' }, headers);
    }

    if (bookingRateLimited(clientIp(req))) {
      return sendJson(res, 429, {
        error: "That's a few requests from this connection already. "
          + 'Please call 705 888 2651 and I\'ll sort you out.',
      }, headers);
    }

    const result = booking.createRequest(body, 'site');
    if (result.error) {
      return sendJson(res, result.stale ? 409 : 400,
        { error: result.error, stale: !!result.stale }, headers);
    }

    // Email is a courtesy on top of the admin inbox — the request is already saved,
    // so a mail failure must not fail the booking. Await it only so the outcome can
    // be logged; the customer's response never depends on it.
    const to = notifyAddress(result.settings);
    if (to) {
      const mail = await mailer.send({ to, ...requestEmail(result.record, result.settings) });
      if (!mail.sent && mail.reason === 'error') {
        console.error(`booking ${result.record.id}: email failed — ${mail.error}`);
      }
    }

    const reference = templates.referenceOf(result.record);

    /* And a receipt to the customer, when they left an address — the field is optional.
     * This one is plain text on purpose: it is an acknowledgement, not the booking. The
     * branded email goes out later, when Roy actually confirms the slot. */
    if (result.record.email) {
      const ack = await mailer.send({
        to: result.record.email,
        ...customerEmail(result.record, result.settings, reference, to),
      });
      if (!ack.sent && ack.reason === 'error') {
        console.error(`booking ${result.record.id}: customer receipt failed — ${ack.error}`);
      }
    }

    return sendJson(res, 200, {
      ok: true,
      reference,
      date: result.record.date,
      block: result.record.block,
    }, headers);
  }

  return sendJson(res, 404, { error: 'Not found' }, headers);
}

// ------------------------------------------------------------- admin routes ---
async function handleAdmin(req, res, pathname) {
  // Admin pages and APIs: never cached, never indexed, never framed.
  const adminHeaders = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };

  if (pathname === '/admin' || pathname === '/admin/') {
    return fs.readFile(ADMIN_HTML, (err, body) => {
      if (err) { res.writeHead(500); return res.end('Admin UI missing'); }
      res.writeHead(200, {
        ...adminHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        /* frame-src 'self': the editor previews the real site in an iframe and edits
         * it in place, so the admin document has to be allowed to frame this origin.
         * frame-ancestors 'none' still means nothing may frame the admin itself. */
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; " +
          "script-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; " +
          "form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    });
  }

  if (pathname === '/api/admin/state' && req.method === 'GET') {
    const found = sessionOf(req);
    /* Before an account exists there is nothing to protect yet, and the usual failure
     * is a host that never passed the variables through. Say which of the two the app
     * actually received at boot, and why they were rejected — names and reasons only,
     * never a value. Once configured, this disappears. */
    const envDiagnostic = auth.isConfigured() ? undefined : {
      sawUser: !!String(process.env.ADMIN_USER || '').trim(),
      sawPassword: !!String(process.env.ADMIN_PASSWORD || ''),
      passwordLength: String(process.env.ADMIN_PASSWORD || '').length,
      result: bootstrap.reason || (bootstrap.applied ? 'applied' : 'unknown'),
      dotenv: dotenv.loaded ? `read ${dotenv.keys.length} value(s) from .env` : 'no .env file',
    };
    return sendJson(res, 200, {
      configured: auth.isConfigured(),
      setupReady: auth.setupTokenConfigured(),
      envLogin: envDiagnostic,
      authed: !!found,
      user: found ? found.session.user : null,
      csrf: found ? found.session.csrf : null,
      github: github.enabled(),
      minPassword: auth.MIN_PASSWORD,
      booking: found ? booking.summary() : null,
      mail: found ? mailer.status() : null,
    }, adminHeaders);
  }

  if (pathname === '/api/admin/setup' && req.method === 'POST') {
    const body = await readBody(req);
    const result = auth.setup(body);
    if (result.error) return sendJson(res, 400, result, adminHeaders);
    return sendJson(res, 200, { ok: true }, adminHeaders);
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const result = auth.login({ user: body.user, password: body.password, ip: clientIp(req) });
    if (result.error) return sendJson(res, 401, result, adminHeaders);
    return sendJson(res, 200, { ok: true, user: result.user, csrf: result.csrf }, {
      ...adminHeaders,
      'Set-Cookie': auth.cookieHeader(result.token, isSecure(req), auth.SESSION_TTL_MS / 1000),
    });
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const found = sessionOf(req);
    if (found) auth.logout(found.token);
    return sendJson(res, 200, { ok: true }, {
      ...adminHeaders,
      'Set-Cookie': auth.cookieHeader('', isSecure(req), 0),
    });
  }

  if (pathname === '/api/admin/content' && req.method === 'GET') {
    if (!requireAuth(req, res)) return undefined;
    return sendJson(res, 200, {
      texts: editor.scanTexts(),
      slots: editor.scanSlots(),
      library: editor.listLibrary(),
    }, adminHeaders);
  }

  if (pathname.startsWith('/api/admin/media/') && req.method === 'GET') {
    if (!requireAuth(req, res)) return undefined;
    const file = decodeURIComponent(pathname.slice('/api/admin/media/'.length));
    const abs = editor.libraryPath(file);
    if (!abs) return sendJson(res, 404, { error: 'Not found' }, adminHeaders);
    return fs.readFile(abs, (err, body) => {
      if (err) return sendJson(res, 404, { error: 'Not found' }, adminHeaders);
      res.writeHead(200, {
        ...adminHeaders,
        'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      });
      res.end(body);
    });
  }

  if (pathname === '/api/admin/media' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const decoded = editor.decodeDataUrl(body.dataUrl);
    if (decoded.error) return sendJson(res, 400, { error: decoded.error }, adminHeaders);
    const saved = editor.saveToLibrary(body.name, decoded.buf, decoded.ext);
    let commit = { committed: false, reason: 'no-token' };
    try {
      commit = await commitChanges([saved.repoPath], new Set([saved.repoPath]),
        `Admin: add ${saved.file} to the photo library`);
    } catch (err) {
      return sendJson(res, 200, { ok: true, file: saved.file, commitError: err.message },
        adminHeaders);
    }
    return sendJson(res, 200, { ok: true, file: saved.file, commit }, adminHeaders);
  }

  if (pathname === '/api/admin/save' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const applied = await applyEdits(body);
    if (!applied.changedRepoPaths.length) {
      return sendJson(res, 200, {
        ok: true, changed: [], problems: applied.problems,
        commit: { committed: false, reason: 'no-changes' },
      }, adminHeaders);
    }
    const message = String(body.message || '').trim() || 'Admin: update site content';
    let commit;
    try {
      commit = await commitChanges(applied.changedRepoPaths, applied.binaryRepoPaths, message);
    } catch (err) {
      // The files are written and live; only the push failed. Say so plainly —
      // an uncommitted edit is reverted by the next deploy.
      return sendJson(res, 200, {
        ok: true, changed: applied.changedRepoPaths, problems: applied.problems,
        commit: { committed: false, reason: 'error', error: err.message },
      }, adminHeaders);
    }
    return sendJson(res, 200, {
      ok: true, changed: applied.changedRepoPaths, problems: applied.problems, commit,
    }, adminHeaders);
  }

  /* ---- bookings -----------------------------------------------------------
   * None of these touch the repo or GitHub. Booking records hold customer names,
   * phone numbers and addresses; the repo is public. They stay in the state dir.
   * See the header of lib/booking.js. */

  if (pathname === '/api/admin/booking' && req.method === 'GET') {
    if (!requireAuth(req, res)) return undefined;
    return sendJson(res, 200, {
      settings: booking.readSettings(),
      requests: booking.listRequests(),
      schedule: booking.schedule(21),
      summary: booking.summary(),
      mail: mailer.status(),
      mailTokens: templates.TOKEN_HELP,
      today: booking.todayIso(),
    }, adminHeaders);
  }

  if (pathname === '/api/admin/booking/settings' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    return sendJson(res, 200, { ok: true, settings: booking.writeSettings(body) }, adminHeaders);
  }

  /* Approving a request is what triggers the branded confirmation email, so the send
   * lives here rather than in lib/booking.js — updateRequest stays a pure data write and
   * the admin's own "new job" route below reuses it without sending twice. */
  async function sendConfirmation(result) {
    const record = result.record;
    if (!record || record.status !== 'confirmed') return null;
    if (result.previousStatus === 'confirmed') return null;   // only on the edge
    if (!record.email) return { sent: false, reason: 'no-recipient' };
    const settings = result.settings || booking.readSettings();
    if (!settings.confirmEmail.enabled) return { sent: false, reason: 'disabled' };

    const mail = await mailer.send({
      to: record.email,
      replyTo: notifyAddress(settings) || undefined,
      ...templates.confirmation(record, settings),
    });
    if (!mail.sent && mail.reason === 'error') {
      console.error(`booking ${record.id}: confirmation email failed — ${mail.error}`);
    }
    return mail;
  }

  if (pathname === '/api/admin/booking/request' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const result = booking.updateRequest(String(body.id || ''), body.patch || {});
    if (result.error) return sendJson(res, 400, result, adminHeaders);
    // Fail-soft, like every other send here: the status change is already saved, so a
    // dead mail server must not make the approval look like it failed.
    const mail = await sendConfirmation(result);
    return sendJson(res, 200, { ok: true, record: result.record, mail }, adminHeaders);
  }

  /* Roy previewing his own wording. Rendered by the same function that builds the real
   * email, against a sample booking, so the preview cannot drift from what is sent.
   * Takes the draft settings in the body so he can see edits before saving them. */
  if (pathname === '/api/admin/booking/preview' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const draft = booking.previewSettings(body.settings || {});
    return sendJson(res, 200, {
      ok: true,
      tokens: templates.TOKEN_HELP,
      ...templates.samplePreview(draft),
    }, adminHeaders);
  }

  if (pathname === '/api/admin/booking/new' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    // Roy adding a job he took over the phone. The lead time, weekly hours and
    // day-off rules don't apply — he already agreed the visit — but createRequest
    // still refuses a slot another live job is holding.
    const result = booking.createRequest(body, 'admin');
    if (result.error) return sendJson(res, 400, result, adminHeaders);
    const confirmed = booking.updateRequest(result.record.id, { status: 'confirmed' });
    // Roy took this one over the phone, so there is usually no email address — but if he
    // typed one in, the customer should get the same confirmation as everybody else.
    const mail = await sendConfirmation(confirmed);
    return sendJson(res, 200,
      { ok: true, record: confirmed.record || result.record, mail }, adminHeaders);
  }

  if (pathname === '/api/admin/booking/delete' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const result = booking.deleteRequest(String(body.id || ''));
    if (result.error) return sendJson(res, 400, result, adminHeaders);
    return sendJson(res, 200, { ok: true }, adminHeaders);
  }

  if (pathname === '/api/admin/booking/block' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const body = await readBody(req);
    const result = booking.toggleBlocked({ date: String(body.date || ''), block: body.block });
    if (result.error) return sendJson(res, 400, result, adminHeaders);
    return sendJson(res, 200, { ok: true, settings: result.settings }, adminHeaders);
  }

  if (pathname === '/api/admin/booking/test-email' && req.method === 'POST') {
    if (!requireAuth(req, res)) return undefined;
    const settings = booking.readSettings();
    const to = notifyAddress(settings);
    if (!to) {
      return sendJson(res, 400, {
        error: 'No notification address set. Add one below, or set SMTP_TO on the server.',
      }, adminHeaders);
    }
    const sent = await mailer.send({
      to,
      subject: 'Wilkin Plumbing — booking notification test',
      text: 'This is the test email from the booking settings screen.\n\n'
        + 'If you are reading it, new booking requests will reach you here.',
    });
    return sendJson(res, 200, { ok: true, to, ...sent }, adminHeaders);
  }

  return sendJson(res, 404, { error: 'Not found' }, adminHeaders);
}

// -------------------------------------------------------------------- server ---
const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    res.writeHead(400); return res.end('Bad request');
  }

  const onError = (err) => {
    const status = err.status || 500;
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
    else res.end();
  };

  if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/api/admin')) {
    return handleAdmin(req, res, pathname).catch(onError);
  }

  // Public booking API — no session, so it is rate limited and honeypotted instead.
  if (pathname.startsWith('/api/booking')) {
    return handleBooking(req, res, pathname).catch(onError);
  }

  return serveStatic(req, res);
});

/* ADMIN_USER / ADMIN_PASSWORD, if set, define the account outright — no setup screen,
 * no setup token. Done before listen so the first request already sees the account. */
const bootstrap = auth.bootstrapFromEnv();

server.listen(PORT, HOST, () => {
  console.log(`Wilkin Plumbing site on http://${HOST}:${PORT}`);
  // Name the file. A token that silently vanished with a redeploy is the failure this
  // banner has to make obvious, and "7 value(s)" alone does not say which .env was read.
  if (dotenv.loaded) {
    console.log(`  .env         ${dotenv.keys.length} value(s): ${dotenv.keys.join(', ') || 'none new'}`);
    for (const f of dotenv.files) console.log(`               ${f}`);
  } else {
    console.log(`  .env         none found: ${require('./lib/env').candidates().join(' , ')}`);
  }
  if (bootstrap.applied) {
    console.log(`  admin login  ${bootstrap.replaced ? 'updated' : 'created'} from `
      + `ADMIN_USER/ADMIN_PASSWORD as "${bootstrap.user}"`);
  } else if (bootstrap.reason && bootstrap.reason !== 'not-set' && bootstrap.reason !== 'already matches') {
    console.log(`  admin login  ADMIN_USER/ADMIN_PASSWORD ignored: ${bootstrap.reason}`);
  }
  console.log(`  admin        /admin  (${auth.isConfigured() ? 'account configured'
    : auth.setupTokenConfigured() ? 'awaiting first-run setup'
      : 'SETUP LOCKED — set ADMIN_SETUP_TOKEN, or ADMIN_USER + ADMIN_PASSWORD'})`);
  console.log(`  admin state  ${auth.STATE_DIR}`);
  console.log(`  bookings     ${booking.DIR} (never committed)`);
  const mail = mailer.status();
  console.log(`  booking mail ${mail.configured ? `${mail.host}:${mail.port}` : `off — ${mail.reason}`}`);
  console.log(`  git push     ${github.enabled() ? 'enabled' : 'DISABLED — set GITHUB_TOKEN'}`);
});
