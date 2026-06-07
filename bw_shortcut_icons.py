"""Generate themed PWA shortcut icons for BookWorm home-screen shortcuts.

Three 192x192 RGBA icons — NO solid background (OS provides its own layer):

  shortcut-new-note-192.png  — notepad + pencil + EXCITED worm (arms out, wide grin)
  shortcut-my-files-192.png  — folder + papers + SIDE-PROFILE worm (facing left)
  shortcut-ai-search-192.png — magnifying glass + WINKING worm inside lens + sparkles

Call generate_shortcut_icons(force=True) to force-redraw all three.
"""
import math
import os
from PIL import Image, ImageDraw

_OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "img", "icons")

# ── Shared worm palette ───────────────────────────────────────────────────────
_YELLOW   = (251, 191,  36)
_YLW_DARK = (146,  64,  14)
_WHITE    = (255, 253, 245)
_INK      = ( 28,  25,  23)
_CHEEK    = (234,  88,  12, 110)   # RGBA blush

# ── New Note extras ───────────────────────────────────────────────────────────
_PAGE     = (255, 254, 250)
_MARGIN   = (255,  80,  80)
_RULED    = (188, 214, 255)
_SPIRAL   = ( 80, 140, 230)
_PEN_YLW  = (252, 211,  77)
_PEN_WOOD = (160,  90,  20)
_PEN_FRUL = (175, 178, 186)
_PEN_PINK = (255, 170, 182)
_PEN_TIP  = ( 40,  40,  40)

# ── My Files extras ───────────────────────────────────────────────────────────
_FOLD_BACK = (210, 148,   4)
_FOLD_FRON = (252, 208,  46)
_FOLD_TAB  = (172, 118,   2)
_PAPER_W   = (255, 255, 255)
_PAPER_B   = (210, 228, 255)
_PAPER_G   = (208, 248, 218)
_PAPER_P   = (238, 218, 255)

# ── AI Search extras ──────────────────────────────────────────────────────────
_GLASS_RIM  = (255, 255, 255)
_GLASS_LENS = (220, 195, 255, 100)   # semi-transparent purple tint
_SPARK      = (255, 194,  32)         # Walmart gold
_HANDLE_CLR = (255, 255, 255)


# ── Compositing helpers ───────────────────────────────────────────────────────

def _alpha_ellipse(img: Image.Image, color_rgba: tuple, bbox: tuple):
    """Composite a semi-transparent ellipse; return (img, draw)."""
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).ellipse(bbox, fill=color_rgba)
    img = Image.alpha_composite(img, lay)
    return img, ImageDraw.Draw(img)


def _alpha_rrect(img: Image.Image, color_rgba: tuple, bbox: tuple, r: int = 0):
    """Composite a semi-transparent rounded rectangle; return (img, draw)."""
    lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if r:
        ImageDraw.Draw(lay).rounded_rectangle(bbox, radius=r, fill=color_rgba)
    else:
        ImageDraw.Draw(lay).rectangle(bbox, fill=color_rgba)
    img = Image.alpha_composite(img, lay)
    return img, ImageDraw.Draw(img)


def _star4(cx: int, cy: int, ro: int, ri: int) -> list:
    """4-pointed star polygon centred at (cx, cy)."""
    pts = []
    for i in range(8):
        angle = math.pi * i / 4 - math.pi / 2
        r = ro if i % 2 == 0 else ri
        pts.append((int(cx + r * math.cos(angle)),
                    int(cy + r * math.sin(angle))))
    return pts


# ═════════════════════════════════════════════════════════════════════════════
# WORM PERSONALITY 1 — EXCITED  (New Note)
# Wide antennae splayed out, little arm-nubs, big eyes looking UP, huge grin
# ═════════════════════════════════════════════════════════════════════════════

