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
 * Real environment variables always win: this only fills in what is not already set,
 * so a host that DOES pass variables through is never overridden by a stale file.
 *
 *   ADMIN_USER=roy
 *   ADMIN_PASSWORD=a long password
 *   # comments and blank lines are ignored
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '.env');

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

/** Returns {loaded, file, keys} — names only, never values. */
function load() {
  let text;
  try {
    text = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    return { loaded: false, file: FILE, keys: [] };
  }
  const values = parse(text);
  const keys = [];
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] !== undefined) continue;   // a real env var always wins
    process.env[key] = value;
    keys.push(key);
  }
  return { loaded: true, file: FILE, keys };
}

module.exports = { load, parse, FILE };
