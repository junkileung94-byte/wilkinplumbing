'use strict';
/* Location page builder.
 *
 * Each location page is a clone of site/index.html with locale wording swapped in, so
 * the pages are identical in design to the main page by construction. Copy lives in
 * content/locations.json.
 *
 * Runs in two places: `npm run build:locations` locally, and inside the live admin
 * after every content save — otherwise an edit to index.html would leave the eleven
 * location pages showing the old copy.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const INDEX = path.join(SITE, 'index.html');
const DATA = path.join(ROOT, 'content', 'locations.json');
const ORIGIN = 'https://wilkinplumbing.ca';
const PHONE_TEXT = '705 888 2651';

const PIN_ICON =
  '<span class="svc-ic"><svg viewBox="0 0 24 24"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 ' +
  '9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>';

/* Matches Python's html.escape(s, quote=True) exactly — the two builders must be able
 * to produce byte-identical output. */
function e(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* A replace that insists on exactly one hit. A silent miss here would ship a page
 * carrying the homepage's wording, which is the whole failure mode worth guarding. */
function sub1(str, pattern, replacement, what) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(reEscape(pattern));
  const m = str.match(re);
  if (!m) {
    throw new Error(
      `build:locations: ${what} — pattern did not match.\n` +
      '  index.html markup has moved; update lib/locations.js.');
  }
  return str.replace(re, () => replacement);
}

function localSections(p) {
  const name = p.name;
  const short = p.short || p.name;
  const servicing = p.servicing.map((x) => `        <p>${e(x)}</p>`).join('\n');
  const sources = p.sources
    .map(([label, url]) => `<a href="${e(url)}" rel="nofollow noopener" target="_blank">${e(label)}</a>`)
    .join(' · ');
  const jobs = p.jobs
    .map(([t, d]) => `      <article class="svc glass reveal">${PIN_ICON}<h3>${e(t)}</h3><p>${e(d)}</p></article>`)
    .join('\n');
  const places = p.places.map((x) => `      <li><span>${e(x)}</span></li>`).join('\n');

  return `
<!-- ===== LOCAL: ${e(name)} ===== -->
<section class="block" id="local">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">On the ground</span>
      <h2>What plumbing in ${e(short)} actually involves.</h2>
    </div>
    <div class="story-copy glass reveal" style="max-width:820px">
${servicing}
      <p style="font-size:.86rem;color:rgba(255,255,255,.55);margin-bottom:0">Servicing details from ${sources}.</p>
    </div>
  </div>
</section>

<!-- ===== LOCAL CALLS: ${e(name)} ===== -->
<section class="block">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">Common calls</span>
      <h2>What I get called out for in ${e(short)}.</h2>
    </div>
    <div class="svc-grid">
${jobs}
    </div>
  </div>
</section>

<!-- ===== LOCAL COVERAGE: ${e(name)} ===== -->
<section class="block" style="padding-block:0 clamp(48px,10vw,90px)">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">Coverage</span>
      <h2>Communities I cover in ${e(short)}.</h2>
    </div>
    <ul class="area-links reveal">
${places}
    </ul>
  </div>
</section>
`;
}

function schema(p) {
  const name = p.name;
  const url = `${ORIGIN}/plumber-${p.slug}/`;
  const area = [name].concat(p.places)
    .map((x) => `{"@type":"Place","name":"${x.replace(/"/g, '')}"}`).join(', ');
  return `<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"Plumber",
  "name":"Wilkin Plumbing",
  "url":"${url}",
  "image":"${ORIGIN}/brand/logo/wilkin-logo.png",
  "description":"Licensed journeyman plumber based in Barrie, serving ${e(name)}. Residential and commercial plumbing, water heaters, backflow prevention, wells and water treatment, sewer lines, bathroom renovations.",
  "telephone":"+1-705-888-2651",
  "email":"info@wilkinplumbing.ca",
  "address":{"@type":"PostalAddress","streetAddress":"270 Kozlov St","addressLocality":"Barrie","addressRegion":"ON","postalCode":"L4N 7H6","addressCountry":"CA"},
  "areaServed":[${area}],
  "openingHoursSpecification":{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"06:00","closes":"22:00"},
  "priceRange":"$$"
}
</script>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {"@type":"ListItem","position":1,"name":"Home","item":"${ORIGIN}/"},
    {"@type":"ListItem","position":2,"name":"Plumber in ${e(name)}","item":"${url}"}
  ]
}
</script>`;
}

