"""Generate themed PWA shortcut icons for BookWorm home-screen shortcuts.

Three 192x192 icons, all starring the BookWorm worm character:

  shortcut-new-note-192.png  — blue bg, spiral notepad, pencil, worm writing
  shortcut-my-files-192.png  — teal bg, open folder, papers, worm peeking out
  shortcut-ai-search-192.png — purple bg, magnifying glass, worm INSIDE lens

Files are only written when missing; call generate_shortcut_icons(force=True)
to force-redraw all three.
"""
import math
import os
from PIL import Image, ImageDraw

_OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "img", "icons")

# ── Shared worm palette (matches bw_pwa_icons.py) ────────────────────────────
_YELLOW   = (251, 191,  36)
_YLW_DARK = (146,  64,  14)
_WHITE    = (255, 253, 245)
_INK      = ( 28,  25,  23)
_CHEEK    = (234,  88,  12, 110)   # RGBA blush

# ── Backgrounds ───────────────────────────────────────────────────────────────
_BG_NOTE   = (  0,  83, 226)   # Walmart blue   #0053e2
_BG_FILES  = (  6, 120, 120)   # deep teal      #067878
_BG_SEARCH = (109,  40, 217)   # vivid purple   #6d28d9

# ── New Note extras ───────────────────────────────────────────────────────────
_PAGE      = (255, 254, 250)
_MARGIN    = (255,  90,  90)
_RULED     = (188, 214, 255)
_SPIRAL    = (120, 170, 255)
_PEN_YLW   = (252, 211,  77)
_PEN_WOOD  = (180, 100,  30)
_PEN_FRUL  = (180, 182, 190)
_PEN_PINK  = (255, 175, 185)
_PEN_TIP   = ( 45,  45,  45)

# ── My Files extras ───────────────────────────────────────────────────────────
_FOLD_BACK = (217, 160,   6)
_FOLD_FRON = (253, 210,  50)
_FOLD_TAB  = (180, 124,   4)
_PAPER_W   = (255, 255, 255)
_PAPER_B   = (210, 228, 255)
_PAPER_G   = (210, 248, 220)
_PAPER_P   = (238, 220, 255)

# ── AI Search extras ─────────────────────────────────────────────────────────
_GLASS_RIM  = (255, 255, 255)
_GLASS_LENS = (210, 180, 255, 100)   # RGBA tinted lens
_SPARK      = (255, 194,  32)        # gold sparkle #ffc220
_HANDLE_CLR = (255, 255, 255)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _overlay(img: Image.Image, color_rgba: tuple, bbox: tuple):
    """Alpha-composite a semi-transparent ellipse; return (img, draw)."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(bbox, fill=color_rgba)
    img = Image.alpha_composite(img, layer)
    return img, ImageDraw.Draw(img)


def _overlay_rect(img: Image.Image, color_rgba: tuple, bbox: tuple, radius: int = 0):
    """Alpha-composite a semi-transparent rounded rectangle; return (img, draw)."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if radius:
        ImageDraw.Draw(layer).rounded_rectangle(bbox, radius=radius, fill=color_rgba)
    else:
        ImageDraw.Draw(layer).rectangle(bbox, fill=color_rgba)
    img = Image.alpha_composite(img, layer)
    return img, ImageDraw.Draw(img)


def _star4(cx: int, cy: int, ro: int, ri: int) -> list:
    """Return polygon points for a 4-pointed star centred at (cx, cy)."""
    pts = []
    for i in range(8):
        angle = math.pi * i / 4 - math.pi / 2
        r = ro if i % 2 == 0 else ri
        pts.append((int(cx + r * math.cos(angle)),
                    int(cy + r * math.sin(angle))))
    return pts


