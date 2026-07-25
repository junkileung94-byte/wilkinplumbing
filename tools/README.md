# Wilkin Plumbing — site, admin and deploy

The public site is static HTML in `../site/`. It is served — and edited — by one Node
app (`../server.js`, no dependencies), which Hostinger runs with `npm start`.

```
server.js            public site  +  /admin
lib/auth.js          password, sessions, rate limiting, first-run setup gate
lib/editor.js        the content edits themselves (data-edit / data-slot in index.html)
lib/locations.js     regenerates the 11 location pages from index.html
lib/github.js        commits each save back to the repo
admin/app.html       the admin UI (setup → login → editor)
content/locations.json   per-municipality copy for the location pages
```

## The admin

`https://wilkinplumbing.ca/admin` — public URL, password protected.

First visit shows a one-time setup screen: enter the **setup token**, pick a username and
password, done. After that it is a normal login. Setup can only ever run once.

**Why every save is a commit.** Hostinger redeploys the site from the GitHub repo, so a
file written only on the server is erased by the next deploy. Each save therefore:

1. rewrites `site/index.html`,
2. regenerates the 11 location pages from it (they are clones — otherwise they drift),
3. commits all of it to GitHub in a single commit,
4. Hostinger redeploys, and the change is permanent.

If `GITHUB_TOKEN` is missing or the push fails, the admin says so in plain words rather
than pretending the edit is safe — the change is live but the next deploy will revert it.

## Required environment variables (Hostinger → your app → Environment)

| Variable | Required | What it does |
|---|---|---|
| `ADMIN_SETUP_TOKEN` | **yes** | Gates the one-time setup screen. Minimum 16 characters, random. Without it setup refuses, so a scanner that finds `/admin` first still cannot claim the account. |
| `GITHUB_TOKEN` | **yes** | Fine-grained PAT, **Contents: read and write**, scoped to this repo only. Lets saves persist. |
| `GITHUB_REPO` | no | `owner/name`. Defaults to `junkileung94-byte/wilkinplumbing`. |
| `GITHUB_BRANCH` | no | Defaults to `main`. |
| `ADMIN_STATE_DIR` | no | Where the username + password hash live. Defaults to `~/.wilkin-admin`. |
| `ADMIN_COOKIE_SECURE` | no | Set to `1` if the session cookie arrives without the `Secure` flag — i.e. if the host's proxy does not send `x-forwarded-proto`. |

**The repo is public — never put either token in a file.** They belong in Hostinger's
environment variables and nowhere else. The admin's own credentials are written to
`ADMIN_STATE_DIR`, deliberately outside the repo, with `0600` permissions.

If the host wipes the home directory on redeploy, the account disappears and the setup
screen returns; you would set the account up again with the same token. Nothing is
exposed by that — setup still requires the token.

## Security posture

- Password stored as a **scrypt** hash with a per-account salt, never in plain text.
- Minimum 12-character password, enforced server-side.
- Login is rate limited per IP: 8 failures triggers a 15-minute lockout.
- Session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` over HTTPS; 12-hour
  maximum, 2-hour idle timeout.
- Every write route requires a CSRF token in addition to the session.
- Submitted text is sanitised — `<script>`, event handlers and `javascript:` URLs are
  stripped, simple inline formatting survives.
- `/admin` is `noindex`, `Disallow`ed in robots.txt, and cannot be framed.

Rotating the password today means deleting `~/.wilkin-admin/credentials.json` on the
server and running setup again.

## Location pages

`site/plumber-<municipality>/index.html` is **generated**, never hand-edited. Each is a
clone of `site/index.html` with locale wording swapped in, so the design is identical to
the main page by construction. Copy lives in `../content/locations.json`.

```bash
npm run build:locations     # rewrite the pages + sitemap.xml + robots.txt
npm run check:locations     # verify the committed files are current
```

The live admin runs this automatically after every save. You only need it by hand when
you edit `site/index.html` or `content/locations.json` locally.

## Running locally

```bash
npm start                      # http://127.0.0.1:3000  — site and /admin

# to exercise the admin locally without touching the real account or the repo:
ADMIN_STATE_DIR=/tmp/wp-admin ADMIN_SETUP_TOKEN=$(openssl rand -hex 24) npm start
```

With no `GITHUB_TOKEN` set, local saves write files and skip the commit — which is the
old local workflow: edit, then `tools/publish.sh` to commit and push.

## Publishing code changes

```bash
tools/publish.sh "message"     # commit everything and push; Hostinger redeploys
```
