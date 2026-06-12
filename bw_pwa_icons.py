"""Generate PWA icon assets for BookWorm.

Produces PNG files inside static/img/icons/:
  icon-192.png          — standard 192×192 (rounded square)
  icon-512.png          — standard 512×512 (rounded square)
  icon-maskable-512.png — 512×512 full-bleed (Android adaptive safe-zone)
  apple-touch-icon.png  — 180×180 full-bleed square (iOS masks it itself)
  badge-96.png          — 96×96 white-on-transparent monochrome push badge

Files are only written when missing; call generate_icons(force=True) to redraw.

Design: a single bold, smooth amber worm with a friendly face (two eyes + a
little smile) on a clean blue gradient. Minimal and high-contrast so it reads
crisply from a 16 px favicon up to a 512 px home-screen icon.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

# ── Palette ─────────────────────────────────────────────────────────────────
_BG_TOP   = ( 56, 116, 240)   # bright brand blue   #3874f0
_BG_BOT   = ( 12,  42, 122)   # deep indigo         #0c2a7a
_YELLOW   = (251, 191,  36)   # warm amber          #fbbf24
_YLW_HI   = (254, 222, 130)   # amber highlight     #fede82
_YLW_DARK = (180,  83,   9)   # amber shadow/border #b45309
_WHITE    = (255, 255, 255)
_INK      = ( 24,  23,  28)   # near-black
_CHEEK    = (244, 114,  60, 90)   # RGBA soft blush

_OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "img", "icons")

# (filename, size, full_bleed)  — full_bleed=True fills the whole square (maskable
# / apple-touch); False draws a rounded square.
_SPECS = [
    ("icon-192.png",          192, False),
    ("icon-512.png",          512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png",  180, True),
]


def _gradient_square(s: int, top: tuple, bottom: tuple) -> Image.Image:
    """Vertical top→bottom gradient, RGBA, fully opaque."""
    img = Image.new("RGB", (s, s))
    d = ImageDraw.Draw(img)
    for y in range(s):
        t = y / max(1, s - 1)
        d.line(
            [(0, y), (s, y)],
            fill=(
                int(top[0] * (1 - t) + bottom[0] * t),
                int(top[1] * (1 - t) + bottom[1] * t),
                int(top[2] * (1 - t) + bottom[2] * t),
            ),
        )
    return img.convert("RGBA")


def _worm_path(s: int):
    """Sample points (x, y, r) along the worm body, tail→head.

    A gentle 1.5-hump wave reading left→right, the body tapering from a thin
    tail to a plump head that lifts up toward the top-right.
    """
    pts = []
    N = 240
    for i in range(N + 1):
        t = i / N
        x = 0.165 + 0.600 * t                              # 0.165s → 0.765s
        y = 0.580 - 0.090 * math.sin(t * math.pi * 1.85) - 0.090 * t
        r = 0.082 + 0.048 * (t ** 0.7)                     # chunky worm, slight taper
        pts.append((x * s, y * s, r * s))
    return pts


def _make_icon(size: int, full_bleed: bool) -> Image.Image:
    s = size
    base = _gradient_square(s, _BG_TOP, _BG_BOT)

    if not full_bleed:
        # rounded-square: keep the gradient inside the radius, clear the corners
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, s - 1, s - 1], radius=int(s * 0.225), fill=255
        )
        rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        rounded.paste(base, (0, 0), mask)
        base = rounded

    pts = _worm_path(s)

    # ── Soft drop shadow under the worm (depth) ──────────────────────────────
    sh = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for (x, y, r) in pts[::3]:
        sd.ellipse([x - r, y - r + s * 0.018, x + r, y + r + s * 0.018],
                   fill=(0, 0, 0, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(int(s * 0.02)))
    base = Image.alpha_composite(base, sh)
    d = ImageDraw.Draw(base)

    # ── Body: dark border pass, then amber fill (metaballs → smooth tube) ─────
    for (x, y, r) in pts:
        bd = r + max(1.5, s * 0.012)
        d.ellipse([x - bd, y - bd, x + bd, y + bd], fill=_YLW_DARK)
    for (x, y, r) in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=_YELLOW)

    # ── Soft top sheen along the body (single clean highlight) ───────────────
    hi = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    for (x, y, r) in pts[14:-6]:
        hr = r * 0.34
        cy = y - r * 0.48
        hd.ellipse([x - hr, cy - hr, x + hr, cy + hr], fill=(*_YLW_HI, 105))
    hi = hi.filter(ImageFilter.GaussianBlur(int(s * 0.014)))
    base = Image.alpha_composite(base, hi)
    d = ImageDraw.Draw(base)

    # ── Head + face (head = last, largest sample) ────────────────────────────
    hx, hy, hr = pts[-1]

    # rosy cheeks (subtle)
    ck = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    cd = ImageDraw.Draw(ck)
    ckr = hr * 0.30
    cd.ellipse([hx - hr * 0.62 - ckr, hy + hr * 0.28 - ckr,
                hx - hr * 0.62 + ckr, hy + hr * 0.28 + ckr], fill=_CHEEK)
    cd.ellipse([hx + hr * 0.64 - ckr, hy + hr * 0.30 - ckr,
                hx + hr * 0.64 + ckr, hy + hr * 0.30 + ckr], fill=_CHEEK)
    base = Image.alpha_composite(base, ck)
    d = ImageDraw.Draw(base)

    # eyes (looking up-right a touch), with catchlight
    er = hr * 0.30
    eoff = hr * 0.40
    ey = hy - hr * 0.12
    for ex in (hx - eoff, hx + eoff):
        d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=_WHITE)
        pr = er * 0.56
        pcx, pcy = ex + er * 0.10, ey + er * 0.08
        d.ellipse([pcx - pr, pcy - pr, pcx + pr, pcy + pr], fill=_INK)
        cr = max(1, er * 0.24)
        d.ellipse([pcx - pr * 0.5 - cr, pcy - pr * 0.5 - cr,
                   pcx - pr * 0.5 + cr, pcy - pr * 0.5 + cr], fill=_WHITE)

    # little smile
    sm = hr * 0.46
    smt = ey + hr * 0.34
    d.arc([hx - sm, smt, hx + sm, smt + sm * 0.95],
          start=18, end=162, fill=_INK, width=max(2, int(s * 0.018)))

    # ── Sparkle (a touch of fun) — 4-point star up and right of the head ──────
    spx, spy = hx + hr * 0.62, hy - hr * 1.18
    sl = s * 0.052
    sw = max(2, int(s * 0.012))
    d.line([(spx - sl, spy), (spx + sl, spy)], fill=_WHITE, width=sw)
    d.line([(spx, spy - sl), (spx, spy + sl)], fill=_WHITE, width=sw)
    d.ellipse([spx - sw, spy - sw, spx + sw, spy + sw], fill=_WHITE)

    return base


def _make_badge(size: int = 96) -> Image.Image:
    """White worm silhouette on transparent (Android push status-bar badge)."""
    W = (255, 255, 255, 255)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for (x, y, r) in _worm_path(size):
        d.ellipse([x - r, y - r, x + r, y + r], fill=W)
    return img


def generate_icons(out_dir: str = _OUT_DIR, force: bool = False) -> None:
    """Write PNG icons to *out_dir*. Skips existing files unless *force=True*."""
    os.makedirs(out_dir, exist_ok=True)

    for name, size, full_bleed in _SPECS:
        path = os.path.join(out_dir, name)
        if not force and os.path.exists(path):
            continue
        _make_icon(size, full_bleed).save(path, "PNG", optimize=True)

    badge_path = os.path.join(out_dir, "badge-96.png")
    if force or not os.path.exists(badge_path):
        _make_badge(96).save(badge_path, "PNG", optimize=True)


if __name__ == "__main__":
    generate_icons(force=True)
    print("icons regenerated")
