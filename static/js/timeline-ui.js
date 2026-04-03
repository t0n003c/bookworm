/* ================================================================
   BookWorm – Timeline UI Extras  (loaded after timeline-render.js,
   before timeline.js)
   Exports window._bwTLUi = { buildLegend, buildMinimap, collectCategories }
   All functions are pure builders — no internal state.
   ================================================================ */

window._bwTLUi = (function () {
  'use strict';

  // ── Category collector ──────────────────────────────────────
  // Reads data-cat-name / data-cat-color from the category pill spans
  // already rendered in #note-list.  First colour seen wins dedup.
  function collectCategories() {
    const seen = new Map(); // color → name
    document.querySelectorAll('#note-list [data-cat-name]').forEach(el => {
      const name  = el.getAttribute('data-cat-name')  || '';
      const color = el.getAttribute('data-cat-color') || '';
      if (name && color && !seen.has(color)) seen.set(color, name);
    });
    return [...seen.entries()].map(([color, name]) => ({ color, name }));
  }

  // ── Category legend ──────────────────────────────────────
  // Collapsible panel anchored bottom-left, above the minimap.
  // Returns { el } or null when there are no categories.
  function buildLegend(categories, t) {
    if (!categories.length) return null;

    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', left: '12px', bottom: '52px',
      zIndex: '11', userSelect: 'none',
    });

    // Toggle header button
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
    chevEl.textContent = '▲';
    header.append('\uD83C\uDFF7\uFE0F ', chevEl);
    header.addEventListener('pointerdown', e => e.stopPropagation());

    // Legend body
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
      Object.assign(lbl.style, { overflow: 'hidden', textOverflow: 'ellipsis' });
      row.append(dot, lbl);
      body.appendChild(row);
    });

    let expanded = true;
    function toggle() {
      expanded = !expanded;
      body.style.display  = expanded ? 'flex' : 'none';
      chevEl.textContent  = expanded ? '▲' : '▼';
    }
    header.addEventListener('click', e => { e.stopPropagation(); toggle(); });

    el.append(header, body);
    return el;
  }

  // ── Minimap ──────────────────────────────────────────────────
  // 36px strip at the very bottom.  Note dots are date-proportional
  // (zoom-invariant).  The viewport indicator updates every frame.
  // Clicking jumps the timeline to that date.
  //
  // getRail()      → current rail element (changes on zoom rebuild)
  // getPxPerDay()  → current _pxPerDay value
  // jumpCb(railX)  → called when user clicks; host code animates the rail
  function buildMinimap(notes, earliest, span, getRail, getPxPerDay, PAD_ENDS, outer, t, jumpCb) {
    const safeSpan = span || 1;
    const MMAP_H   = 36;
    const DOT_R    = 3;
    const PAD_H    = 12; // horizontal padding inside the strip

    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Timeline minimap – click to jump');
    Object.assign(el.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0',
      height: MMAP_H + 'px',
      background: t.btnBg, borderTop: `1px solid ${t.btnBord}`,
      zIndex: '10', cursor: 'pointer', overflow: 'hidden',
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());

    // Note dots – static
    notes.forEach(n => {
      const days = Math.round((n.date - earliest) / 86_400_000);
      const frac = days / safeSpan;
      const dot  = document.createElement('div');
      Object.assign(dot.style, {
        position: 'absolute',
        bottom: (Math.floor(MMAP_H / 2) - DOT_R) + 'px',
        width: (DOT_R * 2) + 'px', height: (DOT_R * 2) + 'px',
        borderRadius: '50%',
        background: n.catColor || t.spine,
        left: `calc(${PAD_H}px + (100% - ${PAD_H * 2}px) * ${frac.toFixed(5)})`,
        transform: 'translateX(-50%)',
        pointerEvents: 'none', zIndex: '2',
      });
      el.appendChild(dot);
    });

    // Viewport indicator
    const vp = document.createElement('div');
    Object.assign(vp.style, {
      position: 'absolute', top: '3px', bottom: '3px',
      background: t.spine, opacity: '0.15',
      borderRadius: '3px', pointerEvents: 'none', zIndex: '1',
      transition: 'left .05s linear, width .05s linear',
    });
    el.appendChild(vp);

    function update() {
      const rail = getRail();
      if (!rail) return;
      const rl    = parseFloat(rail.style.left) || 0;
      const ow    = outer.offsetWidth  || 1;
      const px    = getPxPerDay();
      const dayL  = (-rl - PAD_ENDS) / px;
      const dayR  = (-rl - PAD_ENDS + ow) / px;
      const propL = Math.max(0, Math.min(1, dayL / safeSpan));
      const propR = Math.max(0, Math.min(1, dayR / safeSpan));
      const mw    = (outer.offsetWidth || 1) - PAD_H * 2;
      vp.style.left  = (PAD_H + propL * mw) + 'px';
      vp.style.width = Math.max(8, (propR - propL) * mw) + 'px';
    }

    el.addEventListener('click', e => {
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1,
        (e.clientX - rect.left - PAD_H) / (rect.width - PAD_H * 2)));
      if (jumpCb) jumpCb(PAD_ENDS + frac * safeSpan * getPxPerDay());
    });

    return { el, update };
  }

  return { buildLegend, buildMinimap, collectCategories };
})();