'use strict';
/* Read a .env file from the app directory into process.env.
 *
 * Some hosts do not pass their panel's environment variables through to the Node
 * process. When that happens the owner has no way to configure the app at all, so
 * this gives them a second route: create a `.env` next to server.js with the same
 * variables in it.
 *
 * `.env` is in .gitignore, so a file created on the server stays on the server and
 * never reaches the public repo. Nothing here writes the file — it is only read.
 *
 * Two locations are read, in this order:
 *
 *   1. `<app>/.env`      — next to server.js. Convenient, but on a host that redeploys
 *                          by rsyncing from git it is DELETED on every deploy, because
 *                          it is not in the repo. Fine for a value you can re-add;
 *                          useless for the token that makes deploys happen.
 *   2. `<state>/.env`    — inside ADMIN_STATE_DIR, the directory that already holds the
 *                          admin credentials precisely because it sits outside the
 *                          deployed folder. A secret here survives every redeploy.
 *
 * Put anything that must outlive a deploy in (2). Wilkin Plumbing's Hostinger setup
 * auto-deploys on push, so GITHUB_TOKEN in (1) erases itself the first time the admin
 * commits an edit.
 *
 * Real environment variables always win, and an earlier file beats a later one: this
 * only ever fills in what is not already set, so a host that DOES pass variables
 * through is never overridden by a stale file.
 *
 *   ADMIN_USER=roy
 *   ADMIN_PASSWORD=a long password
 *   # comments and blank lines are ignored
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(__dirname, '..', '.env');

/* Mirrors lib/auth.js's STATE_DIR. Resolved here rather than imported because env.js
 * runs first — auth.js reads process.env at load time, which is what this fills in. */
function stateDir() {
  return process.env.ADMIN_STATE_DIR || path.join(os.homedir(), '.wilkin-admin');
}

/** Every place a .env may live, in precedence order. */
function candidates() {
  const out = [FILE];
  const staged = path.join(stateDir(), '.env');
  if (staged !== FILE) out.push(staged);
  return out;
}

function parse(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // strip one layer of matching quotes, so trailing spaces can be kept deliberately
    if (value.length > 1 && ((value[0] === '"' && value.endsWith('"'))
        || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Returns {loaded, file, files, keys} — names only, never values. */
function load() {
  const keys = [];
  const files = [];
  for (const file of candidates()) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;                                     // absent is the normal case
    }
    files.push(file);
    for (const [key, value] of Object.entries(parse(text))) {
      if (process.env[key] !== undefined) continue;  // a real env var, or an earlier file
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: files.length > 0, file: files[0] || FILE, files, keys };
}

module.exports = { load, parse, FILE, candidates };
