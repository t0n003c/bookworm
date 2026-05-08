"""Generate PWA icon assets for BookWorm.

Produces four PNG files inside static/img/icons/:
  icon-192.png          — standard 192×192
  icon-512.png          — standard 512×512
  icon-maskable-512.png — 512×512 with safe-zone padding (Android adaptive icon)
  apple-touch-icon.png  — 180×180 for iOS "Add to Home Screen"

All files are only written if they don't already exist, so this is safe to
call on every startup — it only does real work on the first run.

Design: Walmart blue rounded square, open book with worm peeking from spine.
"""
import os
from PIL import Image, ImageDraw

_BLUE   = "#0053e2"   # Walmart primary
_WHITE  = "#ffffff"
_YELLOW = "#ffc220"   # Spark accent (worm)
_PG_R   = "#dce8fc"   # right-page tint
_LINE_L = "#b8d0f7"   # left-page line colour
_LINE_R = "#aac8f5"   # right-page line colour

_OUT_DIR = os.path.join(os.path.dirname(__file__), "static", "img", "icons")

_SPECS = [
    ("icon-192.png",          192, False),
    ("icon-512.png",          512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png",  180, False),
]


def _hex(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _make_icon(size: int, maskable: bool) -> Image.Image:
    """Draw one icon at *size*×*size*. maskable=True adds 10 % safe-zone pad."""
    pad = int(size * 0.10) if maskable else 0
    img  = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d    = ImageDraw.Draw(img)

    # ── Blue rounded background ──────────────────────────────────────────────
    r = int(size * 0.22)
    d.rounded_rectangle(
        [(pad, pad), (size - pad - 1, size - pad - 1)],
        radius=r, fill=_BLUE,
    )

    # ── Book body ────────────────────────────────────────────────────────────
    bx  = int(size * 0.155) + pad
    by  = int(size * 0.200) + pad
    bw  = int(size * 0.690)
    bh  = int(size * 0.570)
    sp  = int(size * 0.035)   # spine half-width

    mid = bx + bw // 2

    # Left page
    d.rectangle([(bx, by), (mid - sp, by + bh)], fill=_WHITE)
    # Right page
    d.rectangle([(mid + sp, by), (bx + bw, by + bh)], fill=_PG_R)
    # Spine strip
    d.rectangle([(mid - sp, by - int(size * 0.01)),
                 (mid + sp, by + bh + int(size * 0.01))], fill=_BLUE)

    # ── Text lines ───────────────────────────────────────────────────────────
    lh  = max(2, int(size * 0.025))
    gap = int(size * 0.070)

    # Left page lines
    lx0 = bx + int(size * 0.045)
    lx1 = mid - sp - int(size * 0.035)
    ly  = by + int(size * 0.095)
    for _ in range(5):
        if ly + lh < by + bh - int(size * 0.06):
            d.rectangle([(lx0, ly), (lx1, ly + lh)], fill=_LINE_L)
            ly += gap

    # Right page lines (slightly shorter last one)
    lx0 = mid + sp + int(size * 0.035)
    lx1 = bx + bw - int(size * 0.045)
    ly  = by + int(size * 0.095)
    for i in range(5):
        if ly + lh < by + bh - int(size * 0.06):
            x1 = lx1 if i < 4 else lx0 + int((lx1 - lx0) * 0.55)
            d.rectangle([(lx0, ly), (x1, ly + lh)], fill=_LINE_R)
            ly += gap

    # ── Book cover bottom strip ───────────────────────────────────────────────
    ct = by + bh - int(size * 0.03)
    d.rounded_rectangle(
        [(bx, ct), (bx + bw, by + bh + int(size * 0.04))],
        radius=int(size * 0.025), fill=_BLUE,
    )

    # ── Worm peeking from spine ───────────────────────────────────────────────
    wx = mid
    wr = int(size * 0.075)
    wy = by - wr + int(size * 0.005)          # head centre y (sits on book top)

    # Body segments (two, below head, hidden behind book)
    seg_r = int(wr * 0.65)
    d.ellipse([(wx - seg_r, wy + wr - 2),
               (wx + seg_r, wy + wr - 2 + seg_r * 2)], fill=_YELLOW)

    # Head
    d.ellipse([(wx - wr, wy - wr), (wx + wr, wy + wr)], fill=_YELLOW)

    # Eyes
    er = max(1, int(size * 0.013))
    ex_off = int(wr * 0.36)
    ey_off = int(wr * 0.15)
    for ex in (wx - ex_off, wx + ex_off):
        d.ellipse([(ex - er, wy - ey_off - er),
                   (ex + er, wy - ey_off + er)], fill="#1a2e5c")

    # Smile
    smile_r = int(wr * 0.38)
    d.arc(
        [(wx - smile_r, wy + int(wr * 0.05)),
         (wx + smile_r, wy + int(wr * 0.55))],
        start=10, end=170, fill="#1a2e5c", width=max(1, int(size * 0.013)),
    )

    # Antennae tips
    at_r = max(1, int(size * 0.016))
    for ax, ay in (
        (wx - int(wr * 0.55), wy - int(wr * 0.90)),
        (wx + int(wr * 0.10), wy - int(wr * 1.10)),
    ):
        d.ellipse([(ax - at_r, ay - at_r), (ax + at_r, ay + at_r)], fill=_YELLOW)

    return img


def generate_icons(out_dir: str = _OUT_DIR) -> None:
    """Create PNG icons under *out_dir*; skips files that already exist."""
    os.makedirs(out_dir, exist_ok=True)
    for name, size, maskable in _SPECS:
        path = os.path.join(out_dir, name)
        if os.path.exists(path):
            continue
        img = _make_icon(size, maskable)
        # Flatten RGBA → RGB on solid blue bg (required for Apple touch icon)
        bg = Image.new("RGB", (size, size), _BLUE)
        bg.paste(img, mask=img.split()[3])
        bg.save(path, "PNG", optimize=True)