def _worm_excited(img: Image.Image, cx: int, cy: int, r: int):
    d = ImageDraw.Draw(img)

    # Head outline + fill
    d.ellipse([(cx-r, cy-r), (cx+r, cy+r)], fill=_YLW_DARK)
    d.ellipse([(cx-r+int(r*.08), cy-r+int(r*.08)),
               (cx+r-int(r*.08), cy+r-int(r*.08))], fill=_YELLOW)

    # Little arm-nubs sticking out both sides
    nb = int(r * 0.27)
    for nx, ny, nr in [(cx - r - nb + 5, cy + int(r*.22), nb),
                       (cx + r + nb - 5, cy + int(r*.22), nb)]:
        d.ellipse([(nx-nr, ny-nr), (nx+nr, ny+nr)], fill=_YLW_DARK)
        d.ellipse([(nx-nr+2, ny-nr+2), (nx+nr-2, ny+nr-2)], fill=_YELLOW)

    # Antennae — splayed wide apart (excited energy!)
    aw  = max(2, int(r * 0.12))
    atr = max(3, int(r * 0.17))
    # left: far upper-left
    ax1b = cx - int(r*.36);  ay1b = cy - int(r*.76)
    ax1t = ax1b - int(r*.80); ay1t = ay1b - int(r*.62)
    d.line([(ax1b, ay1b), (ax1t, ay1t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax1t-atr, ay1t-atr), (ax1t+atr, ay1t+atr)], fill=_YELLOW)
    # right: far upper-right (symmetric splay)
    ax2b = cx + int(r*.36);  ay2b = cy - int(r*.76)
    ax2t = ax2b + int(r*.80); ay2t = ay2b - int(r*.62)
    d.line([(ax2b, ay2b), (ax2t, ay2t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax2t-atr, ay2t-atr), (ax2t+atr, ay2t+atr)], fill=_YELLOW)

    # Eyes — LARGE, pupils shifted UP (looking up at the pencil!)
    er    = int(r * 0.325)
    e_off = int(r * 0.385)
    ey    = cy - int(r * 0.08)
    for ex in (cx - e_off, cx + e_off):
        d.ellipse([(ex-er, ey-er), (ex+er, ey+er)], fill=_WHITE)
        pr = int(er * 0.54)
        # pupils shifted up
        d.ellipse([(ex-pr, ey-pr-int(er*.28)), (ex+pr, ey+pr-int(er*.28))],
                  fill=_INK)
        ir = int(er * 0.72)
        d.ellipse([(ex-ir, ey-ir), (ex+ir, ey+ir)],
                  outline=(50, 100, 180), width=max(1, int(r*.06)))
        # Two small catchlights for sparkle
        cr = max(1, int(er * 0.20))
        for offx, offy in [(-int(er*.34), -int(er*.40)),
                            ( int(er*.10), -int(er*.46))]:
            d.ellipse([(ex+offx-cr, ey+offy-cr), (ex+offx+cr, ey+offy+cr)],
                      fill=_WHITE)

    # Round glasses
    gw = max(2, int(r * 0.10))
    gr = int(er * 1.26)
    d.ellipse([(cx-e_off-gr, ey-gr), (cx-e_off+gr, ey+gr)], outline=_INK, width=gw)
    d.ellipse([(cx+e_off-gr, ey-gr), (cx+e_off+gr, ey+gr)], outline=_INK, width=gw)
    d.line([(cx-e_off+gr, ey), (cx+e_off-gr, ey)], fill=_INK, width=gw)
    tl = int(r * 0.27)
    d.line([(cx-e_off-gr, ey), (cx-e_off-gr-tl, ey-int(r*.05))], fill=_INK, width=gw)
    d.line([(cx+e_off+gr, ey), (cx+e_off+gr+tl, ey-int(r*.05))], fill=_INK, width=gw)

    # Cheeks
    ck_r = int(r * 0.26)
    ck_y = ey + int(r * 0.46)
    img, d = _alpha_ellipse(img, _CHEEK,
                            (cx-e_off-ck_r*2, ck_y-ck_r, cx-e_off, ck_y+ck_r))
    img, d = _alpha_ellipse(img, _CHEEK,
                            (cx+e_off, ck_y-ck_r, cx+e_off+ck_r*2, ck_y+ck_r))

    # BIG open grin — wide arc, almost a full D-shape
    sm_r = int(r * 0.54)
    sm_t = ey + int(r * 0.18)
    d.arc([(cx-sm_r, sm_t), (cx+sm_r, sm_t+int(sm_r*.82))],
          start=4, end=176, fill=_INK, width=max(2, int(r*.13)))

    return img, d


# ═════════════════════════════════════════════════════════════════════════════
# WORM PERSONALITY 2 — SIDE PROFILE  (My Files)
# One eye, one antenna, profile glasses lens, profile smile — entirely different!
# ═════════════════════════════════════════════════════════════════════════════