def _draw_worm_head(img: Image.Image, cx: int, cy: int, r: int):
    """Draw the BookWorm character head centred at (cx, cy) with radius r.
    Returns (img, draw) — img is updated after alpha-compositing the cheeks.
    """
    d = ImageDraw.Draw(img)

    # Head outline + fill
    d.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=_YLW_DARK)
    ir = int(r * 0.93)
    d.ellipse([(cx - ir, cy - ir), (cx + ir, cy + ir)], fill=_YELLOW)

    # Antennae
    aw  = max(2, int(r * 0.12))
    atr = max(2, int(r * 0.16))
    ax1b = cx - int(r * 0.40);  ay1b = cy - int(r * 0.72)
    ax1t = ax1b - int(r * 0.52); ay1t = ay1b - int(r * 0.72)
    d.line([(ax1b, ay1b), (ax1t, ay1t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax1t - atr, ay1t - atr), (ax1t + atr, ay1t + atr)], fill=_YELLOW)
    ax2b = cx + int(r * 0.28);  ay2b = cy - int(r * 0.86)
    ax2t = ax2b + int(r * 0.48); ay2t = ay2b - int(r * 0.72)
    d.line([(ax2b, ay2b), (ax2t, ay2t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax2t - atr, ay2t - atr), (ax2t + atr, ay2t + atr)], fill=_YELLOW)

    # Eyes
    er    = int(r * 0.310)
    e_off = int(r * 0.395)
    ey    = cy - int(r * 0.07)
    for ex in (cx - e_off, cx + e_off):
        d.ellipse([(ex - er, ey - er), (ex + er, ey + er)], fill=_WHITE)
        pr = int(er * 0.54)
        d.ellipse([(ex - pr, ey - pr), (ex + pr, ey + pr)], fill=_INK)
        ir2 = int(er * 0.72)
        d.ellipse([(ex - ir2, ey - ir2), (ex + ir2, ey + ir2)],
                  outline=(50, 100, 180), width=max(1, int(r * 0.06)))
        cr  = max(1, int(er * 0.22))
        d.ellipse([(ex - int(er * 0.28) - cr, ey - int(er * 0.30) - cr),
                   (ex - int(er * 0.28) + cr, ey - int(er * 0.30) + cr)],
                  fill=_WHITE)

    # Round glasses
    gw = max(2, int(r * 0.10))
    gr = int(er * 1.28)
    d.ellipse([(cx - e_off - gr, ey - gr), (cx - e_off + gr, ey + gr)],
              outline=_INK, width=gw)
    d.ellipse([(cx + e_off - gr, ey - gr), (cx + e_off + gr, ey + gr)],
              outline=_INK, width=gw)
    d.line([(cx - e_off + gr, ey), (cx + e_off - gr, ey)], fill=_INK, width=gw)
    tl = int(r * 0.28)
    d.line([(cx - e_off - gr, ey), (cx - e_off - gr - tl, ey - int(r * 0.06))],
           fill=_INK, width=gw)
    d.line([(cx + e_off + gr, ey), (cx + e_off + gr + tl, ey - int(r * 0.06))],
           fill=_INK, width=gw)

    # Rosy cheeks (alpha-composited)
    ck_r = int(r * 0.28)
    ck_y = ey + int(r * 0.44)
    img, d = _overlay(img, _CHEEK,
                      (cx - e_off - ck_r * 2, ck_y - ck_r,
                       cx - e_off,             ck_y + ck_r))
    img, d = _overlay(img, _CHEEK,
                      (cx + e_off,             ck_y - ck_r,
                       cx + e_off + ck_r * 2, ck_y + ck_r))

    # Smile
    sm_r = int(r * 0.46)
    sm_t = ey + int(r * 0.24)
    d.arc([(cx - sm_r, sm_t), (cx + sm_r, sm_t + int(sm_r * 0.75))],
          start=8, end=172, fill=_INK, width=max(2, int(r * 0.12)))

    return img, d


# ── Icon makers ───────────────────────────────────────────────────────────────