function render(p, base, bySlug) {
  const name = p.name;
  const short = p.short || name;
  const url = `${ORIGIN}/plumber-${p.slug}/`;
  const title = `Plumber in ${name} | Wilkin Plumbing · ${PHONE_TEXT}`;
  const desc = `Plumber in ${name}. Roy at Wilkin Plumbing — licensed journeyman, backflow ` +
    `certified, based in Barrie. Repairs, water heaters, wells and treatment, bathrooms. ` +
    `Call ${PHONE_TEXT}.`;
  let s = base;

  // head
  s = sub1(s, /<title>[\s\S]*?<\/title>/, `<title>${e(title)}</title>`, 'title');
  s = sub1(s, /<meta name="description" content="[\s\S]*?">/,
    `<meta name="description" content="${e(desc)}">`, 'meta description');
  s = sub1(s, /<link rel="canonical" href="[\s\S]*?">/,
    `<link rel="canonical" href="${url}">`, 'canonical');
  s = sub1(s, /<meta property="og:title" content="[\s\S]*?">/,
    `<meta property="og:title" content="${e(title)}">`, 'og:title');
  s = sub1(s, /<meta property="og:description" content="[\s\S]*?">/,
    `<meta property="og:description" content="${e(desc)}">`, 'og:description');
  s = sub1(s, /<meta property="og:url" content="[\s\S]*?">/,
    `<meta property="og:url" content="${url}">`, 'og:url');

  // hero
  s = sub1(s, /<span data-edit="hero-eyebrow" class="eyebrow">[\s\S]*?<\/span>/,
    `<span class="eyebrow">${e(p.eyebrow || `Simcoe County ${p.kind}`)} · Residential &amp; Commercial</span>`,
    'hero eyebrow');
  s = sub1(s, /<h1 data-edit="hero-title">[\s\S]*?<\/h1>/,
    `<h1>Plumber in <em>${e(name)}.</em></h1>`, 'hero h1');
  s = sub1(s, /<p data-edit="hero-sub" class="hero-sub">[\s\S]*?<\/p>/,
    `<p class="hero-sub">${e(p.lede)}</p>`, 'hero sub');
  s = sub1(s, /<div data-edit="hero-hours" class="scroll-cue">[\s\S]*?<\/div>/,
    `<div class="scroll-cue">${e(p.drive)} · open daily 6am to 10pm</div>`, 'hero hours');

  // contact heading
  s = sub1(s, /<h2 data-edit="contact-h2">[\s\S]*?<\/h2>/,
    `<h2>Book a plumber in ${e(short)}.</h2>`, 'contact h2');

  // locale sections, ahead of the work gallery
  s = sub1(s, '\n<!-- ===== PROJECTS ===== -->',
    localSections(p) + '\n<!-- ===== PROJECTS ===== -->', 'projects anchor');

  // service areas: the current municipality is a label, not a link
  s = sub1(s, new RegExp(`<li><a href="/plumber-${reEscape(p.slug)}/">[\\s\\S]*?</a></li>`),
    `<li><span aria-current="page">${e((bySlug[p.slug] || {}).short || name)}</span></li>`,
    'areas self-link');
  s = sub1(s, '\n    </ul>\n  </div>\n</section>\n\n<!-- ===== CONTACT',
    '\n      <li><a href="/">Wilkin Plumbing home</a></li>' +
    '\n    </ul>\n  </div>\n</section>\n\n<!-- ===== CONTACT', 'areas home link');

  // schema
  s = sub1(s, /<script type="application\/ld\+json">[\s\S]*?<\/script>/, schema(p), 'json-ld');

  // page lives one level down, so relative asset paths won't resolve
  s = s.replace(/(src|href)="(brand\/|assets\/)/g, '$1="/$2');

  // admin markers belong to index.html only
  s = s.replace(/ data-(edit|slot)="[^"]*"/g, '');

  return s;
}

function loadPlaces() {
  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}

function buildSitemap(places) {
  const urls = [`${ORIGIN}/`].concat(places.map((p) => `${ORIGIN}/plumber-${p.slug}/`));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
    '\n</urlset>\n';
}

function buildRobots() {
  return `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;
}

/** Build every generated file. Returns {repoRelativePath: contents}. */
function generate() {
  const base = fs.readFileSync(INDEX, 'utf8');
  const places = loadPlaces();
  const bySlug = Object.fromEntries(places.map((p) => [p.slug, p]));
  const out = {};
  for (const p of places) {
    out[`site/plumber-${p.slug}/index.html`] = render(p, base, bySlug);
  }
  out['site/sitemap.xml'] = buildSitemap(places);
  out['site/robots.txt'] = buildRobots();
  return out;
}

/** Write generated files to disk. Returns the repo-relative paths that changed. */
function write() {
  const files = generate();
  const changed = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(ROOT, rel);
    let existing = null;
    try { existing = fs.readFileSync(abs, 'utf8'); } catch (err) { /* new file */ }
    if (existing === content) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    changed.push(rel);
  }
  return changed;
}

/** Repo-relative paths that differ from disk, without writing. */
function stale() {
  const files = generate();
  const out = [];
  for (const [rel, content] of Object.entries(files)) {
    let existing = null;
    try { existing = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (err) { /* new */ }
    if (existing !== content) out.push(rel);
  }
  return out;
}

module.exports = { generate, write, stale, loadPlaces, ROOT, SITE };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const bad = stale();
    if (bad.length) {
      console.log('stale (run without --check):\n  ' + bad.join('\n  '));
      process.exit(1);
    }
    console.log(`${Object.keys(generate()).length} generated files are current`);
  } else {
    const changed = write();
    console.log(changed.length ? changed.map((c) => `wrote ${c}`).join('\n')
      : 'no changes — all generated files were already current');
  }
}
