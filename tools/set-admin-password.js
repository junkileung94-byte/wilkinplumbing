#!/usr/bin/env node
'use strict';
/* Create or reset the /admin account from a shell on the server.
 *
 * Use this instead of the web setup screen when you don't want to bother with the
 * ADMIN_SETUP_TOKEN environment variable, or when the password has been lost —
 * there is deliberately no "forgot password" link on a public admin.
 *
 *   node tools/set-admin-password.js                 # asks for both, hidden input
 *   node tools/set-admin-password.js --user roy      # asks for the password only
 *   node tools/set-admin-password.js --force         # overwrite an existing account
 *
 * Run it as the same user the site runs as, so the credentials file lands in the
 * right home directory. It writes to ADMIN_STATE_DIR (default ~/.wilkin-admin),
 * outside the repo — nothing secret is ever written into the deploy directory.
 *
 * Changing the password signs out every existing browser session.
 */

const readline = require('readline');
const { Writable } = require('stream');
const auth = require('../lib/auth');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

if (has('help')) {
  console.log('usage: node tools/set-admin-password.js [--user NAME] [--force]');
  process.exit(0);
}

/* One readline interface for the whole run. Creating a second one on the same stdin
 * discards whatever the first buffered, which breaks piped input. Echo is suppressed
 * by muting the interface's output rather than by touching raw mode, so this behaves
 * the same in a real terminal and in a panel shell that isn't a TTY. */
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
/* terminal must track whether stdin really is a TTY: forcing it on breaks piped
 * input (lines stop arriving), and forcing it off loses echo control in a shell. */
const rl = readline.createInterface({
  input: process.stdin, output, terminal: process.stdin.isTTY === true,
});

/* Piped input arrives in one chunk and readline emits every line from it immediately.
 * rl.question() would only catch the first and drop the rest, so keep a queue and let
 * each prompt take the next line — works the same whether it is typed or piped. */
const buffered = [];
const waiting = [];
let ended = false;

rl.on('line', (line) => {
  if (waiting.length) waiting.shift()(line);
  else buffered.push(line);
});
rl.on('close', () => {
  ended = true;
  while (waiting.length) waiting.shift()(null);
});

function nextLine() {
  if (buffered.length) return Promise.resolve(buffered.shift());
  if (ended) return Promise.resolve(null);
  return new Promise((resolve) => waiting.push(resolve));
}

function question(prompt, secret) {
  process.stdout.write(prompt);
  muted = !!secret;
  return nextLine().then((line) => {
    muted = false;
    if (secret) process.stdout.write('\n');
    return line;
  });
}

const ask = (prompt) => question(prompt, false).then((a) => (a == null ? null : a.trim()));
const askSecret = (prompt) => question(prompt, true);

function abort(message) {
  console.error(`\n${message}`);
  rl.close();
  process.exit(1);
}

(async function main() {
  console.log('Wilkin Plumbing — admin account');
  console.log(`  state dir: ${auth.STATE_DIR}`);
  const exists = auth.isConfigured();
  console.log(`  account:   ${exists ? 'already set up' : 'none yet'}`);

  if (exists && !has('force')) {
    abort('An account already exists. Re-run with --force to reset its password.');
  }
  console.log('');

  const user = arg('user') || await ask('Username: ');
  if (!user) abort('No username given. Nothing was changed.');

  const password = await askSecret('Password: ');
  if (password == null) abort('No password given. Nothing was changed.');
  const again = await askSecret('Repeat:   ');
  if (again == null) abort('No password given. Nothing was changed.');

  if (password !== again) abort('The two passwords do not match. Nothing was changed.');

  const result = auth.createAccount({ user, password, force: has('force') });
  if (result.error) abort(result.error);

  console.log(`\n${result.replaced ? 'Password reset' : 'Account created'} for "${user}".`);
  console.log(`Written to ${auth.CRED_FILE} (owner-only).`);
  if (result.replaced) console.log('Any browser that was signed in has been signed out.');
  console.log('\nSign in at https://wilkinplumbing.ca/admin');
  rl.close();
}());
