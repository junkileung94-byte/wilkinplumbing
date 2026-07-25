'use strict';
/* Content edits against site/index.html.
 *
 * Ported from the previous Python admin. The page carries two kinds of marker:
 *   data-edit="id"  on a text node the admin may rewrite
 *   data-slot="id"  on an <img> whose source the admin may swap (ids may repeat —
 *                   every copy of a slot updates together)
 *
 * Only index.html is edited. The eleven location pages are regenerated from it by
 * lib/locations.js after every save, so they never drift.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const INDEX = path.join(SITE, 'index.html');
const LIBRARY = path.join(ROOT, 'media-library');
const PHOTOS = path.join(SITE, 'assets', 'photos');

// tags whose data-edit inner HTML may be rewritten (each holds plain text or simple
// inline markup — never a nested copy of the same tag)
const EDIT_TAGS = 'h1|h2|h3|h4|p|li|a|span|td|th|summary|footer|figcaption|blockquote|div|b';
const IMG_EXT = /\.(jpe?g|png|webp)$/i;

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readIndex() {
  return fs.readFileSync(INDEX, 'utf8');
}

/** Every data-edit node, in document order, deduped by id. */
function scanTexts(html = readIndex()) {
  const re = new RegExp(`<(${EDIT_TAGS})\\b[^>]*\\bdata-edit="([^"]+)"[^>]*>([\\s\\S]*?)</\\1>`, 'g');
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ id: m[2], tag: m[1], html: m[3].trim() });
  }
  return out;
}

/** Every data-slot <img>, deduped by slot id. */
function scanSlots(html = readIndex()) {
  const re = /<img\b[^>]*\bdata-slot="([^"]+)"[^>]*>/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const slot = m[1];
    if (seen.has(slot)) continue;
    seen.add(slot);
    const src = /src="([^"]*)"/.exec(m[0]);
    const alt = /alt="([^"]*)"/.exec(m[0]);
    out.push({
      slot,
      src: src && !src[1].startsWith('data:') ? src[1] : null,
      alt: alt ? alt[1] : '',
    });
  }
  return out;
}

/* Text the admin submits is inserted into the page as-is, so it has to be treated as
 * untrusted: a <script> pasted into a heading would execute for every visitor. Inline
 * formatting is allowed, anything that can execute or load is not. */
const ALLOWED_INLINE = /^<\/?(b|strong|i|em|br|small|span|a)\b[^>]*>$/i;

function sanitize(value) {
  let s = String(value == null ? '' : value);
  // drop dangerous elements *with* their contents, so nothing leaks through as text
  s = s.replace(/<(script|style|iframe|object|embed|form|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|form|input|link|meta|template)\b[^>]*>/gi, '');
  s = s.replace(/<[^>]+>/g, (tag) => (ALLOWED_INLINE.test(tag) ? tag : ''));
  // strip event handlers and javascript: URLs from the inline tags that survived
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '');
  return s.trim();
}

/** Rewrite one data-edit node. Returns true if the page changed. */
function setText(html, id, value) {
  const re = new RegExp(
    `(<(${EDIT_TAGS})\\b[^>]*\\bdata-edit="${reEscape(id)}"[^>]*>)[\\s\\S]*?(</\\2>)`);
  if (!re.test(html)) return { html, changed: false };
  const clean = sanitize(value);
  const next = html.replace(re, (_m, open, _tag, close) => open + clean + close);
  return { html: next, changed: next !== html };
}

/** Point every <img> carrying this slot id at a new src. */
function setSlotSrc(html, slot, src) {
  const re = new RegExp(`<img\\b[^>]*\\bdata-slot="${reEscape(slot)}"[^>]*>`, 'g');
  if (!re.test(html)) return { html, changed: false };
  const next = html.replace(re, (tag) => (/src="[^"]*"/.test(tag)
    ? tag.replace(/src="[^"]*"/, `src="${src}"`)
    : tag.replace(/<img\b/, `<img src="${src}"`)));
  return { html: next, changed: next !== html };
}

function writeIndex(html) {
  fs.writeFileSync(INDEX, html, 'utf8');
}

function safeLibraryName(name) {
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  if (!IMG_EXT.test(name)) return null;
  return name;
}

function listLibrary() {
  try {
    return fs.readdirSync(LIBRARY)
      .filter((f) => safeLibraryName(f))
      .sort()
      .map((file) => ({ file }));
  } catch (err) {
    return [];
  }
}

function libraryPath(name) {
  const safe = safeLibraryName(name);
  if (!safe) return null;
  const p = path.join(LIBRARY, safe);
  return fs.existsSync(p) ? p : null;
}

/** Decode a browser data: URL into a Buffer, rejecting anything that isn't an image. */
function decodeDataUrl(dataUrl, maxBytes = 6 * 1024 * 1024) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(
    String(dataUrl || ''));
  if (!m) return { error: 'Expected a base64 JPEG, PNG or WebP data URL.' };
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) return { error: 'Image data was empty.' };
  if (buf.length > maxBytes) {
    return { error: `Image is ${(buf.length / 1048576).toFixed(1)} MB; limit is ` +
      `${(maxBytes / 1048576).toFixed(0)} MB.` };
  }
  return { buf, ext: m[1] === 'jpg' ? 'jpeg' : m[1] };
}

function slotFileName(slot) {
  return `slot-${String(slot).replace(/[^a-zA-Z0-9_-]+/g, '-')}.jpg`;
}

/** Write a cropped slot image. Returns the src to point the <img> at. */
function writeSlotImage(slot, buf) {
  fs.mkdirSync(PHOTOS, { recursive: true });
  const file = slotFileName(slot);
  fs.writeFileSync(path.join(PHOTOS, file), buf);
  return { src: `assets/photos/${file}`, repoPath: `site/assets/photos/${file}` };
}

function uniqueLibraryName(base, ext) {
  let slug = String(base || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  slug = (slug || 'image').slice(0, 60).replace(IMG_EXT, '');
  let name = `${slug}.${ext === 'jpeg' ? 'jpg' : ext}`;
  let n = 2;
  while (fs.existsSync(path.join(LIBRARY, name))) {
    name = `${slug}-${n}.${ext === 'jpeg' ? 'jpg' : ext}`;
    n += 1;
  }
  return name;
}

function saveToLibrary(name, buf, ext) {
  fs.mkdirSync(LIBRARY, { recursive: true });
  const file = uniqueLibraryName(name, ext);
  fs.writeFileSync(path.join(LIBRARY, file), buf);
  return { file, repoPath: `media-library/${file}` };
}

module.exports = {
  ROOT, SITE, INDEX, LIBRARY, PHOTOS,
  readIndex, writeIndex, scanTexts, scanSlots, setText, setSlotSrc, sanitize,
  listLibrary, libraryPath, decodeDataUrl, writeSlotImage, saveToLibrary,
};
