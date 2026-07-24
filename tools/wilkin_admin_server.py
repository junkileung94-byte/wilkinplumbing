#!/usr/bin/env python3
"""Wilkin Plumbing — preview server + /admin content manager.

A single-file, stdlib-only (+ Pillow) admin for the static site in site/.
Same idea as the Beauty Extension Haus admin, slimmed for one page:

  GET  /admin              admin UI (tools/admin.html)
  GET  /api/texts          every data-edit text node, with its current HTML
  POST /api/text           {id, value} -> rewrite that node's inner HTML in index.html
  GET  /api/slots          every data-slot <img> (slot id, current src, alt)
  GET  /api/library        images in media-library/ (name, w, h)
  POST /api/upload         {name, data(base64)} -> validate + store in media-library/
  POST /api/library        {action:"remove", file} -> delete a library image
  GET  /api/thumb/<name>   cached 360px thumbnail of a library image
  GET  /api/full/<name>    full-size library image (for the cropper)
  POST /api/apply          {slot, file, crop?{x,y,w,h}} -> crop -> assets/photos/slot-<slot>.jpg
                           and repoint every <img data-slot> at it

Edits are written straight into site/index.html (no runtime loader needed).
Localhost by default; bind 0.0.0.0 to reach it over the LAN/tailnet. No auth of
its own — gate it with tailscale serve / a tunnel + Access, like the haus admin.
"""
import base64, io, json, os, re, sys, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # repo root
SITE = os.path.join(ROOT, "site")
LIB = os.path.join(ROOT, "media-library")
PHOTOS = os.path.join(SITE, "assets", "photos")
ADMIN_HTML = os.path.join(ROOT, "tools", "admin.html")

PAGES = ["index.html"]
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")
# tags whose data-edit inner HTML the admin may rewrite (each tagged node holds
# plain text or simple inline markup — never a nested copy of the same tag)
EDIT_TAGS = "h1|h2|h3|h4|p|li|a|span|td|th|summary|footer|figcaption|blockquote|div|b"

os.makedirs(PHOTOS, exist_ok=True)
os.makedirs(LIB, exist_ok=True)


# ---------------------------------------------------------------- text -----
def scan_texts():
    """Every data-edit text node across the pages, with its current inner HTML."""
    out, seen = [], set()
    for page in PAGES:
        path = os.path.join(SITE, page)
        if not os.path.exists(path):
            continue
        html = open(path, encoding="utf-8").read()
        for m in re.finditer(
                r'<(%s)\b[^>]*\bdata-edit="([^"]+)"[^>]*>(.*?)</\1>' % EDIT_TAGS,
                html, re.S):
            eid = m.group(2)
            if eid in seen:
                continue
            seen.add(eid)
            out.append({"id": eid, "page": page, "tag": m.group(1),
                        "html": m.group(3).strip()})
    return out


def set_text(eid, value):
    """Rewrite the inner HTML of the data-edit node (first match wins per page)."""
    changed = False
    for page in PAGES:
        path = os.path.join(SITE, page)
        if not os.path.exists(path):
            continue
        html = open(path, encoding="utf-8").read()
        new = re.sub(
            r'(<(%s)\b[^>]*\bdata-edit="%s"[^>]*>).*?(</\2>)'
            % (EDIT_TAGS, re.escape(eid)),
            lambda mm: mm.group(1) + value + mm.group(3),
            html, count=1, flags=re.S)
        if new != html:
            open(path, "w", encoding="utf-8").write(new)
            changed = True
    return changed


# --------------------------------------------------------------- slots -----
def scan_slots():
    """Every data-slot <img>, deduped by slot id (keeps the first occurrence)."""
    out, seen = [], set()
    for page in PAGES:
        path = os.path.join(SITE, page)
        if not os.path.exists(path):
            continue
        html = open(path, encoding="utf-8").read()
        for m in re.finditer(r'<img\b[^>]*\bdata-slot="([^"]+)"[^>]*>', html):
            slot = m.group(1)
            if slot in seen:
                continue
            seen.add(slot)
            tag = m.group(0)
            src = re.search(r'src="([^"]*)"', tag)
            alt = re.search(r'alt="([^"]*)"', tag)
            dsrc = src.group(1) if src else None
            if dsrc and dsrc.startswith("data:"):
                dsrc = None
            out.append({"slot": slot, "page": page,
                        "src": dsrc, "alt": alt.group(1) if alt else ""})
    return out


# ------------------------------------------------------------- library -----
def safe_lib_path(name):
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    p = os.path.join(LIB, name)
    return p if os.path.isfile(p) and name.lower().endswith(IMG_EXT) else None


def thumbs_dir():
    p = os.path.join(LIB, ".thumbs")
    os.makedirs(p, exist_ok=True)
    return p


def list_library():
    out = []
    for f in sorted(os.listdir(LIB)):
        fp = safe_lib_path(f)
        if not fp:
            continue
        try:
            with Image.open(fp) as im:
                im = ImageOps.exif_transpose(im)
                out.append({"file": f, "w": im.width, "h": im.height})
        except Exception:
            pass
    return out


def _unique_lib_name(base, ext):
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", base).strip("-.") or "image"
    slug = slug[:60]
    name = "%s%s" % (slug, ext)
    n = 2
    while os.path.exists(os.path.join(LIB, name)):
        name = "%s-%d%s" % (slug, n, ext)
        n += 1
    return name


