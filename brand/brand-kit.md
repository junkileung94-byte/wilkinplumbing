# Wilkin Plumbing — Brand Kit

> Source: existing GoDaddy site (`wilkinplumbing.ca`), harvested 2026-07-23.
> Colours sampled directly from the logo PNG (authoritative), neutrals from site CSS.

## Core colours (2)

| Role | Hex | RGB | Use |
|------|-----|-----|-----|
| **Primary — Navy** | `#002D72` | 0, 45, 114 | Logo ring/text, headers, primary buttons, footer. ≈ PMS 288. |
| **Primary — Orange** | `#FF6400` | 255, 100, 0 | Logo fill/icon, accents, CTAs, highlights, hover. |

The brand is a **two-colour** system: deep navy + vivid orange. High contrast,
trustworthy + energetic, classic trade/industrial pairing.

> Note: old site CSS used slightly-off approximations — navy `#002855`/`#002C75`
> and orange `#FF4500` (OrangeRed). Use the logo-accurate values above.

## Supporting neutrals

| Role | Hex |
|------|-----|
| White | `#FFFFFF` |
| Paper / off-white | `#F7F6F5` |
| Text — dark | `#303030` |
| Text — muted | `#5E5E5E` |

## Suggested extended ramp (for UI depth — derived, optional)

| Token | Hex |
|-------|-----|
| navy-900 | `#001B45` |
| navy-700 | `#002D72` (base) |
| navy-500 | `#1E4C9A` |
| orange-600 | `#E65A00` |
| orange-500 | `#FF6400` (base) |
| orange-300 | `#FF9147` |

## Logo

- **Primary mark**: circular badge — orange disc, navy ring + faucet-with-water-drop icon,
  arched text "WILKIN PLUMBING" (top) / "COMMERCIAL & RESIDENTIAL" (bottom).
- File: `logo/wilkin-logo.png` — 1080×1080, transparent RGBA.
- Works on white, paper, and navy backgrounds (has its own coloured disc).
- ⚠️ No horizontal/wordmark lockup or mono/reversed version exists — **create these** in the rebuild
  (horizontal lockup for header, single-colour navy + single-colour white variants for footer/favicon).

## Typography

- No brand font specified on the old site (GoDaddy default sans).
- **Recommendation for rebuild**: a strong geometric/grotesk pairing that reads industrial-trustworthy
  (final choice made by hallmark in the build scope). Keep the badge's uppercase, slightly-condensed
  feel for headings.

## Voice & tone

Personal, honest, hands-on solo tradesman. "When you call me, you get me." First-person ("I", "my").
Emphasis: reliability, showing up on time, attention to detail, fair pricing, treating your home as his own.
Not corporate, not salesy — a trusted local expert.

## Brand assets index

- Logo: `logo/wilkin-logo.png`
- Partner badge: `logo/partner-excalibur.jpg` (Excalibur Water Systems — Authorized Dealer)
- Owner portrait: `photos/portrait/roy-headshot.jpg`
- Brand hero: `photos/branding/wilkin-van-sunset.jpg` (branded work van)
- See `MANIFEST.md` for the full photo library.
