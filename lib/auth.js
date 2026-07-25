'use strict';
/* Authentication for the public /admin.
 *
 * Threat model: /admin is reachable from the open internet on a site deployed from a
 * PUBLIC GitHub repo. So:
 *   · no secret may ever be written inside the repo — state lives in ADMIN_STATE_DIR,
 *     which defaults to ~/.wilkin-admin, outside the deploy directory
 *   · the one-time setup screen is gated by ADMIN_SETUP_TOKEN, set in the Hostinger
 *     panel. Without it setup refuses, so a scanner that reaches /admin/setup before
 *     the owner does still cannot claim the account
 *   · passwords are scrypt-hashed with a per-account salt; only the hash is stored
 *   · login is rate limited per IP, and every write route needs a CSRF token
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.ADMIN_STATE_DIR || path.join(os.homedir(), '.wilkin-admin');
const CRED_FILE = path.join(STATE_DIR, 'credentials.json');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MIN_PASSWORD = 12;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // absolute
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;       // since last request
const MAX_FAILS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const sessions = new Map();   // token -> {user, csrf, created, seen}
const fails = new Map();      // ip -> {n, until}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function readCreds() {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  } catch (err) {
    return null;
  }
}

function isConfigured() {
  const c = readCreds();
  return !!(c && c.user && c.hash && c.salt);
}

function setupTokenConfigured() {
  return !!(process.env.ADMIN_SETUP_TOKEN && process.env.ADMIN_SETUP_TOKEN.length >= 16);
}

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  }).toString('hex');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // still burn a comparison so length isn't a timing oracle
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/** One-time account creation. Returns {ok} or {error}. */
function setup({ user, password, token }) {
  if (isConfigured()) return { error: 'Admin account already exists.' };
  if (!setupTokenConfigured()) {
    return {
      error: 'Setup is disabled: ADMIN_SETUP_TOKEN is not set on the server ' +
        '(or is shorter than 16 characters). Set it in the Hostinger environment ' +
        'variables, restart the app, then reload this page.',
    };
  }
  if (!timingSafeEqual(token || '', process.env.ADMIN_SETUP_TOKEN)) {
    return { error: 'Setup token is incorrect.' };
  }
  user = String(user || '').trim();
  password = String(password || '');
  if (user.length < 3 || user.length > 64) {
    return { error: 'Username must be 3–64 characters.' };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const rec = {
    user, salt, hash: hashPassword(password, salt),
    algo: 'scrypt', params: SCRYPT, createdAt: new Date().toISOString(),
  };
  ensureStateDir();
  fs.writeFileSync(CRED_FILE, JSON.stringify(rec, null, 2), { mode: 0o600 });
  return { ok: true };
}

function lockedOut(ip) {
  const f = fails.get(ip);
  if (!f) return 0;
  if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 1000);
  if (f.until && f.until <= Date.now()) fails.delete(ip);
  return 0;
}

function noteFailure(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCKOUT_MS; f.n = 0; }
  fails.set(ip, f);
}

/** Returns {token, csrf} on success, or {error}. */
function login({ user, password, ip }) {
  const wait = lockedOut(ip);
  if (wait) return { error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` };

  const c = readCreds();
  if (!c) return { error: 'No admin account exists yet.' };

  const candidate = hashPassword(String(password || ''), c.salt);
  const ok = timingSafeEqual(String(user || ''), c.user) && timingSafeEqual(candidate, c.hash);
  if (!ok) {
    noteFailure(ip);
    return { error: 'Incorrect username or password.' };
  }
  fails.delete(ip);

  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { user: c.user, csrf, created: now, seen: now });
  return { token, csrf, user: c.user };
}

function sessionFor(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.created > SESSION_TTL_MS || now - s.seen > IDLE_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  s.seen = now;
  return s;
}

function logout(token) {
  sessions.delete(token);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token, secure, maxAgeSeconds) {
  const bits = [
    `wp_admin=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

module.exports = {
  STATE_DIR, CRED_FILE, MIN_PASSWORD, SESSION_TTL_MS,
  isConfigured, setupTokenConfigured, setup, login, logout,
  sessionFor, parseCookies, cookieHeader,
};
