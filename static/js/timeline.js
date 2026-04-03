/* ================================================================
   BookWorm – Timeline View  v2
   window.bwTimeline  →  { mount, unmount, remount, isMounted }

   Architecture
   ────────────
   • An absolutely-positioned overlay div is appended to #main-content
     (not to #note-list), so it always fills the full available area.
   • #note-list continues to receive normal HTMX swaps; we just read
     data-* attrs from its articles when (re)building the timeline.
   • Window drag listeners are tracked and removed on unmount/remount
     to prevent accumulation.
   ================================================================ */

window.bwTimeline = (function () {
  'use strict';

  // ── Layout (px/day is mutable for zoom) ──────────────────────
  let   _pxPerDay = 5;
  const PX_MIN    = 1.5;
  const PX_MAX    = 60;
  const SPINE_Y   = 0.50;   // spine at 50% of container height
  const CARD_W    = 196;
  const STEM_H    = 52;
  const PAD_ENDS  = 160;    // rail padding left & right (px)

  // ── Module state ─────────────────────────────────────────────
  let _mounted         = false;
  let _savedMainStyles = {};
  let _rafId           = null;
  let _overlay         = null;   // the abs-positioned overlay div
  let _dragCleanup     = null;   // fn that removes window drag listeners

  // ── Date helpers ─────────────────────────────────────────────
  function _parseDate(str) {
    if (!str) return null;
    const s = str.length > 10 ? str.replace(' ', 'T') : str + 'T00:00:00';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function _daysBetween(a, b) {
    return Math.round((b - a) / 86_400_000);
  }
  function _fmtDate(str) {
    const d = _parseDate(str);
    if (!d) return str || '';
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Theme ────────────────────────────────────────────────────
  function _isDark() {
    return document.documentElement.classList.contains('dark');
  }
  function _theme() {
    const dark = _isDark();
    return {
      spine:     dark ? '#3b82f6' : '#0053e2',
      spineFade: dark ? 'rgba(59,130,246,0.4)'  : 'rgba(0,83,226,0.35)',
      tick:      dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)',
      tickYear:  dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.28)',
      label:     dark ? '#52525b' : '#9ca3af',
      labelYear: dark ? '#a1a1aa' : '#6b7280',
      cardBg:    dark ? '#18181b' : '#ffffff',
      cardBord:  dark ? '#3f3f46' : '#e5e7eb',
      cardHov:   dark ? '#3b82f6' : '#0053e2',
      titleClr:  dark ? '#f4f4f5' : '#111827',
      subClr:    dark ? '#71717a' : '#9ca3af',
      shadow:    dark ? '0 2px 14px rgba(0,0,0,.5)'      : '0 2px 14px rgba(0,0,0,.10)',
      shadowHov: dark ? '0 4px 24px rgba(59,130,246,.4)' : '0 4px 24px rgba(0,83,226,.18)',
      emptyClr:  dark ? '#52525b' : '#9ca3af',
      mainBg:    dark ? '#09090b' : '#f9fafb',
      btnBg:     dark ? '#27272a' : '#ffffff',
      btnBord:   dark ? '#3f3f46' : '#d1d5db',
      btnClr:    dark ? '#f4f4f5' : '#374151',
      hintClr:   dark ? '#3f3f46' : '#d1d5db',
    };
  }

  // ── Collect notes from #note-list data attributes ─────────────
  function _collectNotes() {
    const nl = document.getElementById('note-list');
    if (!nl) return [];
    const notes = [];
    nl.querySelectorAll('article[data-note-id]').forEach(el => {
      const id      = el.getAttribute('data-note-id');
      const title   = el.getAttribute('data-title')        || 'Untitled';
      const icon    = el.getAttribute('data-icon')         || '';
      const dateStr = el.getAttribute('data-meeting-date') ||
                      el.getAttribute('data-created-at')   || '';
      const date    = _parseDate(dateStr);
      if (!id || !date) return;
      notes.push({ id, title, icon, dateStr, date });
    });
    return notes.sort((a, b) => a.date - b.date);
  }

  // ── Build month/year tick marks ───────────────────────────────
  function _buildTicks(rail, earliest, span, t) {
    let cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    // Stop a couple of months past the last note
    const stopMs = earliest.getTime() + (span + 62) * 86_400_000;

    while (cur.getTime() < stopMs) {
      const x     = PAD_ENDS + _daysBetween(earliest, cur) * _pxPerDay;
      const isJan = cur.getMonth() === 0;
      const th    = isJan ? 28 : 16;

      const tick = document.createElement('div');
      Object.assign(tick.style, {
        position: 'absolute', left: x + 'px',
        top: `calc(${SPINE_Y * 100}% - ${th / 2}px)`,
        width: isJan ? '2px' : '1px', height: th + 'px',
        background: isJan ? t.tickYear : t.tick,
        transform: 'translateX(-50%)', pointerEvents: 'none',
      });
      rail.appendChild(tick);

      const lbl = document.createElement('span');
      lbl.textContent = isJan
        ? String(cur.getFullYear())
        : cur.toLocaleString('default', { month: 'short' });
      Object.assign(lbl.style, {
        position: 'absolute', left: x + 'px',
        top: `calc(${SPINE_Y * 100}% + 18px)`,
        transform: 'translateX(-50%)',
        fontSize: isJan ? '11px' : '9px', fontWeight: isJan ? '700' : '400',
        color: isJan ? t.labelYear : t.label,
        whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: '.02em',
      });
      rail.appendChild(lbl);

      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }

  // ── Build one note pin (dot + stem + card) ────────────────────
  function _buildPin(rail, note, x, above, t) {
    const DOT = 10, GAP = 8;

    // Spine dot
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute', left: x + 'px', top: `${SPINE_Y * 100}%`,
      width: DOT + 'px', height: DOT + 'px', borderRadius: '50%',
      background: t.spine, transform: 'translate(-50%,-50%)',
      zIndex: '2', pointerEvents: 'none',
    });
    rail.appendChild(dot);

    // Vertical stem
    const stem = document.createElement('div');
    Object.assign(stem.style, {
      position: 'absolute', left: x + 'px',
      top:  above ? `calc(${SPINE_Y * 100}% - ${STEM_H}px)` : `${SPINE_Y * 100}%`,
      width: '2px', height: STEM_H + 'px',
      background: t.spineFade, transform: 'translateX(-50%)',
      pointerEvents: 'none',
    });
    rail.appendChild(stem);

    // Note card
    const card = document.createElement('article');
    card.setAttribute('role',       'button');
    card.setAttribute('tabindex',   '0');
    card.setAttribute('aria-label', `Open note: ${note.title}`);
    card.setAttribute('hx-get',    `/notes/${note.id}`);
    card.setAttribute('hx-target', '#detail-panel');
    card.setAttribute('hx-swap',   'innerHTML');
    card.setAttribute('onkeydown',
      "if(event.key==='Enter'||event.key===' '){this.click()}");

    const vertStyle = above
      ? { bottom: `calc(${(1 - SPINE_Y) * 100}% + ${STEM_H + GAP}px)` }
      : { top:    `calc(${SPINE_Y * 100}%        + ${STEM_H + GAP}px)` };

    Object.assign(card.style, {
      position: 'absolute', left: (x - CARD_W / 2) + 'px', width: CARD_W + 'px',
      background: t.cardBg, border: `1px solid ${t.cardBord}`,
      borderRadius: '10px', padding: '10px 12px', boxShadow: t.shadow,
      cursor: 'pointer', pointerEvents: 'all', zIndex: '3',
      transition: 'box-shadow .15s, border-color .15s', ...vertStyle,
    });
    card.innerHTML =
      `<h3 style="font-size:.8rem;font-weight:700;color:${t.titleClr};
                  margin:0 0 4px;line-height:1.35;
                  display:-webkit-box;-webkit-line-clamp:2;
                  -webkit-box-orient:vertical;overflow:hidden;">
        ${note.icon ? `<span aria-hidden="true">${_esc(note.icon)} </span>` : ''}${_esc(note.title)}
      </h3>
      <time style="font-size:.7rem;color:${t.subClr};display:block;">
        \u{1F4C5} ${_fmtDate(note.dateStr)}
      </time>`;

    card.addEventListener('mouseenter', () => {
      card.style.boxShadow   = t.shadowHov;
      card.style.borderColor = t.cardHov;
    });
    card.addEventListener('mouseleave', () => {
      card.style.boxShadow   = t.shadow;
      card.style.borderColor = t.cardBord;
    });
    rail.appendChild(card);
    if (window.htmx) htmx.process(card);
  }

  // ── Build the scrollable rail at current _pxPerDay ───────────
  function _buildRail(notes, t) {
    const earliest = notes[0].date;
    const span     = notes.length > 1
      ? _daysBetween(earliest, notes[notes.length - 1].date)
      : 30;
    const railW = Math.max(span * _pxPerDay + PAD_ENDS * 2, 600);

    const rail = document.createElement('div');
    Object.assign(rail.style, {
      position: 'absolute', top: '0', bottom: '0',
      left: '0px', width: railW + 'px', pointerEvents: 'none',
    });

    // Central spine
    const spine = document.createElement('div');
    Object.assign(spine.style, {
      position: 'absolute', top: `${SPINE_Y * 100}%`,
      left: '0', right: '0', height: '3px',
      background: t.spine, borderRadius: '2px', transform: 'translateY(-50%)',
    });
    rail.appendChild(spine);

    _buildTicks(rail, earliest, span, t);
    notes.forEach((n, i) => {
      const x = PAD_ENDS + _daysBetween(earliest, n.date) * _pxPerDay;
      _buildPin(rail, n, x, i % 2 === 0, t);
    });

    // Stash metadata for drag clamping and scroll-to-recent
    rail._earliest = earliest;
    rail._span     = span;
    rail._railW    = railW;
    return rail;
  }

  // ── Drag with momentum ────────────────────────────────────────
  function _attachDrag(outer, getRail) {
    let dragging = false, didDrag = false;
    let startX = 0, startLeft = 0, lastX = 0, lastTime = 0, velX = 0;

    function clamp(v) {
      const minL = -(getRail()._railW - outer.offsetWidth + 80);
      return Math.min(0, Math.max(minL, v));
    }
    function down(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; didDrag = false;
      startX    = e.touches ? e.touches[0].clientX : e.clientX;
      startLeft = parseFloat(getRail().style.left) || 0;
      lastX = startX; lastTime = Date.now(); velX = 0;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      outer.style.cursor = 'grabbing';
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      if (Math.abs(cx - startX) > 3) didDrag = true;
      const now = Date.now(), dt = now - lastTime || 1;
      velX = (cx - lastX) / dt * 16;
      lastX = cx; lastTime = now;
      getRail().style.left = clamp(startLeft + (cx - startX)) + 'px';
      e.preventDefault();
    }
    function up() {
      if (!dragging) return;
      dragging = false; outer.style.cursor = 'grab';
      let pos = parseFloat(getRail().style.left) || 0;
      function decay() {
        velX *= 0.93;
        if (Math.abs(velX) < 0.4) return;
        pos = clamp(pos + velX);
        getRail().style.left = pos + 'px';
        _rafId = requestAnimationFrame(decay);
      }
      _rafId = requestAnimationFrame(decay);
    }
    function clickGuard(e) {
      if (didDrag) { e.stopPropagation(); e.preventDefault(); didDrag = false; }
    }

    outer.addEventListener('click',      clickGuard, true);
    outer.addEventListener('mousedown',  down);
    outer.addEventListener('touchstart', down,  { passive: false });
    window.addEventListener('mousemove',  move);
    window.addEventListener('touchmove',  move, { passive: false });
    window.addEventListener('mouseup',    up);
    window.addEventListener('touchend',   up);

    // Return a cleanup fn to remove window-scoped listeners
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup',   up);
      window.removeEventListener('touchend',  up);
    };
  }

  // ── Zoom helper (wheel + buttons share this) ──────────────────
  function _doZoom(outer, notes, t, getRail, setRail, factor, focalX) {
    const newPx = Math.max(PX_MIN, Math.min(PX_MAX, _pxPerDay * factor));
    if (Math.abs(newPx - _pxPerDay) < 0.01) return;

    const oldLeft = parseFloat(getRail().style.left) || 0;
    const railX   = -oldLeft + focalX;      // pixels from rail-left at focal point
    const ratio   = newPx / _pxPerDay;
    _pxPerDay     = newPx;

    const newRail = _buildRail(notes, t);
    // Maintain focal point: focalX = newLeft + railX * ratio  → newLeft = focalX - railX * ratio
    const clampedLeft = Math.min(0, focalX - railX * ratio);
    newRail.style.left = clampedLeft + 'px';
    getRail().replaceWith(newRail);
    setRail(newRail);
  }

  // ── Build the outer timeline container ───────────────────────
  function _buildTimeline(notes) {
    const t = _theme();

    // Empty state
    if (!notes.length) {
      const d = document.createElement('div');
      Object.assign(d.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'absolute', inset: '0', background: t.mainBg,
      });
      d.innerHTML =
        `<p style="color:${t.emptyClr};font-size:.875rem;">
           No dated notes to display on the timeline yet.
         </p>`;
      return d;
    }

    // ── Outer container (fills the overlay, handles drag) ────
    const outer = document.createElement('div');
    Object.assign(outer.style, {
      position: 'absolute', inset: '0',
      overflow: 'hidden', userSelect: 'none',
      cursor: 'grab', background: t.mainBg,
    });

    // ── Rail (wider than outer, slides left/right) ───────────
    let _rail = _buildRail(notes, t);
    outer.appendChild(_rail);

    const getRail = ()  => _rail;
    const setRail = (r) => { _rail = r; outer.appendChild(r); };

    // ── Drag ────────────────────────────────────────────────
    const cleanupDrag = _attachDrag(outer, getRail);
    outer._cleanup = cleanupDrag;

    // ── Wheel zoom ──────────────────────────────────────────
    outer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = outer.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      _doZoom(outer, notes, t, getRail, setRail,
               e.deltaY < 0 ? 1.15 : 1 / 1.15, focalX);
    }, { passive: false });

    // ── Zoom buttons (+/-) ───────────────────────────────────
    function makeZoomBtn(label, direction) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.setAttribute('aria-label',  direction > 0 ? 'Zoom in'  : 'Zoom out');
      btn.setAttribute('title',       direction > 0 ?
        'Zoom in  (or scroll wheel up)' : 'Zoom out (or scroll wheel down)');
      Object.assign(btn.style, {
        position: 'absolute', top: '12px',
        right: direction > 0 ? '12px' : '50px',
        width: '32px', height: '32px', borderRadius: '8px',
        background: t.btnBg, border: `1px solid ${t.btnBord}`,
        color: t.btnClr, fontSize: '18px', lineHeight: '1',
        cursor: 'pointer', zIndex: '10', pointerEvents: 'all',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,.12)',
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _doZoom(outer, notes, t, getRail, setRail,
                 direction > 0 ? 1.3 : 1 / 1.3,
                 outer.offsetWidth / 2);   // zoom around screen centre
      });
      return btn;
    }
    outer.appendChild(makeZoomBtn('+', +1));
    outer.appendChild(makeZoomBtn('\u2212', -1));  // − (minus sign)

    // ── Hint label ──────────────────────────────────────────
    const hint = document.createElement('div');
    hint.setAttribute('aria-hidden', 'true');
    Object.assign(hint.style, {
      position: 'absolute', bottom: '14px', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '10px', color: t.hintClr,
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
    });
    hint.textContent = '\u2190 drag to navigate \u2192  \u00b7  scroll or use +/\u2212 to zoom';
    outer.appendChild(hint);

    // ── Auto-scroll to most-recent note (65% from left) ─────
    outer._scrollToRecent = () => {
      const r      = getRail();
      const cw     = outer.offsetWidth;
      const target = PAD_ENDS + r._span * _pxPerDay - cw * 0.65;
      r.style.left = Math.min(0, -Math.max(0, target)) + 'px';
    };

    return outer;
  }

  // ── Public: mount ─────────────────────────────────────────────
  function mount() {
    if (_mounted) return;
    const main = document.getElementById('main-content');
    if (!main) return;

    // Override main-content styles once; remember originals
    _savedMainStyles = {
      position: main.style.position,
      overflow: main.style.overflow,
      padding:  main.style.padding,
    };
    main.style.position = 'relative';
    main.style.overflow = 'hidden';
    main.style.padding  = '0';

    // Create the overlay that fills #main-content
    _overlay = document.createElement('div');
    _overlay.id = '_bw-tl-overlay';
    Object.assign(_overlay.style, {
      position: 'absolute', inset: '0', zIndex: '10',
    });

    const notes = _collectNotes();
    const tl    = _buildTimeline(notes);
    if (tl._cleanup) _dragCleanup = tl._cleanup;
    _overlay.appendChild(tl);
    main.appendChild(_overlay);

    if (tl._scrollToRecent) requestAnimationFrame(tl._scrollToRecent);
    _mounted = true;
  }

  // ── Public: unmount ───────────────────────────────────────────
  function unmount() {
    if (_rafId)      { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_dragCleanup){ _dragCleanup(); _dragCleanup = null; }

    const main = document.getElementById('main-content');
    if (main) {
      // Restore exactly what was there before (usually '' which lets CSS take over)
      main.style.position = _savedMainStyles.position ?? '';
      main.style.overflow = _savedMainStyles.overflow ?? '';
      main.style.padding  = _savedMainStyles.padding  ?? '';
    }
    _savedMainStyles = {};
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _pxPerDay = 5;    // reset zoom for next mount
    _mounted  = false;
  }

  // ── Public: remount (called after HTMX refreshes #note-list) ─
  // Main-content styles are ALREADY set — we only rebuild the visuals.
  function remount() {
    if (_rafId)      { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_dragCleanup){ _dragCleanup(); _dragCleanup = null; }

    // If overlay was lost somehow, fall back to full mount
    if (!_overlay) { mount(); return; }

    _overlay.innerHTML = '';
    const notes = _collectNotes();
    const tl    = _buildTimeline(notes);
    if (tl._cleanup) _dragCleanup = tl._cleanup;
    _overlay.appendChild(tl);
    if (tl._scrollToRecent) requestAnimationFrame(tl._scrollToRecent);
    // _mounted stays true; _savedMainStyles stays intact
  }

  function isMounted() { return _mounted; }

  return { mount, unmount, remount, isMounted };

})();