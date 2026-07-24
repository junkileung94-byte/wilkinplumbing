#!/usr/bin/env python3
"""One-time (idempotent) tagger for site/index.html.

Adds the markers the Wilkin admin server reads:
  data-slot="..."  on <img> the admin can swap/crop
  data-edit="..."  on text nodes the admin can edit in place

Every replacement is an exact-string swap against the current HTML, so running
this twice is a no-op (the tagged form no longer matches the untagged anchor).
Re-run safely after hand-edits; it only touches lines it recognises.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "site", "index.html")

# --- images: (exact <img ...> string, slot id, replace_all) ---------------
# Shared-source images share a slot id so one apply updates every copy.
IMAGES = [
    ('<img src="../brand/photos/branding/wilkin-van-sunset.jpg" alt="">',
     "hero-van", False),
    ('<img src="../brand/photos/branding/wilkin-van-sunset.jpg" alt="The Wilkin Plumbing work van at sunset" fetchpriority="high">',
     "hero-van", False),
    ('<img src="../brand/logo/wilkin-logo.png" alt="Wilkin Plumbing logo">',
     "logo", True),   # nav + footer, same slot
    ('<img src="../brand/photos/portrait/roy-headshot.jpg" alt="Roy, owner of Wilkin Plumbing">',
     "roy", False),
    ('<img src="../brand/photos/projects/freestanding-tub-01.jpg" alt="Modern freestanding bathtub with floor-mounted faucet" loading="lazy">',
     "project-1", False),
    ('<img src="../brand/photos/projects/tiled-walkin-shower-black.jpg" alt="Tiled walk-in shower with black fixtures" loading="lazy">',
     "project-2", False),
    ('<img src="../brand/photos/projects/double-vanity-bathroom.jpg" alt="Double-sink vanity in a large bathroom" loading="lazy">',
     "project-3", False),
    ('<img src="../brand/photos/projects/glass-shower-enclosure.jpg" alt="Glass shower enclosure" loading="lazy">',
     "project-4", False),
    ('<img src="../brand/photos/projects/freestanding-tub-mosaic.jpg" alt="Freestanding tub with mosaic tile surround" loading="lazy">',
     "project-5", False),
    ('<img src="../brand/photos/projects/bathroom-sink-basin.jpg" alt="Drop-in sink basin with new faucet" loading="lazy">',
     "project-6", False),
    ('<img src="../brand/photos/projects/bath-tub-shower-combo.jpg" alt="Tiled tub and shower combination" loading="lazy">',
     "project-7", False),
    ('<img src="../brand/photos/projects/utility-bar-sink.jpg" alt="Utility bar sink in white cabinet" loading="lazy">',
     "project-8", False),
    ('<img src="../brand/logo/partner-excalibur.jpg" alt="Excalibur Water Systems authorized dealer badge">',
     "partner", False),
    ('<img src="../brand/photos/services/under-sink-drain-ptrap.jpg" alt="" aria-hidden="true" loading="lazy">',
     "contact-bg", False),
]

# --- text: (exact opening tag, data-edit id) ------------------------------
# Opening tag must be unique in the doc, OR made unique below via the element
# form (opening+inner+closing) when the bare tag repeats.
# We add ` data-edit="id"` immediately after the tag name.
TEXT_TAGS = [
    # hero
    ('<span class="eyebrow">Residential &amp; Commercial · Barrie + Orillia</span>', "hero-eyebrow"),
    ('<h1>Reliable plumbing <em>you can trust.</em></h1>', "hero-title"),
    ('<p class="hero-sub">When you call me, you get me. Not a call centre, not a big crew. Just Roy, a licensed journeyman plumber who treats your home like his own.</p>', "hero-sub"),
    ('<div class="scroll-cue">Open daily 6am to 10pm</div>', "hero-hours"),
    # trust strip
    ('<b>20 yrs</b>', "trust-1-b"), ('<span>In the trade</span>', "trust-1-s"),
    ('<b>Licensed</b>', "trust-2-b"), ('<span>Journeyman plumber</span>', "trust-2-s"),
    ('<b>Certified</b>', "trust-3-b"), ('<span>Backflow prevention</span>', "trust-3-s"),
    ('<b>6am–10pm</b>', "trust-4-b"), ('<span>Open every day</span>', "trust-4-s"),
    # story
    ('<span class="eyebrow">The person behind the wrench</span>', "story-eyebrow"),
    ('<h2>When you call me,<br>you get me.</h2>', "story-h2"),
    ("<p>Hi, I'm Roy. I'm a licensed and skilled journeyman plumber with 20 years in the trade. I'm originally from the UK, and in January 2021 my family and I moved to Barrie to build something of our own.</p>", "story-p1"),
    ('<p>I started out with a local plumbing company, and it showed me exactly what I wanted to bring to this community. A more personal service. Real attention to detail. Fair, honest pricing.</p>', "story-p2"),
    ("<p>For me, plumbing isn't only about fixing the problem. It's about making sure you feel looked after. I pay close attention to the details, and I treat every home as if it were mine.</p>", "story-p3"),
    ('<blockquote class="pull">"I show up when I say I will, I\'m honest and upfront, and the job isn\'t finished until you\'re completely happy."</blockquote>', "story-quote"),
    ('<b>Roy Wilkin</b>', "story-sign-name"),
    ('<span>Wilkin Plumbing, Barrie ON</span>', "story-sign-loc"),
    # services header
    ('<span class="eyebrow">What I do</span>', "svc-eyebrow"),
    ('<h2>Plumbing done properly, start to finish.</h2>', "svc-h2"),
    ('<p>One plumber, one standard. From a dripping tap to a full bathroom renovation, here is how I can help.</p>', "svc-p"),
    # services (8)
    ('<h3>Residential Plumbing</h3>', "svc-1-h"),
    ('<p>Leaky faucets, clogged drains and blocked pipes. Fast, reliable fixes you can count on.</p>', "svc-1-p"),
    ('<h3>Commercial Plumbing</h3>', "svc-2-h"),
    ('<p>Work that fits around your business, so your day keeps moving with minimal disruption.</p>', "svc-2-p"),
    ('<h3>Backflow Prevention</h3>', "svc-3-h"),
    ('<p>Cross connection testing, surveys, install and repair. Fully compliant with the municipality.</p>', "svc-3-p"),
    ('<h3>Water Heater Repair &amp; Install</h3>', "svc-4-h"),
    ('<p>Diagnose and repair fast, or install new. I work on all types of water heater.</p>', "svc-4-p"),
    ('<h3>Sewer Line Services</h3>', "svc-5-h"),
    ('<p>Clogs, backups and tree root infiltration, cleared and repaired properly.</p>', "svc-5-p"),
    ('<h3>Home Inspection</h3>', "svc-6-h"),
    ('<p>A full visual plumbing check for buyers and owners, with a clear plan to fix any faults.</p>', "svc-6-p"),
    ('<h3>Bathroom Renovation</h3>', "svc-7-h"),
    ('<p>Full renovations including tile, electrical and building work. Start to finish, I handle it.</p>', "svc-7-p"),
    ('<h3>Plumbing Maintenance</h3>', "svc-8-h"),
    ('<p>Preventive upkeep that keeps small issues from turning into costly repairs.</p>', "svc-8-p"),
    # work header
    ('<span class="eyebrow">Recent work</span>', "work-eyebrow"),
    ('<h2>Bathrooms and fixtures, taken from start to finish.</h2>', "work-h2"),
    ("<p>A few of the jobs I've completed around Barrie and Orillia.</p>", "work-p"),
    # reviews header
    ('<span class="eyebrow">Straight from Google</span>', "rev-eyebrow"),
    ('<h2>What Barrie neighbours say.</h2>', "rev-h2"),
    ("<p>Real reviews from Roy's Google Business Profile. Read every one on Google.</p>", "rev-p"),
    ('<span class="meta"><b>4.9 out of 5</b> from 31 Google reviews</span>', "rev-score-meta"),
    # pricing
    ('<span class="eyebrow">No surprises</span>', "price-eyebrow"),
    ('<h2>Honest, upfront pricing.</h2>', "price-h2"),
    ('<p>Charged on time and materials, so you only pay for the work the job actually needs.</p>', "price-p"),
    ('<span class="amt">$140 + tax</span>', "price-amt-1"),
    ('<span class="amt">$120 + tax</span>', "price-amt-2"),
    ('<span class="amt">On request</span>', "price-amt-3"),
    ('<p class="price-note">Some supplied items, like toilets and faucets, have set prices. Everything is based on the time and materials needed to do the job right.</p>', "price-note"),
    ('<h3>Most estimates cost nothing.</h3>', "freequote-h3"),
    ("<p>I can often quote straight from a few photos you send me. For bigger projects I'm happy to do a site visit at no cost.</p>", "freequote-p"),
    # faq header
    ('<span class="eyebrow">Good to know</span>', "faq-eyebrow"),
    ('<h2>Questions I get asked.</h2>', "faq-h2"),
    # faq answers (div.ans has text only)
    ("<div class=\"ans\">Sinks, toilets, showers, bathtubs and much more. I usually supply and install the fixtures myself, but I'm happy to work with items you've bought. If it's plumbing related, I can install it.</div>", "faq-1-a"),
    ('<div class="ans">It depends on the issue and how complex it is to fix. My pricing is based on time and materials. There\'s a standard service call of $140 + tax that covers the first hour, with materials charged separately. Additional hours are $120 + tax.</div>', "faq-2-a"),
    ("<div class=\"ans\">Most estimates are free, and I can often quote from photos you send me. For bigger projects I'll do a site visit at no cost. These are usually at set times in the week, so you may need to be flexible. A visit at a time that suits you better may carry a small fee.</div>", "faq-3-a"),
    ('<div class="ans">Wilkin Plumbing is run by me, Roy. For larger jobs I bring in a few trusted journeyman plumbers, but they always work alongside me. I\'m on site to make sure every job meets my standard.</div>', "faq-4-a"),
    # partner
    ('<b>Authorized Dealer</b>', "partner-b"),
    ('<span>Excalibur Water Systems. Water treatment and filtration, supplied and installed.</span>', "partner-s"),
    # contact
    ('<span class="eyebrow">Get in touch</span>', "contact-eyebrow"),
    ("<h2>Let's get it sorted.</h2>", "contact-h2"),
    ("<p>Need a quote, got a question, or want to book a visit? Reach out and I'll make the whole thing easy.</p>", "contact-p"),
    ('<span class="big">705 888 2651</span>', "contact-phone"),
    ('<span>info@wilkinplumbing.ca</span>', "contact-email"),
    ('<span>Open every day, 6am to 10pm</span>', "contact-hours"),
    # footer
    ('<span>Reliable plumbing you can trust</span>', "foot-tag"),
    ('<p class="foot-legal">© 2024 Wilkin Plumbing. All rights reserved.</p>', "foot-legal"),
]

# faq questions: wrap the question text in a data-edit span, keep the .plus icon
FAQ_QUESTIONS = [
    ("What fixtures can you install?", "faq-1-q"),
    ("How much will it cost?", "faq-2-q"),
    ("Do you charge for estimates?", "faq-3-q"),
    ("How many plumbers are on staff?", "faq-4-q"),
]


def add_attr_to_open_tag(tag_str, attr):
    """`<h2 ...>` -> `<h2 attr ...>` (insert right after the tag name)."""
    i = tag_str.index("<") + 1
    j = i
    while j < len(tag_str) and (tag_str[j].isalnum()):
        j += 1
    return tag_str[:j] + " " + attr + tag_str[j:]


def main():
    html = open(INDEX, encoding="utf-8").read()
    orig = html
    img_done = text_done = 0

    for old, slot, all_ in IMAGES:
        new = add_attr_to_open_tag(old, 'data-slot="%s"' % slot)
        if new in html:
            continue                      # already tagged
        if old not in html:
            print("!! IMG anchor not found: %s" % slot, file=sys.stderr)
            continue
        html = html.replace(old, new, -1 if all_ else 1)
        img_done += 1

    for old, eid in TEXT_TAGS:
        new = add_attr_to_open_tag(old, 'data-edit="%s"' % eid)
        if new in html:
            continue
        if old not in html:
            print("!! TEXT anchor not found: %s" % eid, file=sys.stderr)
            continue
        html = html.replace(old, new, 1)
        text_done += 1

    for q, eid in FAQ_QUESTIONS:
        old = "<summary>%s<span class=\"plus\"></span></summary>" % q
        new = '<summary><span data-edit="%s">%s</span><span class="plus"></span></summary>' % (eid, q)
        if new in html:
            continue
        if old not in html:
            print("!! FAQ anchor not found: %s" % eid, file=sys.stderr)
            continue
        html = html.replace(old, new, 1)
        text_done += 1

    if html != orig:
        open(INDEX, "w", encoding="utf-8").write(html)
    print("tagged: %d images, %d text nodes (%s)"
          % (img_done, text_done, "written" if html != orig else "no change"))


if __name__ == "__main__":
    main()
