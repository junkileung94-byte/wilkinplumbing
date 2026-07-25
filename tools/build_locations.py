#!/usr/bin/env python3
"""Build one location page per municipality Wilkin Plumbing covers.

Output: site/plumber-<slug>/index.html  (plus site/sitemap.xml, site/robots.txt)

Each page is a *clone of site/index.html* with locale wording swapped in, so the
location pages are identical in design to the main page by construction — there is no
second stylesheet or second layout to keep in sync. When index.html changes, re-run
this and every location page picks the change up.

What gets swapped per page:
  · title / description / canonical / og tags
  · hero eyebrow, H1 and sub-headline
  · three inserted locale sections (servicing reality, common calls, communities)
  · the contact heading
  · JSON-LD (Plumber with local areaServed + BreadcrumbList)
  · the service-areas list marks the current municipality instead of linking it

Copy lives in tools/locations_data.py, not here.

Usage:  python3 tools/build_locations.py [--check]
        --check  verify generated files are current without rewriting
"""

import argparse
import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from locations_data import PLACES, BY_SLUG  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
INDEX = os.path.join(SITE, 'index.html')
ORIGIN = 'https://wilkinplumbing.ca'
PHONE_TEXT = '705 888 2651'

PIN_ICON = ('<span class="svc-ic"><svg viewBox="0 0 24 24"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 '
            '9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>')


def e(s):
    return html.escape(s, quote=True)


