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

    // Start collapsed — user can expand when they need the legend.
    let expanded = false;
    body.style.display  = 'none';
    chevEl.textContent  = '\u25bc';   // ▼ (points down = expand)

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
    // ─ Inject keyframe CSS once per page ───────────────────────
    if (!document.getElementById('_bw-worm-style')) {
      const s = document.createElement('style');
      s.id    = '_bw-worm-style';
      // Idle: gentle bob + tilt.  Burst: same absolute explosion size as
      // before but scales are boosted to compensate for the smaller base.
      s.textContent = [
        '@keyframes _bwIdle {',
        '  0%,100% { transform:translateY(0)    rotate(-6deg); }',
        '  30%     { transform:translateY(-4px)  rotate(6deg) scaleX(1.1); }',
        '  60%     { transform:translateY(-1px)  rotate(-4deg); }',
        '}',
        // Single clean hop — up then back down, no spinning
        '@keyframes _bwHop {',
        '  0%   { transform:translateY(0)     scale(1); }',
        '  30%  { transform:translateY(-48px) scale(1.5); }',
        '  60%  { transform:translateY(-8px)  scale(1.2); }',
        '  80%  { transform:translateY(-2px)  scale(1.05); }',
        '  100% { transform:translateY(0)     scale(1); }',
        '}',
      ].join('\n');
      document.head.appendChild(s);
    }

    // ─ DOM elements ──────────────────────────────────────
    // wrap: positions worm on-screen (left set by RAF, no CSS transition)
    // inner: plays keyframe animation independently of position
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    Object.assign(wrap.style, {
      position:  'absolute',
      top:       `${spineY * 100}%`,
      left:      '-60px',
      transform: 'translateY(-50%)',   // vertical centering on spine
      zIndex:    '8',
      pointerEvents: 'none',
      lineHeight: '1',
    });

    const inner = document.createElement('span');
    inner.textContent = '\uD83D\uDC1B';  // \uD83D\uDC1B caterpillar
    Object.assign(inner.style, {
      fontSize:        '42px',           // large, clearly visible on the spine
      display:         'inline-block',
      animation:       '_bwIdle 2.6s ease-in-out infinite',
      transformOrigin: 'bottom center',
    });
    wrap.appendChild(inner);

    // ─ Movement state ───────────────────────────────────
    const WORM_W   = 48;    // approx. pixel width at 42px font
    const PEEK     = 8;     // min gap from viewport edges
    const SPEED_W  = 0.55;  // px per frame while wandering (slow crawl)
    const SPEED_H  = 1.5;   // px per frame while homing to today
    const PAUSE_LO = 1200;  // ms — minimum pause between wander targets
    const PAUSE_HI = 2800;  // ms — maximum pause between wander targets

    let alive    = true;
    let curX     = -60;     // current left px (tracks actual DOM position)
    let targetX  = 0;       // destination for current move
    let mode     = 'home';  // 'home' | 'wander'
    let pausing  = false;   // true while resting between wander legs
    let wanderBasePx = 0;   // pxPerDay when wander mode last started
    // Latest rail state – written by update(), read by the RAF loop
    let _rl = 0, _px = 5, _pad = 120;

    function _safeRange() {
      const ow = outer.offsetWidth || 800;
      return { lo: PEEK, hi: ow - WORM_W - PEEK };
    }
    function _clamp(x) {
      const { lo, hi } = _safeRange();
      return Math.max(lo, Math.min(hi, x));
    }
    function _todayX() {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const d = Math.round((t - earliest) / 86_400_000);
      return _clamp(_rl + _pad + d * _px);
    }
    function _randomTarget() {
      const { lo, hi } = _safeRange();
      const range = hi - lo;
      // Prefer targets that are at least 80px away from curX
      let x = lo + Math.round(Math.random() * range);
      if (Math.abs(x - curX) < 80) {
        x = _clamp(x + (x > curX ? 100 : -100));
      }
      return x;
    }
    function _schedulePause() {
      pausing = true;
      const ms = PAUSE_LO + Math.random() * (PAUSE_HI - PAUSE_LO);
      setTimeout(() => {
        if (!alive) return;
        pausing      = false;
        mode         = 'wander';
        wanderBasePx = _px;   // snapshot zoom level each time we start wandering
        targetX      = _randomTarget();
      }, ms);
    }

    // ─ RAF loop ─────────────────────────────────────────
    function _step() {
      if (!alive) return;
      requestAnimationFrame(_step);
      if (pausing) return;

      const dest  = mode === 'home' ? _todayX() : targetX;
      const speed = mode === 'home' ? SPEED_H   : SPEED_W;
      const diff  = dest - curX;

      if (Math.abs(diff) < 1) {
        curX = dest;
        // Either way (home or wander target reached), pause then wander
        _schedulePause();
      } else {
        curX += Math.sign(diff) * Math.min(speed, Math.abs(diff));
      }

      wrap.style.left = Math.round(curX) + 'px';

      // Face the direction of travel via scaleX on the wrapper transform
      // (inner still plays its rotation animation independently)
      const facing = diff > 0.5 ? ' scaleX(-1)' : ' scaleX(1)';
      wrap.style.transform = 'translateY(-50%)' + facing;
    }
    requestAnimationFrame(_step);

    // ─ Public API ──────────────────────────────────────
    function update(railLeft, pxPerDay, PAD_ENDS) {
      // Zoom-out detection: compare against the pxPerDay recorded when
      // wander mode started, NOT the previous frame.  A single wheel step
      // only changes zoom by ~1/1.15 ≈ 0.87, so per-frame comparison never
      // crosses the threshold.  Cumulative zoom-out from the wander baseline
      // is what actually matters.
      if (wanderBasePx > 0 && mode === 'wander' &&
          pxPerDay / wanderBasePx < 0.70) {
        mode         = 'home';
        pausing      = false;
        wanderBasePx = 0;
      }
      _rl  = railLeft;
      _px  = pxPerDay;
      _pad = PAD_ENDS;
    }

    function burst() {
      // Single hop up and back down — replays cleanly on every T-key press
      inner.style.animation = 'none';
      void inner.offsetWidth;  // force reflow
      inner.style.animation =
        '_bwHop 0.5s ease-out, _bwIdle 2.6s ease-in-out 0.5s infinite';
    }

    function destroy() { alive = false; }

    return { el: wrap, update, burst, destroy };
  }

  return { buildLegend, buildMinimap, buildWorm, collectCategories };
})();