def save_upload(name, b64):
    """Decode a base64 image, re-encode via Pillow (validates it), store in LIB."""
    if "," in b64 and b64.strip().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise ValueError("bad base64 data")
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    except Exception:
        raise ValueError("not a readable image")
    base, ext = os.path.splitext(os.path.basename(name or "upload"))
    keep_png = (im.mode in ("RGBA", "LA", "P")) and ext.lower() == ".png"
    if keep_png:
        out_ext, fmt = ".png", "PNG"
        im = im.convert("RGBA")
    else:
        out_ext, fmt = ".jpg", "JPEG"
        im = im.convert("RGB")
    # cap very large uploads so the library stays light
    im.thumbnail((3000, 3000))
    out_name = _unique_lib_name(base, out_ext)
    save_kw = {"quality": 88, "optimize": True} if fmt == "JPEG" else {"optimize": True}
    im.save(os.path.join(LIB, out_name), fmt, **save_kw)
    return out_name


def remove_library(name):
    fp = safe_lib_path(name)
    if not fp:
        raise ValueError("unknown library file")
    os.remove(fp)
    tp = os.path.join(thumbs_dir(), name + ".jpg")
    if os.path.exists(tp):
        try:
            os.remove(tp)
        except OSError:
            pass
    return True


# --------------------------------------------------------------- apply -----
def apply_image(slot, fname, crop):
    """Crop the chosen library image, save to assets/photos, repoint the slot."""
    src_path = safe_lib_path(fname)
    if not src_path:
        raise ValueError("unknown library file")
    im = ImageOps.exif_transpose(Image.open(src_path)).convert("RGB")
    if crop:
        x, y, w, h = (int(crop[k]) for k in ("x", "y", "w", "h"))
        x = max(0, min(x, im.width - 1)); y = max(0, min(y, im.height - 1))
        w = max(16, min(w, im.width - x)); h = max(16, min(h, im.height - y))
        im = im.crop((x, y, x + w, y + h))
    im.thumbnail((1600, 1600))
    slug = re.sub(r"[^a-z0-9-]", "", slot.lower())
    out_name = "slot-%s.jpg" % slug
    im.save(os.path.join(PHOTOS, out_name), quality=85, optimize=True)
    new_src = "assets/photos/%s?v=%d" % (out_name, int(time.time()))

    changed = False
    for page in PAGES:
        path = os.path.join(SITE, page)
        if not os.path.exists(path):
            continue
        html = open(path, encoding="utf-8").read()

        def swap_src(m):
            return re.sub(r'src="[^"]*"', 'src="%s"' % new_src, m.group(0))
        html, n = re.subn(
            r'<img\b[^>]*\bdata-slot="%s"[^>]*>' % re.escape(slot), swap_src, html)
        if n:
            open(path, "w", encoding="utf-8").write(html)
            changed = True
    if not changed:
        raise ValueError("slot not found in any page")
    return new_src


# -------------------------------------------------------------- server -----
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        # never cache site files, so admin edits show on a normal refresh
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, ctype):
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlsplit(self.path).path
        if p in ("/admin", "/admin/"):
            return self._file(ADMIN_HTML, "text/html; charset=utf-8")
        if p == "/api/texts":
            return self._json(scan_texts())
        if p == "/api/slots":
            return self._json(scan_slots())
        if p == "/api/library":
            return self._json(list_library())
        if p.startswith("/api/thumb/"):
            name = os.path.basename(unquote(p[len("/api/thumb/"):]))
            fp = safe_lib_path(name)
            if not fp:
                return self._json({"error": "not found"}, 404)
            tp = os.path.join(thumbs_dir(), name + ".jpg")
            if not os.path.exists(tp) or os.path.getmtime(tp) < os.path.getmtime(fp):
                im = ImageOps.exif_transpose(Image.open(fp)).convert("RGB")
                im.thumbnail((360, 360))
                im.save(tp, quality=78)
            return self._file(tp, "image/jpeg")
        if p.startswith("/api/full/"):
            name = os.path.basename(unquote(p[len("/api/full/"):]))
            fp = safe_lib_path(name)
            if not fp:
                return self._json({"error": "not found"}, 404)
            ctype = "image/png" if name.lower().endswith(".png") else "image/jpeg"
            return self._file(fp, ctype)
        return super().do_GET()

    def do_POST(self):
        p = urlsplit(self.path).path
        try:
            length = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json({"error": "bad json"}, 400)

        if p == "/api/text":
            try:
                ok = set_text(data["id"], data["value"])
                return self._json({"ok": ok})
            except KeyError as e:
                return self._json({"error": "missing " + str(e)}, 400)

        if p == "/api/apply":
            try:
                new_src = apply_image(data["slot"], data["file"], data.get("crop"))
                return self._json({"ok": True, "src": new_src})
            except (KeyError, ValueError) as e:
                return self._json({"error": str(e)}, 400)

        if p == "/api/upload":
            try:
                name = save_upload(data.get("name", "upload"), data["data"])
                return self._json({"ok": True, "file": name, "library": list_library()})
            except (KeyError, ValueError) as e:
                return self._json({"error": str(e)}, 400)

        if p == "/api/library":
            try:
                if data.get("action") == "remove":
                    remove_library(data["file"])
                    return self._json({"ok": True, "library": list_library()})
                return self._json({"error": "unknown action"}, 400)
            except (KeyError, ValueError) as e:
                return self._json({"error": str(e)}, 400)

        return self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    host = os.environ.get("WILKIN_ADMIN_HOST", "127.0.0.1")
    port = int(os.environ.get("WILKIN_ADMIN_PORT", "8795"))
    for a in sys.argv[1:]:
        if a.isdigit():
            port = int(a)
        else:
            host = a
    print("Wilkin admin serving %s -> http://%s:%d/admin" % (SITE, host, port), flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