def sub1(pattern, repl, s, what):
    """re.sub that insists on exactly one replacement — a silent no-op here would
    ship a page with the homepage's wording on it."""
    out, n = re.subn(pattern, lambda _m: repl, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('build_locations: %s — pattern matched %d times, expected 1.\n'
                         '  index.html markup has moved; update the builder.' % (what, n))
    return out


# ---------------------------------------------------------------------------
# The locale-specific sections, built from classes that already exist in the
# main page's stylesheet so they render as native sections.
# ---------------------------------------------------------------------------
def local_sections(p):
    name, short = p['name'], p.get('short', p['name'])
    servicing = '\n'.join('        <p>%s</p>' % e(x) for x in p['servicing'])
    sources = ' · '.join('<a href="%s" rel="nofollow noopener" target="_blank">%s</a>'
                         % (e(u), e(l)) for l, u in p['sources'])
    jobs = '\n'.join(
        '      <article class="svc glass reveal">%s<h3>%s</h3><p>%s</p></article>'
        % (PIN_ICON, e(t), e(d)) for t, d in p['jobs'])
    places = '\n'.join('      <li><span>%s</span></li>' % e(x) for x in p['places'])

    return """
<!-- ===== LOCAL: {name} ===== -->
<section class="block" id="local">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">On the ground</span>
      <h2>What plumbing in {short} actually involves.</h2>
    </div>
    <div class="story-copy glass reveal" style="max-width:820px">
{servicing}
      <p style="font-size:.86rem;color:rgba(255,255,255,.55);margin-bottom:0">Servicing details from {sources}.</p>
    </div>
  </div>
</section>

<!-- ===== LOCAL CALLS: {name} ===== -->
<section class="block">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">Common calls</span>
      <h2>What I get called out for in {short}.</h2>
    </div>
    <div class="svc-grid">
{jobs}
    </div>
  </div>
</section>

<!-- ===== LOCAL COVERAGE: {name} ===== -->
<section class="block" style="padding-block:0 clamp(48px,10vw,90px)">
  <div class="wrap">
    <div class="sec-head reveal">
      <span class="eyebrow">Coverage</span>
      <h2>Communities I cover in {short}.</h2>
    </div>
    <ul class="area-links reveal">
{places}
    </ul>
  </div>
</section>
""".format(name=e(name), short=e(short), servicing=servicing, sources=sources,
           jobs=jobs, places=places)


def schema(p):
    name = p['name']
    url = '%s/plumber-%s/' % (ORIGIN, p['slug'])
    area = ', '.join('{"@type":"Place","name":"%s"}' % x.replace('"', '')
                     for x in [name] + p['places'])
    return """<script type="application/ld+json">
{{
  "@context":"https://schema.org",
  "@type":"Plumber",
  "name":"Wilkin Plumbing",
  "url":"{url}",
  "image":"{origin}/brand/logo/wilkin-logo.png",
  "description":"Licensed journeyman plumber based in Barrie, serving {name}. Residential and commercial plumbing, water heaters, backflow prevention, wells and water treatment, sewer lines, bathroom renovations.",
  "telephone":"+1-705-888-2651",
  "email":"info@wilkinplumbing.ca",
  "address":{{"@type":"PostalAddress","streetAddress":"270 Kozlov St","addressLocality":"Barrie","addressRegion":"ON","postalCode":"L4N 7H6","addressCountry":"CA"}},
  "areaServed":[{area}],
  "openingHoursSpecification":{{"@type":"OpeningHoursSpecification","dayOfWeek":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"opens":"06:00","closes":"22:00"}},
  "priceRange":"$$"
}}
</script>
<script type="application/ld+json">
{{
  "@context":"https://schema.org",
  "@type":"BreadcrumbList",
  "itemListElement":[
    {{"@type":"ListItem","position":1,"name":"Home","item":"{origin}/"}},
    {{"@type":"ListItem","position":2,"name":"Plumber in {name}","item":"{url}"}}
  ]
}}
</script>""".format(url=url, origin=ORIGIN, name=e(name), area=area)


def render(p, base):
    name = p['name']
    short = p.get('short', name)
    url = '%s/plumber-%s/' % (ORIGIN, p['slug'])
    title = 'Plumber in %s | Wilkin Plumbing · %s' % (name, PHONE_TEXT)
    desc = ('Plumber in %s. Roy at Wilkin Plumbing — licensed journeyman, backflow certified, '
            'based in Barrie. Repairs, water heaters, wells and treatment, bathrooms. '
            'Call %s.' % (name, PHONE_TEXT))
    s = base

    # --- head -------------------------------------------------------------
    s = sub1(r'<title>.*?</title>', '<title>%s</title>' % e(title), s, 'title')
    s = sub1(r'<meta name="description" content=".*?">',
             '<meta name="description" content="%s">' % e(desc), s, 'meta description')
    s = sub1(r'<link rel="canonical" href=".*?">',
             '<link rel="canonical" href="%s">' % url, s, 'canonical')
    s = sub1(r'<meta property="og:title" content=".*?">',
             '<meta property="og:title" content="%s">' % e(title), s, 'og:title')
    s = sub1(r'<meta property="og:description" content=".*?">',
             '<meta property="og:description" content="%s">' % e(desc), s, 'og:description')
    s = sub1(r'<meta property="og:url" content=".*?">',
             '<meta property="og:url" content="%s">' % url, s, 'og:url')

    # --- hero -------------------------------------------------------------
    s = sub1(r'<span data-edit="hero-eyebrow" class="eyebrow">.*?</span>',
             '<span class="eyebrow">%s · Residential &amp; Commercial</span>'
             % e(p.get('eyebrow', 'Simcoe County %s' % p['kind'])), s, 'hero eyebrow')
    s = sub1(r'<h1 data-edit="hero-title">.*?</h1>',
             '<h1>Plumber in <em>%s.</em></h1>' % e(name), s, 'hero h1')
    s = sub1(r'<p data-edit="hero-sub" class="hero-sub">.*?</p>',
             '<p class="hero-sub">%s</p>' % e(p['lede']), s, 'hero sub')
    s = sub1(r'<div data-edit="hero-hours" class="scroll-cue">.*?</div>',
             '<div class="scroll-cue">%s · open daily 6am to 10pm</div>' % e(p['drive']),
             s, 'hero hours')

    # --- contact heading --------------------------------------------------
    s = sub1(r'<h2 data-edit="contact-h2">.*?</h2>',
             '<h2>Book a plumber in %s.</h2>' % e(short), s, 'contact h2')

    # --- locale sections, dropped in ahead of the work gallery -------------
    s = sub1(r'\n<!-- ===== PROJECTS ===== -->',
             local_sections(p) + '\n<!-- ===== PROJECTS ===== -->', s, 'projects anchor')

    # --- service areas: current municipality is a label, not a link --------
    s = sub1(r'<li><a href="/plumber-%s/">.*?</a></li>' % re.escape(p['slug']),
             '<li><span aria-current="page">%s</span></li>'
             % e(BY_SLUG[p['slug']].get('short', name)), s, 'areas self-link')
    s = sub1(r'(?=\n    </ul>\n  </div>\n</section>\n\n<!-- ===== CONTACT)',
             '\n      <li><a href="/">Wilkin Plumbing home</a></li>', s, 'areas home link')

    # --- schema -----------------------------------------------------------
    s = sub1(r'<script type="application/ld\+json">.*?</script>', schema(p), s, 'json-ld')

    # --- asset paths: page lives one level down, so relative src won't do --
    s = re.sub(r'(src|href)="(brand/|assets/)', r'\1="/\2', s)

    # --- admin markers belong to index.html only --------------------------
    s = re.sub(r' data-(edit|slot)="[^"]*"', '', s)

    return s


def build_sitemap():
    urls = ['%s/' % ORIGIN] + ['%s/plumber-%s/' % (ORIGIN, p['slug']) for p in PLACES]
    body = '\n'.join('  <url><loc>%s</loc></url>' % u for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            '%s\n</urlset>\n' % body)


def build_robots():
    return 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % ORIGIN


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='verify files match what would be generated; exit 1 if not')
    args = ap.parse_args()

    with open(INDEX, encoding='utf-8') as fh:
        base = fh.read()

    files = {}
    for p in PLACES:
        files[os.path.join(SITE, 'plumber-%s' % p['slug'], 'index.html')] = render(p, base)
    files[os.path.join(SITE, 'sitemap.xml')] = build_sitemap()
    files[os.path.join(SITE, 'robots.txt')] = build_robots()

    stale = []
    for path, content in sorted(files.items()):
        rel = os.path.relpath(path, ROOT)
        if args.check:
            existing = None
            if os.path.exists(path):
                with open(path, encoding='utf-8') as fh:
                    existing = fh.read()
            if existing != content:
                stale.append(rel)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(content)
        print('wrote', rel)

    if args.check:
        if stale:
            print('stale (re-run without --check):\n  ' + '\n  '.join(stale))
            return 1
        print('%d generated files are current' % len(files))
    return 0


if __name__ == '__main__':
    sys.exit(main())