def _worm_profile(img: Image.Image, cx: int, cy: int, r: int, facing: str = 'left'):
    """Side-facing worm. facing='left' means face points left (negative x)."""
    d   = ImageDraw.Draw(img)
    fl  = -1 if facing == 'left' else 1   # direction multiplier

    # Head
    d.ellipse([(cx-r, cy-r), (cx+r, cy+r)], fill=_YLW_DARK)
    d.ellipse([(cx-r+int(r*.08), cy-r+int(r*.08)),
               (cx+r-int(r*.08), cy+r-int(r*.08))], fill=_YELLOW)

    # Single antenna on the face side
    aw  = max(2, int(r * 0.13))
    atr = max(3, int(r * 0.19))
    axb = cx + fl * int(r * 0.22);  ayb = cy - int(r * 0.72)
    axt = axb + fl * int(r * 0.52); ayt = ayb - int(r * 0.80)
    d.line([(axb, ayb), (axt, ayt)], fill=_YLW_DARK, width=aw)
    d.ellipse([(axt-atr, ayt-atr), (axt+atr, ayt+atr)], fill=_YELLOW)

    # Single eye — positioned toward the face direction
    er = int(r * 0.30)
    ex = cx + fl * int(r * 0.32)
    ey = cy - int(r * 0.10)
    d.ellipse([(ex-er, ey-er), (ex+er, ey+er)], fill=_WHITE)
    pr = int(er * 0.54)
    # Pupil offset toward the face direction (looking forward)
    d.ellipse([(ex+fl*int(er*.22)-pr, ey-pr), (ex+fl*int(er*.22)+pr, ey+pr)],
              fill=_INK)
    ir = int(er * 0.72)
    d.ellipse([(ex-ir, ey-ir), (ex+ir, ey+ir)],
              outline=(50, 100, 180), width=max(1, int(r*.06)))
    cr = max(1, int(er * 0.21))
    d.ellipse([(ex+fl*int(er*.20)-cr, ey-int(er*.35)-cr),
               (ex+fl*int(er*.20)+cr, ey-int(er*.35)+cr)], fill=_WHITE)

    # Single round glasses lens
    gw = max(2, int(r * 0.10))
    gr = int(er * 1.26)
    d.ellipse([(ex-gr, ey-gr), (ex+gr, ey+gr)], outline=_INK, width=gw)
    # Short nose bridge (toward back of head)
    d.line([(ex - fl*gr, ey), (ex - fl*(gr + int(r*.18)), ey)],
           fill=_INK, width=gw)
    # Temple (extends away from face, past the ear)
    d.line([(ex + fl*gr, ey), (ex + fl*(gr + int(r*.30)), ey - int(r*.04))],
           fill=_INK, width=gw)

    # Cheek — front of face
    ck_r = int(r * 0.24)
    ck_cx = ex + fl * int(r * 0.08)
    ck_cy = ey + int(r * 0.42)
    img, d = _alpha_ellipse(img, _CHEEK,
                            (ck_cx-ck_r*2, ck_cy-ck_r, ck_cx, ck_cy+ck_r))

    # Profile smile — arc on the lower-face side
    sm_r  = int(r * 0.38)
    sm_cx = cx + fl * int(r * 0.20)
    sm_cy = ey + int(r * 0.30)
    # Arc through the bottom = ∪ shape = smile ✓ (in Pillow, 0°→90°=bottom)
    d.arc([(sm_cx-sm_r, sm_cy), (sm_cx+sm_r, sm_cy+int(sm_r*.72))],
          start=10, end=170, fill=_INK, width=max(2, int(r*.12)))

    return img, d


# ═════════════════════════════════════════════════════════════════════════════
# WORM PERSONALITY 3 — WINKING  (AI Search)
# Left eye = winked shut with arc + lashes. Right eye = wide open, large pupil.
# Asymmetric smirk. Cheeky detective energy.
# ═════════════════════════════════════════════════════════════════════════════

