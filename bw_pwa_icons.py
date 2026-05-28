"""Generate PWA icon assets for BookWorm.

Produces five PNG files inside static/img/icons/:
  icon-192.png          — standard 192×192
  icon-512.png          — standard 512×512
  icon-maskable-512.png — 512×512 with safe-zone padding (Android adaptive)
  apple-touch-icon.png  — 180×180 for iOS Add-to-Home-Screen
  badge-96.png          — 96×96 white-on-transparent monochrome badge for
                          Android push notification status bar

Files are only written when missing; call generate_icons(force=True) to redraw.

Design: bookworm character — round amber worm with big expressive eyes,
round bookworm glasses, rosy cheeks, two body segments, sitting in an open
book on a deep forest-green rounded-square background.
"""
import os
from PIL import Image, ImageDraw

# ── Palette ─────────────────────────────────────────────────────────────────
_BG       = ( 27,  67,  50)   # deep forest green  #1b4332
_YELLOW   = (251, 191,  36)   # warm amber          #fbbf24
_YLW_DARK = (146,  64,  14)   # amber shadow        #92400e
_WHITE    = (255, 253, 245)   # warm off-white
_INK      = ( 28,  25,  23)   # near-black          #1c1917
_PG_R     = (254, 243, 199)   # warm parchment      #fef3c7
_LINE_L   = (253, 230, 138)   # warm tan            #fde68a
_LINE_R   = (252, 211,  77)   # golden              #fcd34d
_CHEEK    = (234,  88,  12, 110)  # RGBA — warm orange blush

_OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "img", "icons")

