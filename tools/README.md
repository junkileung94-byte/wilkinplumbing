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

## The editor

There is one editor, and it is the site itself. `/admin` shows the real page in a frame
at a real device width (desktop 1280 / mobile 420, scaled to fit the screen), and you
edit it where it stands:

- **Words** — click any text and type. Highlight some and use **B** / *I* / <u>U</u>, or
  the Size / Font / Colour menus, which wrap only the highlighted words in the site's own
  tokens (`var(--font-display)`, `var(--orange)`…) so a choice renders exactly as the
  live page will. Enter is a line break, paste comes in as plain text, Escape puts the
  original wording back.
- **Photos** — click any photo to pick a new one from the library, then frame it. The
  cropper opens at the shape the page actually shows that photo at, with free / 16:9 /
  4:3 / 1:1 / 3:4 / 4:5 as alternatives, a flip, and "use the whole photo". Cutting and
  shrinking (1600px longest side) happen in the browser, so the server needs no image
  library; a PNG stays a PNG, so the logo keeps its transparent background.

Nothing is live until **Publish changes**: edits stage up, the preview shows them in
green, and one publish writes them, rebuilds the location pages and makes a single
commit. Reloading the preview keeps staged edits; "Discard changes" throws them away.
Anything carrying a marker that the preview does not show gets a plain editor beneath it,
so nothing becomes unreachable.

Bookings are a separate tab and save as you go — they never touch the repo.

## The admin

`https://wilkinplumbing.ca/admin` — public URL, password protected.

Set `ADMIN_USER` and `ADMIN_PASSWORD` in the environment and there is **no setup screen at
all** — you go straight to a login. That is the recommended way in.

Those two are authoritative: change `ADMIN_PASSWORD`, restart, and the password has
changed. That is also the password reset, and it means the account survives the host
wiping the home directory. A password shorter than 12 characters is ignored with a line
in the startup log rather than quietly accepted.

Without them, first visit shows a one-time setup screen gated by `ADMIN_SETUP_TOKEN`
instead. Either route ends at the same normal login; setup can only ever run once.

If you have a shell on the server, `node tools/set-admin-password.js` creates or resets
the account with no environment variable at all (`--force` to overwrite).

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
| `ADMIN_USER` | **yes**\* | Admin username. With `ADMIN_PASSWORD`, skips the setup screen entirely. |
| `ADMIN_PASSWORD` | **yes**\* | Admin password, minimum 12 characters. Authoritative — change it and restart to change the password. Ignored (with a log line) if too short. |
| `ADMIN_SETUP_TOKEN` | no\* | The older way in: gates the one-time setup screen, minimum 16 characters. Not needed if `ADMIN_USER`/`ADMIN_PASSWORD` are set. |
| `GITHUB_TOKEN` | no | Fine-grained PAT, **Contents: read and write**, scoped to this repo only. Only needed if you want admin content edits committed automatically — see below. |
| `GITHUB_REPO` | no | `owner/name`. Defaults to `junkileung94-byte/wilkinplumbing`. |
| `GITHUB_BRANCH` | no | Defaults to `main`. |
| `ADMIN_STATE_DIR` | no | Where the username + password hash live. Defaults to `~/.wilkin-admin`. |
| `ADMIN_COOKIE_SECURE` | no | Set to `1` if the session cookie arrives without the `Secure` flag — i.e. if the host's proxy does not send `x-forwarded-proto`. |

\* One of `ADMIN_USER` + `ADMIN_PASSWORD`, or `ADMIN_SETUP_TOKEN`, has to be set — otherwise
there is no way to create the account through the browser and `/admin` stays locked. That
is on purpose: `/admin` is a public URL, so an ungated setup screen would let whoever
found it first claim the site.

**The repo is public — never put any of these in a file.** They belong in Hostinger's
environment variables and nowhere else. The admin's own credentials are written to
`ADMIN_STATE_DIR`, deliberately outside the repo, with `0600` permissions.

If the host wipes the home directory on redeploy, `ADMIN_USER`/`ADMIN_PASSWORD` simply
recreate the account on the next boot. (With only `ADMIN_SETUP_TOKEN` set, the account
disappears and the setup screen returns instead.)

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

Rotating the password: change `ADMIN_PASSWORD` and restart the app. Every live session is
signed out. (With a shell, `node tools/set-admin-password.js --force` does the same.)

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
