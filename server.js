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

const auth = require('./lib/auth');
const editor = require('./lib/editor');
const locations = require('./lib/locations');
const github = require('./lib/github');

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
    if (!result.changed && result.html === html) {
      problems.push(`No text node named "${item.id}" — skipped.`);
      continue;
    }
    html = result.html;
    indexChanged = true;
  }

  for (const item of Array.isArray(slots) ? slots : []) {
    if (!item || typeof item.slot !== 'string') continue;
    const decoded = editor.decodeDataUrl(item.dataUrl);
    if (decoded.error) { problems.push(`${item.slot}: ${decoded.error}`); continue; }
    const written = editor.writeSlotImage(item.slot, decoded.buf);
    const result = editor.setSlotSrc(html, item.slot, written.src);
    if (!result.changed && result.html === html) {
      problems.push(`No image slot named "${item.slot}" — skipped.`);
      continue;
    }
    html = result.html;
    indexChanged = true;
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
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; " +
          "script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; " +
          "base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    });
  }

  if (pathname === '/api/admin/state' && req.method === 'GET') {
    const found = sessionOf(req);
    return sendJson(res, 200, {
      configured: auth.isConfigured(),
      setupReady: auth.setupTokenConfigured(),
      authed: !!found,
      user: found ? found.session.user : null,
      csrf: found ? found.session.csrf : null,
      github: github.enabled(),
      minPassword: auth.MIN_PASSWORD,
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

  if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/api/admin')) {
    return handleAdmin(req, res, pathname).catch((err) => {
      const status = err.status || 500;
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
      else res.end();
    });
  }

  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Wilkin Plumbing site on http://${HOST}:${PORT}`);
  console.log(`  admin        /admin  (${auth.isConfigured() ? 'account configured'
    : auth.setupTokenConfigured() ? 'awaiting first-run setup'
      : 'SETUP LOCKED — set ADMIN_SETUP_TOKEN'})`);
  console.log(`  admin state  ${auth.STATE_DIR}`);
  console.log(`  git push     ${github.enabled() ? 'enabled' : 'DISABLED — set GITHUB_TOKEN'}`);
});
