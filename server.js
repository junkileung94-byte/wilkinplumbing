'use strict';
/* Minimal zero-dependency static server for the public Wilkin Plumbing site.
 *
 * Serves ONLY the public site — site/ plus the brand/ photos it references
 * (index.html links photos as ../brand/... which resolves to /brand/...).
 * tools/, media-library/, .git and everything else stay unpublished.
 *
 * Hostinger (and most Node hosts) run `npm start` and set process.env.PORT.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIR = __dirname;
const SITE = path.join(DIR, 'site');
const BRAND = path.join(DIR, 'brand');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

// Map a request path to a real file, kept inside SITE (or BRAND for /brand/*).
function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { return null; }
  if (p.indexOf('\0') !== -1) return null;
  if (p === '/' || p === '') return path.join(SITE, 'index.html');

  let base, rel;
  if (p === '/brand' || p.startsWith('/brand/')) {
    base = BRAND; rel = p.slice('/brand'.length);
  } else {
    base = SITE; rel = p;
  }
  const full = path.normalize(path.join(base, rel));
  if (full !== base && !full.startsWith(base + path.sep)) return null; // no escape
  return full;
}

const server = http.createServer((req, res) => {
  let file = resolve(req.url);
  if (!file) { res.writeHead(400); return res.end('Bad request'); }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); }
    fs.readFile(file, (err2, body) => {
      if (err2) { res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('<h1>404</h1>'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(body);
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('Wilkin Plumbing site on http://' + HOST + ':' + PORT);
});