def _worm_winking(img: Image.Image, cx: int, cy: int, r: int):
    d = ImageDraw.Draw(img)

    # Head
    d.ellipse([(cx-r, cy-r), (cx+r, cy+r)], fill=_YLW_DARK)
    d.ellipse([(cx-r+int(r*.08), cy-r+int(r*.08)),
               (cx+r-int(r*.08), cy+r-int(r*.08))], fill=_YELLOW)

    # Antennae — standard spread, slightly asymmetric (left tilts more)
    aw  = max(2, int(r * 0.12))
    atr = max(2, int(r * 0.17))
    ax1b = cx - int(r*.38);  ay1b = cy - int(r*.74)
    ax1t = ax1b - int(r*.56); ay1t = ay1b - int(r*.72)
    d.line([(ax1b, ay1b), (ax1t, ay1t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax1t-atr, ay1t-atr), (ax1t+atr, ay1t+atr)], fill=_YELLOW)
    ax2b = cx + int(r*.30);  ay2b = cy - int(r*.86)
    ax2t = ax2b + int(r*.46); ay2t = ay2b - int(r*.68)
    d.line([(ax2b, ay2b), (ax2t, ay2t)], fill=_YLW_DARK, width=aw)
    d.ellipse([(ax2t-atr, ay2t-atr), (ax2t+atr, ay2t+atr)], fill=_YELLOW)

    er    = int(r * 0.31)
    e_off = int(r * 0.38)
    ey    = cy - int(r * 0.08)
    gw    = max(2, int(r * 0.10))
    gr    = int(er * 1.26)

    # ── LEFT eye: WINKED SHUT ─────────────────────────────────────────────
    lx = cx - e_off
    # Paint face colour over the eye area so the wink arc reads cleanly
    d.ellipse([(lx-er, ey-er), (lx+er, ey+er)], fill=_YELLOW)
    # Wink arc: in Pillow 270°=top, so 180°→360° traces LEFT→TOP→RIGHT = ∩
    # which looks like a closed eyelid curving upward — perfect wink shape
    ww = max(3, int(r * 0.16))
    d.arc([(lx-er, ey-int(er*.60)), (lx+er, ey+int(er*.60))],
          start=180, end=360, fill=_INK, width=ww)
    # Two little eyelashes above the wink
    d.line([(lx-int(er*.52), ey-int(er*.36)),
            (lx-int(er*.68), ey-int(er*.62))], fill=_INK, width=max(1, ww-1))
    d.line([(lx+int(er*.52), ey-int(er*.36)),
            (lx+int(er*.68), ey-int(er*.62))], fill=_INK, width=max(1, ww-1))
    # Squinting glasses frame: only the bottom arc (∪) so it looks compressed
    d.arc([(lx-gr, ey-gr), (lx+gr, ey+gr)],
          start=0, end=180, fill=_INK, width=gw)

    # ── RIGHT eye: WIDE OPEN, large pupil — peering! ─────────────────────
    rx = cx + e_off
    d.ellipse([(rx-er, ey-er), (rx+er, ey+er)], fill=_WHITE)
    pr = int(er * 0.60)   # slightly bigger pupil = intense peering look
    d.ellipse([(rx-pr, ey-pr), (rx+pr, ey+pr)], fill=_INK)
    ir = int(er * 0.72)
    d.ellipse([(rx-ir, ey-ir), (rx+ir, ey+ir)],
              outline=(50, 100, 180), width=max(1, int(r*.06)))
    cr = max(1, int(er * 0.22))
    d.ellipse([(rx-int(er*.28)-cr, ey-int(er*.32)-cr),
               (rx-int(er*.28)+cr, ey-int(er*.32)+cr)], fill=_WHITE)
    # Full round glasses frame for the open eye
    d.ellipse([(rx-gr, ey-gr), (rx+gr, ey+gr)], outline=_INK, width=gw)

    # Glasses bridge + temples
    d.line([(lx+gr, ey), (rx-gr, ey)], fill=_INK, width=gw)
    tl = int(r * 0.26)
    d.line([(lx-gr, ey), (lx-gr-tl, ey-int(r*.05))], fill=_INK, width=gw)
    d.line([(rx+gr, ey), (rx+gr+tl, ey-int(r*.05))], fill=_INK, width=gw)

    # Cheeks
    ck_r = int(r * 0.26)
    ck_y = ey + int(r * 0.44)
    img, d = _alpha_ellipse(img, _CHEEK,
                            (cx-e_off-ck_r*2, ck_y-ck_r, cx-e_off, ck_y+ck_r))
    img, d = _alpha_ellipse(img, _CHEEK,
                            (cx+e_off, ck_y-ck_r, cx+e_off+ck_r*2, ck_y+ck_r))

    # Asymmetric smirk — right side only, cheeky!
    sm_r = int(r * 0.46)
    sm_t = ey + int(r * 0.26)
    d.arc([(cx - int(r*.06), sm_t), (cx + sm_r, sm_t + int(sm_r*.72))],
          start=8, end=152, fill=_INK, width=max(2, int(r*.12)))

    return img, d


# ═════════════════════════════════════════════════════════════════════════════
# ICON MAKERS — no solid background (transparent RGBA PNGs)
# ═════════════════════════════════════════════════════════════════════════════

