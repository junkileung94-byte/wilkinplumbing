# Design Scope — Wilkin Plumbing (new build)

Build scope produced with **Hallmark** (custom / tuned route). Fresh visual direction,
anchored on the existing logo + brand colours. Static **HTML + Tailwind**. This file is the
system of record for the rebuild — pages defer to it; amend intentionally.

Pre-emit critique: P5 H4 E4 S5 R4 V4

## System
- **Genre** · modern-minimal, tactile-trade (honest, solid, local)
- **Theme route** · custom — *tuned* (named brand colours: navy + orange)
- **Vibe** · "honest local trade, navy + orange, solid, hands-on"
- **Axes** · light / display-condensed-bold / warm+cool (dual anchor)
- **Anchor logic** · **Navy = structure** (header, footer, brand surfaces, headings). **Orange = signal** (CTAs, active state, icons, accents). Mirrors the badge: navy text on orange.

## Tokens (OKLCH · source of truth = `brand/tokens.json` → export to `tokens.css`)
```css
:root {
  /* brand */
  --color-navy:        oklch(32.0% 0.128 260);  /* #002D72 logo navy */
  --color-navy-900:    oklch(22.0% 0.070 262);  /* deep surface/footer */
  --color-orange:      oklch(69.3% 0.206 43);   /* #FF6400 logo orange (chroma > cap — real brand value, kept) */

  /* neutrals — tinted toward navy */
  --color-paper:       oklch(97.5% 0.004 250);
  --color-paper-2:     oklch(94.5% 0.006 250);
  --color-ink:         oklch(25.0% 0.050 262);
  --color-ink-2:       oklch(42.0% 0.030 262);
  --color-rule:        oklch(86.0% 0.008 250);
  --color-muted:       oklch(50.0% 0.020 258);

  /* accent + state */
  --color-accent:      var(--color-orange);
  --color-accent-ink:  var(--color-navy);   /* navy text on orange (L>50 → dark ink) */
  --color-focus:       oklch(66.0% 0.210 43);

  --font-display: "Barlow Condensed", "Oswald", sans-serif;  /* uppercase, echoes badge */
  --font-body:    "Geist", system-ui, sans-serif;            /* NOT Inter/Roboto (Gate 1) */
  --font-mono:    "Geist Mono", monospace;                   /* phone/specs */

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 180ms; --dur-base: 240ms; --dur-slow: 320ms;
  --radius-card: 10px; --radius-pill: 999px; --radius-input: 8px;
}
```
All free fonts. Spacing = 4pt scale (`--space-3xs … --space-4xl`); type scale 1.25.

## Typography
- **Display** · Barlow Condensed 700/800, uppercase for section heads — carries the badge's condensed-cap voice. Roman only (no italic headers).
- **Body** · Geist 400/500, measure 45–75ch, ≥16px.
- Emphasis via weight/orange accent/drawn underline — never italic headings.

## CTA voice
- **Primary** · orange fill, navy ink, `--radius-pill`, generous padding. Label = action ("Get a free quote", "Call 705 888 2651").
- **Secondary** · navy outline / ghost, same radius.
- One primary action per view; phone number is always tap-to-call on mobile.

## Motion stance
- Restrained: 1–2 reveal primitives (fade-up on section enter). No parallax carnival.
- `prefers-reduced-motion` → ≤150ms opacity crossfade only.

---

## Page set + macrostructure (12) — pages share the SYSTEM, vary the STRUCTURE

| # | Page | Macrostructure | Core sections |
|---|------|----------------|---------------|
| 1 | **Home** | **08 Photographic** | Hero = branded van at sunset + tagline "Reliable Plumbing You Can Trust" + tap-to-call · service teaser (8) · "When you call me, you get me" story (Split block w/ Roy headshot) · recent projects gallery · reviews strip · FAQ (accordion) · partners (Excalibur) · contact CTA |
| 2 | **Services hub** | **11 Catalogue** | Uniform grid of 8 service cards (icon + name + one line), each links to its page |
| 3–10 | **8 service pages** | **15 Split Studio** | Diptych: service photo ∥ description + what's included + pricing note + local CTA. Cross-link related services. One per: Residential · Commercial · Backflow · Water Heater · Sewer Line · Home Inspection · Bathroom Renovation · Maintenance |
| 11 | **Reviews** | **09 Quote-Led** | Pull-quote testimonials + name/area. ⚠️ **Copy gap** — no testimonials on old site; pull from Google Business Profile / Nextdoor, or collect from Roy before build |
| 12 | **Service Area** | **19 Map / Diagram** | Barrie + Orillia coverage map, NAP, "areas served" list — local-SEO page |
| 13 | **Contact** | **15 Split Studio** | Form (Name · Email · Phone · Date/Time) ∥ NAP + hours + map. reCAPTCHA. Tap-to-call. |

(13 URLs total: home, services hub, 8 service pages, reviews, service-area, contact.)

## Imagery kit → sections (from `brand/`)
- **Home hero / banner** · `photos/branding/wilkin-van-sunset.jpg`
- **Story / About / Meet Roy** · `photos/portrait/roy-headshot.jpg` (+ `roy-wilkins-walk-sign.jpg` for local flavour)
- **Service page heroes** · `photos/services/water-heater-install.jpg`, `backflow-expansion-tank.jpg`, `under-sink-drain-ptrap.jpg`; bathroom-reno services pull from `photos/projects/*`
- **Recent projects gallery** · all `photos/projects/*` (freestanding tubs, showers, vanities)
- **Partners strip** · `logo/partner-excalibur.jpg`
- **Header/footer/favicon** · `logo/wilkin-logo.png` → also produce horizontal lockup + mono-navy + mono-white variants (missing today)

## Copy
- Reuse `content/copy.md` verbatim where possible; tighten for web. Voice = first-person, honest, local.
- **Honest-copy rule**: no invented stats/reviews. Pricing block uses the real figures ($140+tax first hr, $120+tax add'l). Reviews page stays empty/placeholder until real testimonials supplied.

## Build stack
- Static **HTML + Tailwind v4** (`@theme` fed from `brand/tokens.json`).
- Google Fonts: Barlow Condensed + Geist (self-host for speed).
- Per-page `<title>`/meta + LocalBusiness/Plumber JSON-LD schema (NAP, hours, area) for local SEO.
- Sitemap + `robots.txt`; alt text on every image; APCA/WCAG contrast on navy/orange.
- Contact form → simple handler (Formspree/Netlify Forms or GoDaddy email) + reCAPTCHA.

## Next steps (execution, separate task)
1. Approve this scope. 2. Generate logo lockup/mono variants + favicon. 3. Collect real reviews.
4. Run Hallmark **default build** (custom/tuned) page-by-page against this `design.md`.
5. Wire schema + forms + deploy static host.

## Provenance
Source: existing `wilkinplumbing.ca` (owner's own site). Assets + copy harvested 2026-07-23.
Colours logo-sampled; neutrals from site CSS. Fresh direction — not a clone of the GoDaddy layout.
