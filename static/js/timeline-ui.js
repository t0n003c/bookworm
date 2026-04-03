/* ================================================================
   BookWorm – Timeline UI Extras  v2
   Exports window._bwTLUi = {
     buildLegend, buildMinimap, buildWorm, collectCategories
   }
   All functions are pure builders — callers own DOM insertion.
   ================================================================ */

window._bwTLUi = (function () {
  'use strict';

  // ─ Constants shared across helpers ─────────────────────────
  const MMAP_H  = 44;   // minimap strip height (px)
  const PAD_H   = 10;   // minimap horizontal padding
  const TRACK_Y = 30;   // y-offset of track line inside minimap
  const DOT_R   = 3;    // note-dot radius (px)

  // ── Category collector ──────────────────────────────────────
  // Reads data-cat-name / data-cat-color from the category pill spans
  // already rendered in #note-list.  First colour seen wins dedup.
  function collectCategories() {
    const seen = new Map();
    document.querySelectorAll('#note-list [data-cat-name]').forEach(el => {
      const name  = el.getAttribute('data-cat-name')  || '';
      const color = el.getAttribute('data-cat-color') || '';
      if (name && color && !seen.has(color)) seen.set(color, name);
    });
    return [...seen.entries()].map(([color, name]) => ({ color, name }));
  }

  // ── Category legend ──────────────────────────────────────
  // Collapsible panel bottom-left, above the minimap.
  // Returns el or null when workspace has no categories.
  function buildLegend(categories, t) {
    if (!categories.length) return null;
    const ABOVE = MMAP_H + 16;  // px above bottom edge

    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', left: '12px', bottom: ABOVE + 'px',
      zIndex: '11', userSelect: 'none',
    });

    const header = document.createElement('button');
    header.setAttribute('aria-label', 'Toggle category legend');
    header.setAttribute('title',      'Toggle category legend');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '5px',
      background: t.btnBg, border: `1px solid ${t.btnBord}`,
      borderRadius: '8px', padding: '4px 9px', cursor: 'pointer',
      fontSize: '11px', fontWeight: '600', color: t.btnClr,
      boxShadow: '0 1px 4px rgba(0,0,0,.12)',
      lineHeight: '1.4', pointerEvents: 'all',
    });
    const chevEl = document.createElement('span');
    chevEl.textContent = '\u25b2';
    header.append('\uD83C\uDFF7\uFE0F ', chevEl);
    header.addEventListener('pointerdown', e => e.stopPropagation());

    const body = document.createElement('div');
    Object.assign(body.style, {
      marginTop: '4px',
      background: t.btnBg, border: `1px solid ${t.btnBord}`,
      borderRadius: '8px', padding: '6px 10px',
      boxShadow: '0 1px 4px rgba(0,0,0,.12)',
      display: 'flex', flexDirection: 'column', gap: '5px',
      pointerEvents: 'all',
    });
    body.addEventListener('pointerdown', e => e.stopPropagation());

    categories.forEach(({ name, color }) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '7px',
        fontSize: '11px', color: t.titleClr,
        whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '160px',
      });
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width: '9px', height: '9px', borderRadius: '50%',
        background: color, flexShrink: '0', display: 'inline-block',
      });
      const lbl = document.createElement('span');
      lbl.textContent = name;
      lbl.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
      row.append(dot, lbl);
      body.appendChild(row);
    });

    let expanded = true;
    header.addEventListener('click', e => {
      e.stopPropagation();
      expanded = !expanded;
      body.style.display = expanded ? 'flex' : 'none';
      chevEl.textContent = expanded ? '\u25b2' : '\u25bc';
    });

    el.append(header, body);
    return el;
  }

  // ── Minimap ──────────────────────────────────────────────────
  // A 44px overview strip at the bottom of the timeline.
  // │ 2025        2026        2027     │← year labels
  // │    ───•────────┃────•────┃      │← track + dots + TODAY
  //   ^-- viewport indicator (border box)
  //
  // Note dots are date-proportional and zoom-invariant.
  // Viewport indicator updates on every drag/zoom frame.
  // Clicking anywhere jumps the main timeline to that date.
  function buildMinimap(notes, earliest, span, getRail, getPxPerDay, PAD_ENDS, outer, t, jumpCb) {
    const safeSpan = Math.max(span, 1);

    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Timeline overview — click to jump');
    Object.assign(el.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0',
      height: MMAP_H + 'px',
      background: t.cardBg, borderTop: `1px solid ${t.btnBord}`,
      zIndex: '10', cursor: 'crosshair', userSelect: 'none', overflow: 'hidden',
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());

    // ─ horizontal track line ────────────────────────────────
    const track = document.createElement('div');
    Object.assign(track.style, {
      position: 'absolute', left: PAD_H + 'px', right: PAD_H + 'px',
      top: TRACK_Y + 'px', height: '1px',
      background: t.tick, pointerEvents: 'none',
    });
    el.appendChild(track);

    // ─ year labels + tick marks ────────────────────────────
    function _frac(date) {
      return Math.round((date - earliest) / 86_400_000) / safeSpan;
    }
    const startYear = earliest.getFullYear();
    const endDate   = new Date(earliest.getTime() + safeSpan * 86_400_000);
    const endYear   = endDate.getFullYear() + 1;
    for (let y = startYear; y <= endYear; y++) {
      const f = _frac(new Date(y, 0, 1));
      if (f < -0.02 || f > 1.05) continue;
      const pct = `calc(${PAD_H}px + (100% - ${PAD_H * 2}px) * ${f.toFixed(5)})`;

      const lbl = document.createElement('span');
      lbl.textContent = String(y);
      Object.assign(lbl.style, {
        position: 'absolute', left: pct, top: '6px',
        transform: 'translateX(-50%)',
        fontSize: '8px', fontWeight: '700', color: t.labelYear,
        whiteSpace: 'nowrap', pointerEvents: 'none',
      });
      el.appendChild(lbl);

      const ytick = document.createElement('div');
      Object.assign(ytick.style, {
        position: 'absolute', left: pct, top: (TRACK_Y - 5) + 'px',
        width: '1px', height: '10px',
        background: t.tickYear, pointerEvents: 'none',
      });
      el.appendChild(ytick);
    }

    // ─ TODAY marker ────────────────────────────────────
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    const todayF    = _frac(todayDate);
    if (todayF >= 0 && todayF <= 1) {
      const todayPct = `calc(${PAD_H}px + (100% - ${PAD_H * 2}px) * ${todayF.toFixed(5)})`;
      const todayMk  = document.createElement('div');
      Object.assign(todayMk.style, {
        position: 'absolute', left: todayPct,
        top: (TRACK_Y - 7) + 'px', width: '2px', height: '14px',
        background: '#ffc220', transform: 'translateX(-50%)',
        pointerEvents: 'none', zIndex: '3',
      });
      el.appendChild(todayMk);
    }

    // ─ note dots ────────────────────────────────────────
    notes.forEach(n => {
      const f   = Math.max(0, Math.min(1, _frac(n.date)));
      const pct = `calc(${PAD_H}px + (100% - ${PAD_H * 2}px) * ${f.toFixed(5)})`;
      const dot = document.createElement('div');
      Object.assign(dot.style, {
        position: 'absolute', left: pct,
        top: (TRACK_Y - DOT_R) + 'px',
        width: (DOT_R * 2) + 'px', height: (DOT_R * 2) + 'px',
        borderRadius: '50%', background: n.catColor || t.spine,
        transform: 'translateX(-50%)',
        pointerEvents: 'none', zIndex: '2',
      });
      el.appendChild(dot);
    });

    // ─ viewport indicator ───────────────────────────────
    // A clearly-bordered rect that tracks what portion of the full
    // timeline is currently visible.  Uses a border (not just opacity)
    // so it's always visible regardless of content behind it.
    const vp = document.createElement('div');
    Object.assign(vp.style, {
      position: 'absolute', top: '2px', bottom: '2px',
      background: t.spine, opacity: '0.10',
      border: `1.5px solid ${t.spine}`,
      borderRadius: '3px', pointerEvents: 'none',
      zIndex: '1', boxSizing: 'border-box',
    });
    el.appendChild(vp);

    // update is called every drag/zoom frame
    function update() {
      const rail = getRail();
      if (!rail) return;
      const rl  = parseFloat(rail.style.left) || 0;
      const ow  = outer.offsetWidth  || 1;
      const px  = getPxPerDay();
      const mw  = ow - PAD_H * 2;
      // Day indices at the left and right edges of the viewport
      const dL  = (-rl - PAD_ENDS) / px;
      const dR  = dL + ow / px;
      const pL  = Math.max(0, Math.min(1, dL / safeSpan));
      const pR  = Math.max(0, Math.min(1, dR / safeSpan));
      vp.style.left  = (PAD_H + pL * mw) + 'px';
      vp.style.width = Math.max(4, (pR - pL) * mw) + 'px';
    }

    // click → jump main view to that date
    el.addEventListener('click', e => {
      const rect  = el.getBoundingClientRect();
      const frac  = Math.max(0, Math.min(1,
        (e.clientX - rect.left - PAD_H) / (el.clientWidth - PAD_H * 2)));
      if (jumpCb) jumpCb(PAD_ENDS + frac * safeSpan * getPxPerDay());
    });

    return { el, update };
  }

  // ── Bookworm character ──────────────────────────────────────
  // 🐛 emoji that lives on the spine at TODAY’s viewport position.
  // Bobs gently while idle.  Bursts with joy when T-key is pressed.
  // Returns { el, update(railLeft, pxPerDay, PAD_ENDS), burst() }
  function buildWorm(earliest, spineY, outer) {
    // Inject keyframe CSS once per page
    if (!document.getElementById('_bw-worm-style')) {
      const s  = document.createElement('style');
      s.id     = '_bw-worm-style';
      s.textContent = [
        '@keyframes _bwIdle {',
        '  0%,100% { transform:translateY(0) rotate(-6deg); }',
        '  30%     { transform:translateY(-5px) rotate(6deg) scaleX(1.1); }',
        '  60%     { transform:translateY(-2px) rotate(-4deg); }',
        '}',
        '@keyframes _bwBurst {',
        '  0%   { transform:scale(1)   rotate(0deg)   translateY(0); }',
        '  15%  { transform:scale(2.2) rotate(-40deg) translateY(-14px); }',
        '  35%  { transform:scale(1.5) rotate(30deg)  translateY(4px); }',
        '  55%  { transform:scale(1.9) rotate(-25deg) translateY(-10px); }',
        '  75%  { transform:scale(1.3) rotate(15deg)  translateY(2px); }',
        '  100% { transform:scale(1)   rotate(0deg)   translateY(0); }',
        '}',
      ].join('\n');
      document.head.appendChild(s);
    }

    // Outer wrapper – handles left position via CSS transition
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    Object.assign(wrap.style, {
      position:   'absolute',
      top:        `${spineY * 100}%`,
      left:       '-60px',          // starts offscreen
      transform:  'translateY(-50%)',
      transition: 'left 0.12s linear',
      zIndex:     '8',
      pointerEvents: 'none',
      lineHeight: '1',
    });

    // Inner emoji – plays CSS animation independently of position
    const inner = document.createElement('span');
    inner.textContent = '\uD83D\uDC1B';  // 🐛 caterpillar
    Object.assign(inner.style, {
      fontSize: '20px',
      display:  'inline-block',
      animation: '_bwIdle 2.6s ease-in-out infinite',
      transformOrigin: 'bottom center',
    });
    wrap.appendChild(inner);

    function update(railLeft, pxPerDay, PAD_ENDS) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days  = Math.round((today - earliest) / 86_400_000);
      const vpX   = railLeft + PAD_ENDS + days * pxPerDay;
      const ow    = outer.offsetWidth || 800;
      // Always peek from whichever edge today has scrolled off to
      const PEEK  = 6;
      wrap.style.left = Math.max(PEEK, Math.min(ow - 24 - PEEK, vpX)) + 'px';
    }

    function burst() {
      // Reset animation so it replays even on repeated T-key presses
      inner.style.animation = 'none';
      void inner.offsetWidth; // force reflow
      inner.style.animation =
        '_bwBurst 0.75s ease-in-out, _bwIdle 2.6s ease-in-out 0.75s infinite';
    }

    return { el: wrap, update, burst };
  }

  return { buildLegend, buildMinimap, buildWorm, collectCategories };
})();