def _make_new_note() -> Image.Image:
    """Spiral notepad + pencil + EXCITED worm. Transparent background."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Soft drop shadow behind notepad
    img, d = _alpha_rrect(img, (0, 0, 0, 40), [(40, 38), (158, 158)], r=10)

    # ── Notepad page ──────────────────────────────────────────────────────
    px0, py0, px1, py1 = 36, 34, 154, 154
    d.rounded_rectangle([(px0, py0), (px1, py1)], radius=8,
                        fill=_PAGE, outline=(205, 205, 200), width=1)

    # Red margin line
    mx = px0 + 28
    d.line([(mx, py0+14), (mx, py1-10)], fill=_MARGIN, width=3)

    # Ruled lines
    for ly in range(py0 + 28, py1 - 28, 18):
        d.line([(mx+8, ly), (px1-10, ly)], fill=_RULED, width=2)

    # Dog-ear fold top-right
    fold = 16
    d.polygon([(px1-fold, py0), (px1, py0+fold), (px1, py0)],
              fill=(228, 228, 222))
    d.line([(px1-fold, py0), (px1, py0+fold)], fill=(185, 185, 180), width=1)

    # Spiral binding holes
    for hy in range(py0+22, py1-16, 19):
        d.ellipse([(px0-8, hy-7), (px0+6, hy+7)], fill=(175, 198, 252))
        d.ellipse([(px0-6, hy-5), (px0+4, hy+5)], fill=_SPIRAL)

    # ── Pencil diagonal (upper-right, 45°) ───────────────────────────────
    hw = 7
    def _L(x, y): return (x - hw, y - hw)
    def _R(x, y): return (x + hw, y + hw)

    tip = (158, 36); cb  = (147, 47)
    be  = (118, 76); fe  = (112, 82); era = (106, 88)

    d.polygon([tip, _L(*cb), _R(*cb)], fill=_PEN_WOOD)
    d.ellipse([(tip[0]-3, tip[1]-3), (tip[0]+3, tip[1]+3)], fill=_PEN_TIP)
    d.polygon([_L(*cb), _L(*be), _R(*be), _R(*cb)], fill=_PEN_YLW)
    d.line([_L(*cb), _L(*be)], fill=_YLW_DARK, width=1)
    d.line([_R(*cb), _R(*be)], fill=_YLW_DARK, width=1)
    d.polygon([_L(*be), _L(*fe), _R(*fe), _R(*be)], fill=_PEN_FRUL)
    d.polygon([_L(*fe), _L(*era), _R(*era), _R(*fe)], fill=_PEN_PINK)
    d.ellipse([(era[0]-hw, era[1]-hw), (era[0]+hw, era[1]+hw)], fill=_PEN_PINK)

    # ── Excited worm peeking up from below the notepad ────────────────────
    # Body segment first (drawn behind head)
    bx, by, br = 96, 170, 18
    d.ellipse([(bx-br, by-br), (bx+br, by+br)], fill=_YLW_DARK)
    d.ellipse([(bx-br+2, by-br+2), (bx+br-2, by+br-2)], fill=_YELLOW)

    img, _ = _worm_excited(img, cx=96, cy=152, r=28)
    return img


def _make_my_files() -> Image.Image:
    """Open folder + fanned papers + SIDE-PROFILE worm. Transparent background."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    # Folder shadow
    img, d = _alpha_rrect(img, (0, 0, 0, 38), [(24, 84), (176, 172)], r=16)

    # Folder tab
    d.rounded_rectangle([(22, 74), (78, 92)], radius=7, fill=_FOLD_TAB)

    # Folder back body
    d.rounded_rectangle([(22, 82), (170, 166)], radius=14,
                        fill=_FOLD_BACK, outline=_YLW_DARK, width=2)

    # ── Fanned papers (right to left so leftmost is on top) ───────────────
    papers = [
        (_PAPER_P, (128, 36, 162, 92)),
        (_PAPER_G, ( 96, 32, 132, 92)),
        (_PAPER_B, ( 64, 36,  98, 92)),
        (_PAPER_W, ( 32, 40,  68, 92)),
    ]
    for color, (x0, y0, x1, y1) in papers:
        d.rounded_rectangle([(x0, y0), (x1, y1)], radius=4,
                            fill=color, outline=(185, 185, 185), width=1)
        for rl in range(y0 + 10, y1 - 4, 10):
            d.line([(x0+5, rl), (x1-5, rl)], fill=(172, 172, 172), width=1)

    # Folder front panel
    d.rounded_rectangle([(22, 96), (170, 166)], radius=14,
                        fill=_FOLD_FRON, outline=_YLW_DARK, width=2)
    # Subtle top shine
    img, d = _alpha_rrect(img, (255, 255, 255, 42), [(24, 97), (168, 116)], r=12)

    # ── Side-profile worm peeking from RIGHT of the folder ────────────────
    # Body segment tucked at folder edge
    bx, by, br = 160, 112, 17
    d.ellipse([(bx-br, by-br), (bx+br, by+br)], fill=_YLW_DARK)
    d.ellipse([(bx-br+2, by-br+2), (bx+br-2, by+br-2)], fill=_YELLOW)

    # Profile head facing LEFT — looking into the folder
    img, _ = _worm_profile(img, cx=156, cy=66, r=30, facing='left')
    return img


