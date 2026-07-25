# tools/ — Wilkin Plumbing site editor

A small, self-contained content manager for the static site in `../site/`, built
the same way as the Beauty Extension Haus admin: a stdlib Python server (+ Pillow)
that scans the HTML for markers and edits `index.html` in place. No database, no
build step, no runtime JS loader — what you edit is what ships.

## Files
- `wilkin_admin_server.py` — the server: serves the site, `/admin`, and the write APIs.
- `admin.html` — the editor UI (single page, no dependencies).
- `tag_site.py` — one-time, idempotent tagger that adds the edit markers to `index.html`.
- `build_locations.py` — generates the per-municipality location pages (see below).
- `publish.sh` — commit everything and push; Hostinger redeploys from the new commit.

## Location pages
`site/plumber-<municipality>/index.html` is **generated**, not hand-edited. The content
(and the municipal water/wastewater facts each page is built on) lives in the `PLACES`
list in `build_locations.py`.

```bash
python3 tools/build_locations.py           # rewrite the pages + sitemap.xml + robots.txt
python3 tools/build_locations.py --check    # verify the committed files are current
```

Editing a generated `index.html` directly will be silently overwritten on the next run —
change `build_locations.py` instead. The admin editor at `/admin` only manages
`site/index.html`; location pages are outside it.

Shared styling for those pages is `site/assets/location.css` (hand-written, not generated).

## Markers (already applied)
- `data-slot="..."` on `<img>` the admin can swap/crop. Images that share a slot id
  (e.g. the two `logo` copies, the two `hero-van` copies) all update together.
- `data-edit="..."` on text nodes the admin can rewrite in place.

Re-run `python3 tag_site.py` any time you add new photos/text to the HTML and want
them editable — it only touches nodes it recognises and skips already-tagged ones.

## Run
```bash
# localhost only
python3 tools/wilkin_admin_server.py            # -> http://127.0.0.1:8795/admin

# reachable over the LAN / tailnet (choose host + port)
python3 tools/wilkin_admin_server.py 0.0.0.0 8795
```
Env overrides: `WILKIN_ADMIN_HOST`, `WILKIN_ADMIN_PORT`.

Open `/admin`:
- **Text** — every editable text node, grouped by section. Edit, Save.
- **Images** — every image slot with its current photo. "Change" → pick from the
  library (or upload), crop, apply.
- **Photo library** — upload new photos (drag & drop or choose files) and delete old
  ones. The library lives in `../media-library/`, seeded from `../brand/`.

## How edits land
- Text edits rewrite the node's inner HTML directly in `site/index.html`.
- Applied images are cropped/resized (max 1600px) to `site/assets/photos/slot-<id>.jpg`
  and the `<img src>` is repointed. Originals in `media-library/` are never modified.

## Security
The server has **no auth of its own** — never expose it raw on the public internet.
Bind to localhost, or put it behind `tailscale serve` / a Cloudflare Tunnel + Access,
exactly like the haus admin (`../../beautyhaus/deploy/`).

## Notes
- `site/index.html.pre-tag.bak` — untagged snapshot. `site/index.html.tagged.bak` —
  tagged snapshot. Safe to delete once you're happy.