_SPECS = [
    ("icon-192.png",          192, False),
    ("icon-512.png",          512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png",  180, False),
]


# ── Compositing helper ───────────────────────────────────────────────────────
def _overlay(base: Image.Image, color_rgba: tuple, bbox: tuple) -> tuple:
    """Alpha-composite a semi-transparent ellipse onto *base*; return (img, draw)."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(bbox, fill=color_rgba)
    base = Image.alpha_composite(base, layer)
    return base, ImageDraw.Draw(base)


# ── Main drawing function ────────────────────────────────────────────────────
def _make_icon(size: int, maskable: bool) -> Image.Image:
    pad = int(size * 0.10) if maskable else 0
    s   = size  # shorthand
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # ── Blue rounded background ──────────────────────────────────────────────
    d.rounded_rectangle(
        [(pad, pad), (s - pad - 1, s - pad - 1)],
        radius=int(s * 0.22), fill=_BG,
    )

    # ════════════════════════════════════════════════════════════════════════
    # BOOK  (bottom third of icon, worm sits in it)
    # ════════════════════════════════════════════════════════════════════════
    bx  = int(s * 0.10)
    bw  = int(s * 0.80)
    bh  = int(s * 0.23)
    by  = int(s * 0.71)
    sp  = int(s * 0.03)          # spine half-width
    mid = bx + bw // 2

    d.rectangle([(bx,      by), (mid - sp,  by + bh)], fill=_WHITE)   # left page
    d.rectangle([(mid + sp, by), (bx + bw, by + bh)], fill=_PG_R)     # right page
    d.rectangle([(mid - sp, by - int(s * 0.01)),
                 (mid + sp, by + bh)], fill=_BG)                     # spine

    # text lines — left page
    lx0, lx1 = bx + int(s * 0.04), mid - sp - int(s * 0.03)
    lh  = max(2, int(s * 0.020))
    gap = int(s * 0.055)
    ly  = by + int(s * 0.04)
    for _ in range(3):
        if ly + lh < by + bh - int(s * 0.025):
            d.rectangle([(lx0, ly), (lx1, ly + lh)], fill=_LINE_L)
            ly += gap

    # text lines — right page (last line shorter)
    rx0, rx1 = mid + sp + int(s * 0.03), bx + bw - int(s * 0.04)
    ry = by + int(s * 0.04)
    for i in range(3):
        if ry + lh < by + bh - int(s * 0.025):
            x1 = rx1 if i < 2 else rx0 + int((rx1 - rx0) * 0.55)
            d.rectangle([(rx0, ry), (x1, ry + lh)], fill=_LINE_R)
            ry += gap

    # book cover bottom strip
    d.rounded_rectangle(
        [(bx, by + bh - int(s * 0.025)), (bx + bw, by + bh + int(s * 0.04))],
        radius=int(s * 0.025), fill=_BG,
    )

    # ════════════════════════════════════════════════════════════════════════
    # WORM  (drawn bottom-up: body segs first, head on top)
    # ═══════════════════════════════════════════════════════════════
    wx  = mid                         # worm x-centre (aligned with spine)
    wr  = int(s * 0.185)              # head radius — big and friendly

    # Seg 2 — nestled in the book gutter
    s2r = int(s * 0.090)
    s2y = by + int(s * 0.005)
    d.ellipse([(wx - s2r, s2y - s2r), (wx + s2r, s2y + s2r)], fill=_YLW_DARK)
    d.ellipse([(wx - s2r + int(s*0.005), s2y - s2r + int(s*0.005)),
               (wx + s2r - int(s*0.005), s2y + s2r - int(s*0.005))], fill=_YELLOW)

    # Seg 1 — connects head to seg 2
    s1r = int(s * 0.115)
    s1y = s2y - s1r - s2r + int(s * 0.025)
    d.ellipse([(wx - s1r, s1y - s1r), (wx + s1r, s1y + s1r)], fill=_YLW_DARK)
    d.ellipse([(wx - s1r + int(s*0.006), s1y - s1r + int(s*0.006)),
               (wx + s1r - int(s*0.006), s1y + s1r - int(s*0.006))], fill=_YELLOW)

    # Head
    wy = s1y - s1r - wr + int(s * 0.045)   # head centre y
    d.ellipse([(wx - wr, wy - wr), (wx + wr, wy + wr)], fill=_YLW_DARK)
    d.ellipse([(wx - wr + int(s*0.008), wy - wr + int(s*0.008)),
               (wx + wr - int(s*0.008), wy + wr - int(s*0.008))], fill=_YELLOW)

    # Shine / highlight (semi-transparent white blob top-left of head)
    img, d = _overlay(img,
                      (255, 255, 255, 70),
                      (wx - int(wr*0.65), wy - int(wr*0.62),
                       wx - int(wr*0.05), wy - int(wr*0.12)))

    # ── Antennae ─────────────────────────────────────────────────────────────
    aw  = max(2, int(s * 0.018))   # stroke width
    atr = max(3, int(s * 0.025))   # tip ball radius

    # left antenna
    ax1b, ay1b = wx - int(wr * 0.42), wy - int(wr * 0.78)
    ax1t, ay1t = ax1b - int(wr * 0.55), ay1b - int(wr * 0.75)
    d.line([(ax1b, ay1b), (ax1t, ay1t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax1t - atr, ay1t - atr), (ax1t + atr, ay1t + atr)], fill=_YELLOW)
    d.ellipse([(ax1t - atr + 1, ay1t - atr + 1),
               (ax1t + atr - 1, ay1t + atr - 1)], fill=_YELLOW)

    # right antenna (a bit taller for asymmetry)
    ax2b, ay2b = wx + int(wr * 0.28), wy - int(wr * 0.88)
    ax2t, ay2t = ax2b + int(wr * 0.45), ay2b - int(wr * 0.80)
    d.line([(ax2b, ay2b), (ax2t, ay2t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax2t - atr, ay2t - atr), (ax2t + atr, ay2t + atr)], fill=_YELLOW)

    # ── Eyes ─────────────────────────────────────────────────────────────────
    er    = int(wr * 0.330)    # sclera radius
    e_off = int(wr * 0.410)    # horizontal offset from centre
    ey    = wy - int(wr * 0.075)

    for ex in (wx - e_off, wx + e_off):
        # sclera
        d.ellipse([(ex - er, ey - er), (ex + er, ey + er)], fill=_WHITE)
        # pupil
        pr = int(er * 0.54)
        d.ellipse([(ex - pr, ey - pr), (ex + pr, ey + pr)], fill=_INK)
        # iris ring (slight teal tint)
        ir = int(er * 0.72)
        d.ellipse([(ex - ir, ey - ir), (ex + ir, ey + ir)],
                  outline=(50, 100, 180), width=max(1, int(s * 0.008)))
        # catchlight
        cr = max(1, int(er * 0.22))
        cox, coy = ex - int(er * 0.28), ey - int(er * 0.30)
        d.ellipse([(cox - cr, coy - cr), (cox + cr, coy + cr)], fill=_WHITE)

    # ── Round bookworm glasses ───────────────────────────────────────────────
    gw  = max(2, int(s * 0.016))   # frame stroke width
    gr  = int(er * 1.28)           # lens ring radius
    d.ellipse([(wx - e_off - gr, ey - gr), (wx - e_off + gr, ey + gr)],
              outline=_INK, width=gw)
    d.ellipse([(wx + e_off - gr, ey - gr), (wx + e_off + gr, ey + gr)],
              outline=_INK, width=gw)
    # nose bridge
    d.line([(wx - e_off + gr, ey), (wx + e_off - gr, ey)], fill=_INK, width=gw)
    # temples (short lines extending outward)
    t_len = int(s * 0.045)
    d.line([(wx - e_off - gr, ey),
            (wx - e_off - gr - t_len, ey - int(s * 0.010))], fill=_INK, width=gw)
    d.line([(wx + e_off + gr, ey),
            (wx + e_off + gr + t_len, ey - int(s * 0.010))], fill=_INK, width=gw)

    # ── Rosy cheeks (semi-transparent) ───────────────────────────────────────
    ck_r = int(wr * 0.295)
    ck_y = ey + int(wr * 0.46)
    img, d = _overlay(img, _CHEEK, (wx - e_off - ck_r*2, ck_y - ck_r,
                                     wx - e_off,           ck_y + ck_r))
    img, d = _overlay(img, _CHEEK, (wx + e_off,           ck_y - ck_r,
                                     wx + e_off + ck_r*2, ck_y + ck_r))

    # ── Smile ────────────────────────────────────────────────────────────────
    sm_r = int(wr * 0.50)
    sm_top = ey + int(wr * 0.24)
    d.arc(
        [(wx - sm_r, sm_top), (wx + sm_r, sm_top + int(sm_r * 0.80))],
        start=8, end=172,
        fill=_INK, width=max(2, int(s * 0.020)),
    )

    return img


# ── Monochrome badge icon (Android status-bar push notification) ─────────────
def _make_badge(size: int = 96) -> Image.Image:
    """White worm silhouette on transparent background.

    Android draws the badge by colouring all non-transparent pixels white, so
    the image must be RGBA with transparency — not a solid-colour PNG.
    Kept deliberately simple so it reads clearly at ~12-16 px on-screen.
    """
    W   = (255, 255, 255, 255)   # opaque white
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    cx  = size // 2
    cy  = size // 2 + int(size * 0.04)   # shift body+head slightly down

    # ── Body segment (lower circle) ──────────────────────────────────────────
    sr  = int(size * 0.175)
    sy  = cy + int(size * 0.215)
    d.ellipse([(cx - sr, sy - sr), (cx + sr, sy + sr)], fill=W)

    # ── Head (larger circle) ─────────────────────────────────────────────────
    hr  = int(size * 0.275)
    hy  = cy - int(size * 0.055)
    d.ellipse([(cx - hr, hy - hr), (cx + hr, hy + hr)], fill=W)

    # ── Antennae ─────────────────────────────────────────────────────────────
    aw  = max(2, int(size * 0.058))    # stroke width
    atr = max(3, int(size * 0.068))    # tip ball radius

    # left antenna
    ax1b, ay1b = cx - int(hr * 0.38), hy - int(hr * 0.68)
    ax1t, ay1t = ax1b - int(hr * 0.52), ay1b - int(hr * 0.68)
    d.line([(ax1b, ay1b), (ax1t, ay1t)], fill=W, width=aw)
    d.ellipse([(ax1t - atr, ay1t - atr), (ax1t + atr, ay1t + atr)], fill=W)

    # right antenna (slightly taller for asymmetry — matches main icon)
    ax2b, ay2b = cx + int(hr * 0.28), hy - int(hr * 0.82)
    ax2t, ay2t = ax2b + int(hr * 0.46), ay2b - int(hr * 0.68)
    d.line([(ax2b, ay2b), (ax2t, ay2t)], fill=W, width=aw)
    d.ellipse([(ax2t - atr, ay2t - atr), (ax2t + atr, ay2t + atr)], fill=W)

    return img


# ── Public API ───────────────────────────────────────────────────────────────
def generate_icons(out_dir: str = _OUT_DIR, force: bool = False) -> None:
    """Write PNG icons to *out_dir*. Skips existing files unless *force=True*."""
    os.makedirs(out_dir, exist_ok=True)

    # ── Full-colour app icons (RGBA → flattened to RGB on green bg) ──────────
    for name, size, maskable in _SPECS:
        path = os.path.join(out_dir, name)
        if not force and os.path.exists(path):
            continue
        icon = _make_icon(size, maskable)
        # Flatten RGBA → RGB on solid background (some platforms need opaque).
        bg = Image.new("RGB", (size, size), _BG)
        bg.paste(icon, mask=icon.split()[3])
        bg.save(path, "PNG", optimize=True)

    # ── Monochrome badge (RGBA — must keep transparency for Android) ──────────
    badge_path = os.path.join(out_dir, "badge-96.png")
    if force or not os.path.exists(badge_path):
        _make_badge(96).save(badge_path, "PNG", optimize=True)