def _make_new_note() -> Image.Image:
    """Blue bg • spiral notepad • diagonal pencil • worm writing at bottom."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Background
    d.rounded_rectangle([(4, 4), (188, 188)], radius=42, fill=_BG_NOTE)

    # ── Notepad shadow ────────────────────────────────────────────────────
    img, d = _overlay_rect(img, (0, 20, 100, 70),
                           [(36, 34), (154, 154)], radius=9)

    # ── Notepad page ──────────────────────────────────────────────────────
    px0, py0, px1, py1 = 32, 30, 150, 150
    d.rounded_rectangle([(px0, py0), (px1, py1)], radius=8, fill=_PAGE)

    # Red margin line
    mx = px0 + 28
    d.line([(mx, py0 + 12), (mx, py1 - 8)], fill=_MARGIN, width=3)

    # Ruled lines
    for ly in range(py0 + 28, py1 - 30, 20):
        d.line([(mx + 8, ly), (px1 - 10, ly)], fill=_RULED, width=2)

    # Top-right dog-ear fold
    fold = 16
    d.polygon([(px1 - fold, py0), (px1, py0 + fold), (px1, py0)],
              fill=_RULED)
    d.line([(px1 - fold, py0), (px1, py0 + fold)], fill=(200, 200, 200), width=1)

    # Spiral binding (holes on left edge of page)
    for hy in range(py0 + 24, py1 - 20, 20):
        d.ellipse([(px0 - 7, hy - 7), (px0 + 7, hy + 7)], fill=_BG_NOTE)
        d.ellipse([(px0 - 5, hy - 5), (px0 + 5, hy + 5)], fill=_SPIRAL)

    # ── Pencil (diagonal upper-right, 45°) ───────────────────────────────
    # Direction: upper-right to lower-left  →  (-0.707, 0.707)
    # Perpendicular offset hw=7: side offsets are ±(5, 5)
    hw = 7

    def _L(x, y): return (x - hw, y - hw)
    def _R(x, y): return (x + hw, y + hw)

    tip  = (158, 34)   # graphite point
    cb   = (147, 45)   # cone base
    be   = (118, 74)   # body / ferrule boundary
    fe   = (112, 80)   # ferrule / eraser boundary
    era  = (106, 86)   # eraser tip

    # Wood cone (triangle)
    d.polygon([tip, _L(*cb), _R(*cb)], fill=_PEN_WOOD)
    d.ellipse([(tip[0] - 3, tip[1] - 3), (tip[0] + 3, tip[1] + 3)],
              fill=_PEN_TIP)
    # Yellow body
    d.polygon([_L(*cb), _L(*be), _R(*be), _R(*cb)], fill=_PEN_YLW)
    d.line([_L(*cb), _L(*be)], fill=_YLW_DARK, width=1)
    d.line([_R(*cb), _R(*be)], fill=_YLW_DARK, width=1)
    # Silver ferrule band
    d.polygon([_L(*be), _L(*fe), _R(*fe), _R(*be)], fill=_PEN_FRUL)
    # Pink eraser
    d.polygon([_L(*fe), _L(*era), _R(*era), _R(*fe)], fill=_PEN_PINK)
    d.ellipse([(era[0] - hw, era[1] - hw), (era[0] + hw, era[1] + hw)],
              fill=_PEN_PINK)

    # ── Worm peeking from below the notepad ───────────────────────────────
    # Body segment sits below page; draw before head so head appears on top
    bx, by, br = 120, 165, 16
    d.ellipse([(bx - br, by - br), (bx + br, by + br)], fill=_YLW_DARK)
    d.ellipse([(bx - br + 2, by - br + 2), (bx + br - 2, by + br - 2)],
              fill=_YELLOW)

    # Head
    img, d = _draw_worm_head(img, cx=120, cy=148, r=26)

    return img


def _make_my_files() -> Image.Image:
    """Teal bg • open folder • coloured papers fanning out • worm peeking."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Background
    d.rounded_rectangle([(4, 4), (188, 188)], radius=42, fill=_BG_FILES)

    # ── Folder tab ────────────────────────────────────────────────────────
    d.rounded_rectangle([(28, 74), (84, 90)], radius=6, fill=_FOLD_TAB)

    # ── Folder body back ──────────────────────────────────────────────────
    d.rounded_rectangle([(28, 82), (164, 162)], radius=12, fill=_FOLD_BACK)

    # ── Papers fanning out from folder opening ────────────────────────────
    # Draw right-to-left so leftmost paper is on top
    papers = [
        # (color, [x0, y0, x1, y1])
        (_PAPER_P, [116, 42, 152, 92]),
        (_PAPER_G, [ 90, 38, 126, 92]),
        (_PAPER_B, [ 64, 42, 100, 92]),
        (_PAPER_W, [ 38, 46,  76, 92]),
    ]
    for color, (x0, y0, x1, y1) in papers:
        d.rounded_rectangle([(x0, y0), (x1, y1)], radius=4, fill=color)
        d.rounded_rectangle([(x0, y0), (x1, y1)], radius=4,
                            outline=(200, 200, 200), width=1)
        # Tiny ruled lines on each paper
        for rl in range(y0 + 10, y1 - 4, 10):
            d.line([(x0 + 4, rl), (x1 - 4, rl)],
                   fill=(180, 180, 180), width=1)

    # ── Folder front panel ────────────────────────────────────────────────
    d.rounded_rectangle([(28, 95), (164, 162)], radius=12, fill=_FOLD_FRON)
    # Subtle top shine strip
    img, d = _overlay_rect(img, (255, 255, 255, 40),
                           [(30, 95), (162, 115)], radius=10)
    # Crease line
    d.line([(36, 106), (156, 106)], fill=_FOLD_BACK, width=1)

    # ── Worm peeking up from INSIDE the folder ──────────────────────────
    # Body segment visible just above the folder front panel
    bx, by, br = 143, 100, 18
    d.ellipse([(bx - br, by - br), (bx + br, by + br)], fill=_YLW_DARK)
    d.ellipse([(bx - br + 2, by - br + 2), (bx + br - 2, by + br - 2)],
              fill=_YELLOW)
    # Head peeking above the papers — well inside the icon bounds
    img, d = _draw_worm_head(img, cx=143, cy=64, r=30)

    return img


