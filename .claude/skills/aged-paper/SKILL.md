---
name: aged-paper
description: Generate "aged page in a book" parchment surfaces for BookWorm — warm tea-stained / antique-ivory / candlelit paper backgrounds via pure CSS (SVG feTurbulence) or a Pillow texture generator, plus the ink-typography component recipe. Use when a BookWorm view should look like an old book page, journal, ledger, or vintage document.
---

# Aged-paper surfaces for BookWorm

A repeatable recipe for turning a plain view into an "aged page in a book". First
shipped on the CRM contact detail view (`static/css/crm-aged-paper.css` +
`static/js/home-page-crm-detail.js`). Use that file as the canonical reference
implementation.

## Two ways to make the paper

**A — Pure CSS + SVG (preferred for the web).** Resolution-independent, ~0 bytes,
theme-able, no asset to regenerate or cache-bust separately. The grain is an
inline SVG `feTurbulence` tile, soft-light-blended over a sepia base, with radial
foxing stains and an inset vignette:

```css
.paper {
  background-color: #e7d5ad;                 /* tea-stained base */
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23p)'/%3E%3C/svg%3E"),
    radial-gradient(120% 90% at 50% 0%, rgba(255,250,235,.6), transparent 55%),
    radial-gradient(90% 70% at 82% 22%, rgba(150,110,60,.13), transparent 60%);
  background-size: 200px 200px, auto, auto;
  background-blend-mode: soft-light, normal, normal;
  box-shadow: inset 0 0 140px rgba(90,60,25,.30), 0 18px 40px rgba(0,0,0,.45);
}
```
Add `::before` with a left `linear-gradient` for the book binding/gutter, and
`::after` on the right for a page-curl shadow. Put the sheet on a dark
`radial-gradient` "desk" backdrop so it floats.

**B — Pillow texture tile (for extra realism / non-web use).** Run the generator:

```
python .claude/skills/aged-paper/paper_texture.py            # writes 3 sample swatches to /tmp
python .claude/skills/aged-paper/paper_texture.py out.png 1600 2000 tea   # one full page
```
It uses only built-in PIL (`Image.effect_noise`, `ImageChops`, `ImageFilter`) —
no numpy / `noise` package, so nothing new to `pip install` (Pillow is already a
BookWorm dependency, used by `bw_pwa_icons.py`). Serve the PNG from `static/img/`
and layer it at low opacity over approach A if you want photographic fibers.

## Palettes (base / edge / ink)

| Name          | base      | edge dark | ink       | stain        |
|---------------|-----------|-----------|-----------|--------------|
| Tea-stained   | `#e7d5ad` | `#cdb682` | `#3a2c1a` | `#a9824c`    |
| Antique ivory | `#ece1c5` | `#d8c79b` | `#42351f` | `#b89b6a`    |
| Candlelit     | `#4a3a28` | `#1c150e` | `#e8d8b8` | `#241a10`    |

## Ink-typography component recipe

- Serif stack: `Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif`
  (no web-font download — avoids the CDN/cache pitfalls in CODEPUPPY_NOTES).
- Section headers: small-caps feel via `text-transform:uppercase; letter-spacing:.18em;`
  with a `border-bottom` ink rule.
- Entries: separate rows with `1px dotted rgba(122,90,42,.35)`.
- Tags/labels → "rubber stamps": uppercase, 1.5px ink outline, `transform:rotate(±1.5deg)`,
  alternate hue + tilt with `:nth-child(even)`.
- Photos → "tipped-in": small white mat, `transform:rotate(-2deg)`, drop shadow,
  L-shaped mounting corners via `::before/::after` borders, `filter:sepia(.45)` on the img.

## BookWorm guardrails (always)

- Scope every selector under one root class (e.g. `.crm-aged-wrap`) so it can't leak.
- Cache-bust the stylesheet: `<link ... href="/static/css/X.css?v={{ static_v }}">`.
- Add scoped `:where(.text-gray-*, .dark\:text-zinc-*) { color: … !important }` overrides
  so async-injected child widgets (conversations, etc.) retint into the paper.
- Mobile: the sheet lives in a scroll container — keep `min-w-0`, let it scroll, test the
  PWA. See CODEPUPPY_NOTES mobile rules.
