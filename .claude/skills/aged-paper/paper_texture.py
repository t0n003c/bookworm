"""Aged-paper texture generator for BookWorm (skill: aged-paper).

Pure-Pillow (no numpy / no `noise` package) generator for warm aged-paper
backgrounds — grain + long fibers + foxing stains + a coffee ring + vignette.
Pillow is already a BookWorm dependency (see bw_pwa_icons.py).

Usage:
    python paper_texture.py                          # 3 sample swatches → /tmp/paper_compare.png
    python paper_texture.py out.png 1600 2000 tea    # one page (w h palette) → out.png

Palettes: tea | ivory | candlelit
"""
import sys
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# palette = (base_top, base_bottom, stain_rgb, edge_rgb)
PALETTES = {
    "tea":       ((238, 226, 197), (214, 193, 150), (120, 84, 38),  (150, 120, 70)),
    "ivory":     ((245, 240, 224), (228, 219, 193), (150, 120, 70), (170, 150, 110)),
    "candlelit": (( 72,  58,  40), ( 48,  38,  26), ( 20, 14,  8),  ( 24,  18, 10)),
}


def paper(w, h, palette="tea", seed=1):
    """Return an RGB aged-paper Image of size (w, h)."""
    top, bot, stain, edge = PALETTES[palette]
    random.seed(seed)

    # vertical sepia base gradient
    base = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)))

    # fine grain (paper tooth) — soft-light blended
    grain = Image.effect_noise((w, h), 14).filter(ImageFilter.GaussianBlur(0.3))
    base = ImageChops.overlay(base, Image.merge("RGB", (grain, grain, grain)))

    # long fibers — low-frequency noise stretched + blurred
    fib = (Image.effect_noise((max(1, w // 5), max(1, h // 3)), 26)
           .resize((w, h)).filter(ImageFilter.GaussianBlur(1.2)))
    base = ImageChops.overlay(base, Image.merge("RGB", (fib, fib, fib)))

    # foxing / coffee stains + one coffee ring
    stains = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stains)
    for _ in range(7):
        cx, cy = random.randint(0, w), random.randint(0, h)
        r = random.randint(int(w * 0.05), int(w * 0.16))
        a = random.randint(8, 24)
        sd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*stain, a))
    cx, cy, r = int(w * 0.66), int(h * 0.24), int(w * 0.12)
    sd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(*stain, 40), width=max(2, w // 120))
    stains = stains.filter(ImageFilter.GaussianBlur(int(w * 0.02)))
    base = Image.alpha_composite(base.convert("RGBA"), stains).convert("RGB")

    # vignette — darken toward the edges
    vig = Image.new("L", (w, h), 0)
    ImageDraw.Draw(vig).ellipse(
        [int(-w * 0.15), int(-h * 0.12), int(w * 1.15), int(h * 1.12)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(int(w * 0.12)))
    base = Image.composite(base, Image.new("RGB", (w, h), edge), vig)
    return base


def _samples(path="/tmp/paper_compare.png"):
    W, H = 360, 460
    names = ["tea", "ivory", "candlelit"]
    imgs = [paper(W, H, p, seed=3 + i * 4) for i, p in enumerate(names)]
    gap, lab = 24, 30
    canvas = Image.new("RGB", (W * 3 + gap * 4, H + lab + gap * 2), (33, 33, 33))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
    for i, (name, img) in enumerate(zip(names, imgs)):
        x = gap + i * (W + gap)
        canvas.paste(img, (x, gap + lab))
        d.text((x, gap + 4), name, fill=(230, 230, 230), font=font)
    canvas.save(path)
    print("wrote", path)


if __name__ == "__main__":
    if len(sys.argv) >= 4:
        out = sys.argv[1]
        w, h = int(sys.argv[2]), int(sys.argv[3])
        pal = sys.argv[4] if len(sys.argv) > 4 else "tea"
        paper(w, h, pal).save(out)
        print("wrote", out)
    else:
        _samples()