def _make_ai_search() -> Image.Image:
    """Purple bg • magnifying glass • worm INSIDE the lens • gold sparkles."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Background
    d.rounded_rectangle([(4, 4), (188, 188)], radius=42, fill=_BG_SEARCH)

    # ── Magnifying glass handle ───────────────────────────────────────────
    # Runs 45° lower-right from lens edge at ~(126, 120) to tip at (160, 154)
    # Direction (0.707, 0.707), perpendicular (-0.707, 0.707), hw=10
    hw_h = 10
    h1x, h1y = 124, 118   # handle start (at lens rim)
    h2x, h2y = 158, 152   # handle end

    d.polygon([
        (h1x - hw_h, h1y + hw_h),
        (h2x - hw_h, h2y + hw_h),
        (h2x + hw_h, h2y - hw_h),
        (h1x + hw_h, h1y - hw_h),
    ], fill=_HANDLE_CLR)
    # Rounded cap at handle end
    d.ellipse([(h2x - hw_h, h2y - hw_h), (h2x + hw_h, h2y + hw_h)],
              fill=_HANDLE_CLR)

    # ── Lens interior (tinted) ────────────────────────────────────────────
    lx, ly, lr = 86, 80, 54   # centre, outer radius
    lns_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(lns_layer).ellipse(
        [(lx - lr, ly - lr), (lx + lr, ly + lr)], fill=_GLASS_LENS)
    img = Image.alpha_composite(img, lns_layer)
    d   = ImageDraw.Draw(img)

    # ── Worm INSIDE the lens (being AI-searched!) ─────────────────────────
    img, d = _draw_worm_head(img, cx=lx, cy=ly, r=28)

    # ── Lens rim (drawn ON TOP of worm so it frames cleanly) ──────────────
    d.ellipse([(lx - lr, ly - lr), (lx + lr, ly + lr)],
              outline=_GLASS_RIM, width=9)

    # ── Gold sparkles scattered around lens ───────────────────────────────
    # Large 4-pointed star — upper-right outside rim
    d.polygon(_star4(lx + 52, ly - 50, 14, 5), fill=_SPARK)
    # Medium star — upper-left area
    d.polygon(_star4(lx - 58, ly - 30, 9, 3), fill=_SPARK)
    # Small star — directly above
    d.polygon(_star4(lx + 8, ly - 64, 7, 2), fill=_SPARK)
    # Tiny dots
    d.ellipse([(lx + 60, ly + 4), (lx + 68, ly + 12)], fill=_SPARK)
    d.ellipse([(lx - 50, ly + 46), (lx - 44, ly + 52)], fill=_SPARK)

    return img


# ── Public API ────────────────────────────────────────────────────────────────

_SHORTCUT_ICONS = [
    ("shortcut-new-note-192.png",   _make_new_note,   _BG_NOTE),
    ("shortcut-my-files-192.png",   _make_my_files,   _BG_FILES),
    ("shortcut-ai-search-192.png",  _make_ai_search,  _BG_SEARCH),
]


def generate_shortcut_icons(out_dir: str = _OUT_DIR, force: bool = False) -> None:
    """Write the three shortcut PNGs to *out_dir*. Skips existing files unless
    *force=True*.  Each RGBA image is flattened onto its matching solid
    background before saving (same pattern as bw_pwa_icons.py).
    """
    os.makedirs(out_dir, exist_ok=True)
    for name, maker, bg_rgb in _SHORTCUT_ICONS:
        path = os.path.join(out_dir, name)
        if not force and os.path.exists(path):
            continue
        icon = maker()
        # Flatten RGBA onto solid background — some platforms need opaque PNGs
        flat = Image.new("RGB", icon.size, bg_rgb)
        flat.paste(icon, mask=icon.split()[3])
        flat.save(path, "PNG", optimize=True)
        print(f"  [shortcut-icons] wrote {name}")


if __name__ == "__main__":
    generate_shortcut_icons(force=True)
    print("Done.")