def _make_ai_search() -> Image.Image:
    """Magnifying glass + WINKING worm inside lens + gold sparkles. Transparent bg."""
    S   = 192
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)

    lx, ly, lr = 86, 80, 56   # lens centre + radius

    # ── Handle (no separate end-cap — avoids the grey disc artefact) ────────
    h1x, h1y = 124, 118;  h2x, h2y = 160, 154;  hw_h = 11
    # Build a rounded-tip handle by drawing the body polygon + a filled
    # ellipse at the tip in one colour, then outlining both in one pass.
    handle_pts = [
        (h1x-hw_h, h1y+hw_h), (h2x-hw_h, h2y+hw_h),
        (h2x+hw_h, h2y-hw_h), (h1x+hw_h, h1y-hw_h),
    ]
    d.polygon(handle_pts, fill=_HANDLE_CLR)
    d.ellipse([(h2x-hw_h, h2y-hw_h), (h2x+hw_h, h2y+hw_h)], fill=_HANDLE_CLR)
    # Single outline pass over combined shape — no double-circle artefact
    d.polygon(handle_pts, outline=(190, 190, 190), width=2)

    # ── Lens tint ─────────────────────────────────────────────────────────
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(lay).ellipse([(lx-lr, ly-lr), (lx+lr, ly+lr)],
                                fill=_GLASS_LENS)
    img = Image.alpha_composite(img, lay)
    d   = ImageDraw.Draw(img)

    # ── Winking worm INSIDE the lens ──────────────────────────────────────
    img, d = _worm_winking(img, cx=lx, cy=ly, r=30)

    # ── Lens rim ON TOP (frames the worm) ─────────────────────────────────
    d.ellipse([(lx-lr, ly-lr), (lx+lr, ly+lr)], outline=_GLASS_RIM, width=10)
    # Thin dark outline for light-background visibility
    d.ellipse([(lx-lr, ly-lr), (lx+lr, ly+lr)], outline=(160, 160, 160), width=2)

    # ── Gold sparkles ─────────────────────────────────────────────────────
    d.polygon(_star4(lx+56, ly-54, 15, 5), fill=_SPARK)   # large — upper right
    d.polygon(_star4(lx-60, ly-30,  9, 3), fill=_SPARK)   # medium — upper left
    d.polygon(_star4(lx+10, ly-68,  7, 2), fill=_SPARK)   # small — above
    d.ellipse([(lx+64, ly+4),  (lx+72, ly+12)], fill=_SPARK)   # dot right
    d.ellipse([(lx-52, ly+50), (lx-46, ly+56)], fill=_SPARK)   # dot lower left

    return img


# ── Public API ────────────────────────────────────────────────────────────────

_SHORTCUT_ICONS = [
    ("shortcut-new-note-192.png",  _make_new_note),
    ("shortcut-my-files-192.png",  _make_my_files),
    ("shortcut-ai-search-192.png", _make_ai_search),
]


def generate_shortcut_icons(out_dir: str = _OUT_DIR, force: bool = False) -> None:
    """Write shortcut PNGs as RGBA (transparent background) to *out_dir*.
    Skips existing files unless force=True.
    """
    os.makedirs(out_dir, exist_ok=True)
    for name, maker in _SHORTCUT_ICONS:
        path = os.path.join(out_dir, name)
        if not force and os.path.exists(path):
            continue
        img = maker()   # already RGBA — save directly, no flattening
        img.save(path, "PNG", optimize=True)
        print(f"  [shortcut-icons] wrote {name}")


if __name__ == "__main__":
    generate_shortcut_icons(force=True)
    print("Done.")
