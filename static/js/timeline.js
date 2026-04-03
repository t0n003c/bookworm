/* ================================================================
   BookWorm – Timeline View  v3
   window.bwTimeline  →  { mount, unmount, remount, isMounted }

   Key design decisions
   ─────────────────────
   • Spine lives on `outer` (full-width, never scrolls).
     Rail contains only: ticks, stems, dots, cards.
   • Auto-fits all notes on first open and on every remount.
   • ↔ button recalculates fit on demand after manual zooming.
   • _pxPerDay is module-level so zoom persists across redraws
     but resets to 5 on full unmount.
   ================================================================ */

window.bwTimeline = (function () {
  'use strict';

  // ── Scale constants ───────────────────────────────────────────
  let   _pxPerDay = 5;
  const PX_MIN    = 0.8;
  const PX_MAX    = 120; // allows ~8-day minimum view at full width
  const SPINE_Y   = 0.50;  // spine at 50 % of container height
  const CARD_W    = 196;
  const CARD_H    = 76;    // approx. card height for vertical lane stacking
  const STEM_H    = 52;
  const PAD_ENDS  = 120;   // left & right padding inside the rail

  // ── Module state ─────────────────────────────────────────────
  let _mounted         = false;
  let _savedMainStyles = {};
  let _rafId           = null;
  let _overlay         = null;
  let _dragCleanup     = null;

  // ── Date utilities ───────────────────────────────────────────
  function _parseDate(str) {
    if (!str) return null;
    const s = str.length > 10 ? str.replace(' ', 'T') : str + 'T00:00:00';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function _daysBetween(a, b) { return Math.round((b - a) / 86_400_000); }
  function _fmtDate(str) {
    const d = _parseDate(str);
    return d
      ? d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })
      : (str || '');
  }
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Theme ────────────────────────────────────────────────────
  function _isDark() { return document.documentElement.classList.contains('dark'); }
  function _theme() {
    const dark = _isDark();
    return {
      spine:     dark ? '#3b82f6'              : '#0053e2',
      spineFade: dark ? 'rgba(59,130,246,0.4)' : 'rgba(0,83,226,0.35)',
      tick:      dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.10)',
      tickYear:  dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.28)',
      label:     dark ? '#52525b' : '#9ca3af',
      labelYear: dark ? '#a1a1aa' : '#6b7280',
      cardBg:    dark ? '#18181b' : '#ffffff',
      cardBord:  dark ? '#3f3f46' : '#e5e7eb',
      cardHov:   dark ? '#3b82f6' : '#0053e2',
      titleClr:  dark ? '#f4f4f5' : '#111827',
      subClr:    dark ? '#71717a' : '#9ca3af',
      shadow:    dark ? '0 2px 14px rgba(0,0,0,.5)'       : '0 2px 14px rgba(0,0,0,.10)',
      shadowHov: dark ? '0 4px 24px rgba(59,130,246,.4)'  : '0 4px 24px rgba(0,83,226,.18)',
      mainBg:    dark ? '#09090b' : '#f9fafb',
      btnBg:     dark ? '#27272a' : '#ffffff',
      btnBord:   dark ? '#3f3f46' : '#d1d5db',
      btnClr:    dark ? '#f4f4f5' : '#374151',
      emptyClr:  dark ? '#52525b' : '#9ca3af',
      hintClr:   dark ? '#3f3f46' : '#d1d5db',
    };
  }

  // ── Collect notes from DOM data-attrs ────────────────────────
  function _collectNotes() {
    const nl = document.getElementById('note-list');
    if (!nl) return [];
    const out = [];
    nl.querySelectorAll('article[data-note-id]').forEach(el => {
      const id      = el.getAttribute('data-note-id');
      const title   = el.getAttribute('data-title')        || 'Untitled';
      const icon    = el.getAttribute('data-icon')         || '';
      const dateStr = el.getAttribute('data-meeting-date') ||
                      el.getAttribute('data-created-at')   || '';
      const date    = _parseDate(dateStr);
      if (!id || !date) return;
      out.push({ id, title, icon, dateStr, date });
    });
    return out.sort((a, b) => a.date - b.date);
  }

  // ── Tick marks (NO spine – spine lives on outer) ──────────────
  // Adaptive: month/year always; week marks at ≥4 px/day;
  // day marks at ≥14 px/day; day-number labels at ≥20 px/day.
  function _buildTicks(rail, earliest, span, t) {
    // ── Month / year marks (always shown) ────────────────────────
    let cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    const stopMs = earliest.getTime() + (span + 62) * 86_400_000;
    while (cur.getTime() < stopMs) {
      const x     = PAD_ENDS + _daysBetween(earliest, cur) * _pxPerDay;
      const isJan = cur.getMonth() === 0;
      const th    = isJan ? 28 : 16;
      const tick  = document.createElement('div');
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

    // ── Week / day minor ticks (zoom-adaptive) ───────────────────
    if (_pxPerDay < 4) return;
    const showDays  = _pxPerDay >= 14; // day-level ticks vs week-level
    const labelDays = _pxPerDay >= 20; // also draw day-number labels
    const step      = showDays ? 1 : 7;
    const totalDays = span + (showDays ? 14 : 28);

    for (let d = 0; d <= totalDays; d += step) {
      const dayDate = new Date(earliest.getTime() + d * 86_400_000);
      if (dayDate.getDate() === 1) continue; // month boundary already drawn
      const x  = PAD_ENDS + d * _pxPerDay;
      const th = showDays ? 8 : 10;
      const minorTick = document.createElement('div');
      Object.assign(minorTick.style, {
        position: 'absolute', left: x + 'px',
        top: `calc(${SPINE_Y * 100}% - ${th / 2}px)`,
        width: '1px', height: th + 'px',
        background: t.tick, opacity: '0.55',
        transform: 'translateX(-50%)', pointerEvents: 'none',
      });
      rail.appendChild(minorTick);
      if (labelDays) {
        const dlbl = document.createElement('span');
        dlbl.textContent = String(dayDate.getDate());
        Object.assign(dlbl.style, {
          position: 'absolute', left: x + 'px',
          top: `calc(${SPINE_Y * 100}% + 18px)`,
          transform: 'translateX(-50%)',
          fontSize: '8px', color: t.label,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        rail.appendChild(dlbl);
      }
    }
  }

  // ── One note pin: dot + stem + card ──────────────────────────
  // laneIdx=0 → first lane (closest to spine), 1 → second lane, etc.
  // Lanes stack vertically so cards on the same side never overlap.
  function _buildPin(rail, note, x, above, laneIdx, t) {
    const DOT = 10, GAP = 8;
    // Each extra lane adds exactly one card-height + gap of stem,
    // pushing cards further from the spine without overlapping.
    const stemH = STEM_H + laneIdx * (CARD_H + GAP);

    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute', left: x + 'px', top: `${SPINE_Y * 100}%`,
      width: DOT + 'px', height: DOT + 'px', borderRadius: '50%',
      background: t.spine, transform: 'translate(-50%,-50%)',
      zIndex: '3', pointerEvents: 'none',
    });
    rail.appendChild(dot);

    const stem = document.createElement('div');
    Object.assign(stem.style, {
      position: 'absolute', left: x + 'px',
      top: above ? `calc(${SPINE_Y * 100}% - ${stemH}px)` : `${SPINE_Y * 100}%`,
      width: '2px', height: stemH + 'px',
      background: t.spineFade, transform: 'translateX(-50%)',
      zIndex: '2', pointerEvents: 'none',
    });
    rail.appendChild(stem);

    const card = document.createElement('article');
    card.setAttribute('role',       'button');
    card.setAttribute('tabindex',   '0');
    card.setAttribute('aria-label', `Open note: ${note.title}`);
    card.setAttribute('hx-get',    `/notes/${note.id}`);
    card.setAttribute('hx-target', '#detail-panel');
    card.setAttribute('hx-swap',   'innerHTML');
    card.setAttribute('onkeydown', "if(event.key==='Enter'||event.key===' '){this.click()}");

    const vert = above
      ? { bottom: `calc(${(1 - SPINE_Y) * 100}% + ${stemH + GAP}px)` }
      : { top:    `calc(${SPINE_Y * 100}%        + ${stemH + GAP}px)` };

    Object.assign(card.style, {
      position: 'absolute', left: (x - CARD_W / 2) + 'px', width: CARD_W + 'px',
      background: t.cardBg, border: `1px solid ${t.cardBord}`,
      borderRadius: '10px', padding: '10px 12px', boxShadow: t.shadow,
      cursor: 'pointer', pointerEvents: 'all', zIndex: '4',
      transition: 'box-shadow .15s, border-color .15s', ...vert,
    });
    card.innerHTML =
      `<h3 style="font-size:.8rem;font-weight:700;color:${t.titleClr};
                  margin:0 0 4px;line-height:1.35;
                  display:-webkit-box;-webkit-line-clamp:2;
                  -webkit-box-orient:vertical;overflow:hidden;">
        ${note.icon ? `<span aria-hidden="true">${_esc(note.icon)} </span>` : ''}${_esc(note.title)}
      </h3>
      <time style="font-size:.7rem;color:${t.subClr};display:block;">📅 ${_fmtDate(note.dateStr)}</time>`;

    card.addEventListener('mouseenter', () => {
      card.style.boxShadow = t.shadowHov; card.style.borderColor = t.cardHov;
    });
    card.addEventListener('mouseleave', () => {
      card.style.boxShadow = t.shadow;    card.style.borderColor = t.cardBord;
    });
    rail.appendChild(card);
    if (window.htmx) htmx.process(card);
  }

  // ── Rail (ticks + pins only, NO spine) ────────────────────────
  function _buildRail(notes, t) {
    const earliest = notes[0].date;
    const latest   = notes[notes.length - 1].date;
    const span     = notes.length > 1 ? Math.max(1, _daysBetween(earliest, latest)) : 30;
    const railW    = Math.max(span * _pxPerDay + PAD_ENDS * 2, 400);

    const rail = document.createElement('div');
    Object.assign(rail.style, {
      position: 'absolute', top: '0', bottom: '0',
      left: '0px', width: railW + 'px', pointerEvents: 'none',
    });

    _buildTicks(rail, earliest, span, t);

    // ── Group notes into columns so no two cards on the same side overlap.
    // Notes within CARD_W+10 px of each other share a column (same x position,
    // stacked vertically using increasing lane indices).
    const columns = [];
    notes.forEach(n => {
      const x = PAD_ENDS + _daysBetween(earliest, n.date) * _pxPerDay;
      const last = columns[columns.length - 1];
      if (last && (x - last.x) < CARD_W + 10) {
        last.notes.push(n);
      } else {
        columns.push({ x, notes: [n] });
      }
    });
    // Alternate every note globally above/below the spine so the timeline
    // fills both halves naturally regardless of how notes cluster.
    // Within a column (notes too close to spread horizontally) each side
    // stacks independently via its own laneIdx counter.
    let globalIdx = 0;
    columns.forEach(col => {
      let aboveCount = 0, belowCount = 0;
      col.notes.forEach(n => {
        const above   = globalIdx % 2 === 0;
        const laneIdx = above ? aboveCount++ : belowCount++;
        _buildPin(rail, n, col.x, above, laneIdx, t);
        globalIdx++;
      });
    });

    // _notesCenter: midpoint of the ACTUAL note x-positions (rail coords).
    // For a single note this equals PAD_ENDS (not span-midpoint);
    // for many notes it's the pixel midpoint of earliest→latest.
    // Used by clamp() and _doAutofit() for true content centering.
    const noteXMax = notes.length > 1
      ? PAD_ENDS + _daysBetween(earliest, notes[notes.length - 1].date) * _pxPerDay
      : PAD_ENDS;
    rail._earliest    = earliest;
    rail._span        = span;
    rail._railW       = railW;
    rail._notesCenter = (PAD_ENDS + noteXMax) / 2;
    return rail;
  }

  // ── Shared clamp used by both drag and zoom ──────────────────────
  // Derives bounds from the rail's actual note midpoint so single-note
  // views (centeredL ≈ +480) are treated identically to dense views.
  // getRail must return the rail that will be visible after this call
  // (pass () => newRail in _doZoom so _notesCenter is from the new rail).
  function _clamp(outer, getRail, v) {
    const ow        = outer.offsetWidth || 1;
    const centeredL = ow / 2 - (getRail()._notesCenter || PAD_ENDS);
    const margin    = Math.round(ow * 0.45); // ±45 % of viewport from center
    return Math.max(centeredL - margin, Math.min(centeredL + margin, v));
  }

  // ── Auto-fit: scale so all notes fill the visible width ─────────
  function _doAutofit(outer, notes, t, getRail, setRail) {
    const cw  = outer.offsetWidth;
    if (!cw) return; // layout not ready yet; double-rAF should prevent this
    const span = getRail()._span  || 30;
    // pxPerDay that makes content exactly fill the inner width
    _pxPerDay  = Math.max(PX_MIN, Math.min(PX_MAX, (cw - PAD_ENDS * 2) / span));
    const newRail = _buildRail(notes, t);
    // Center the ACTUAL notes (not the synthetic span) in the viewport.
    // For a single note this means it appears at 50% width, not 10% from left.
    const centeredL = Math.round(cw / 2 - (newRail._notesCenter || PAD_ENDS));
    newRail.style.left = centeredL + 'px';
    getRail().replaceWith(newRail);
    setRail(newRail);
    // Reveal the timeline now that layout is correct
    outer.style.opacity = '1';
  }

  // ── Drag + momentum (Pointer Events API + setPointerCapture) ─────
  //
  // Why not window mousemove/mouseup?
  //   • preventDefault() on mousedown blocks mousemove in Chrome/Edge.
  //   • Events are lost when mouse briefly leaves the window.
  //   • Listeners accumulate on window across remounts.
  // setPointerCapture pins all pointer events to `outer` for the
  // entire drag, handling mouse + touch + stylus in one API.
  function _attachDrag(outer, getRail) {
    let dragging = false, didDrag = false;
    let startX = 0, startLeft = 0, lastX = 0, lastTime = 0, velX = 0;

    // Delegate to the module-level _clamp so drag and zoom share identical bounds.
    function clamp(v) { return _clamp(outer, getRail, v); }

    outer.addEventListener('pointerdown', e => {
      // Only respond to primary button (left mouse, first touch/pen)
      if (!e.isPrimary) return;
      // Ignore right-click
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      dragging  = true; didDrag = false;
      startX    = e.clientX;
      startLeft = parseFloat(getRail().style.left) || 0;
      lastX     = startX; lastTime = Date.now(); velX = 0;
      outer.style.cursor = 'grabbing';
      // Capture keeps pointermove/pointerup on this element even
      // when the pointer moves outside the browser window.
      outer.setPointerCapture(e.pointerId);
    });

    outer.addEventListener('pointermove', e => {
      if (!dragging || !e.isPrimary) return;
      const cx  = e.clientX;
      const now = Date.now(), dt = now - lastTime || 1;
      if (Math.abs(cx - startX) > 3) didDrag = true;
      velX  = (cx - lastX) / dt * 16;
      lastX = cx; lastTime = now;
      getRail().style.left = clamp(startLeft + (cx - startX)) + 'px';
    });

    function endDrag(e) {
      if (!dragging || !e.isPrimary) return;
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
    outer.addEventListener('pointerup',     endDrag);
    outer.addEventListener('pointercancel', e => {
      if (e.isPrimary) { dragging = false; outer.style.cursor = 'grab'; }
    });

    // Swallow click that follows a drag so cards don't open
    outer.addEventListener('click', e => {
      if (didDrag) { e.stopPropagation(); e.preventDefault(); didDrag = false; }
    }, true);

    // No window listeners → cleanup is a no-op
    return () => {};
  }

  // ── Zoom (wheel + buttons) ────────────────────────────────────
  function _doZoom(outer, notes, t, getRail, setRail, factor, focalX) {
    const newPx = Math.max(PX_MIN, Math.min(PX_MAX, _pxPerDay * factor));
    if (Math.abs(newPx - _pxPerDay) < 0.01) return;
    const oldLeft = parseFloat(getRail().style.left) || 0;
    const railX   = -oldLeft + focalX;
    const ratio   = newPx / _pxPerDay;
    _pxPerDay     = newPx;
    const newRail = _buildRail(notes, t);
    // Use the module-level _clamp with the FRESH rail so its _notesCenter
    // (recalculated for the new _pxPerDay) governs the bounds.
    // The old Math.min(0, ...) forced positive left values to 0, which sent
    // a centered single-note flying to the left on every zoom step.
    newRail.style.left = _clamp(outer, () => newRail, focalX - railX * ratio) + 'px';
    getRail().replaceWith(newRail);
    setRail(newRail);
  }

  // ── Main timeline container ───────────────────────────────────
  function _buildTimeline(notes) {
    const t = _theme();

    if (!notes.length) {
      const d = document.createElement('div');
      Object.assign(d.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'absolute', inset: '0', background: t.mainBg,
      });
      d.innerHTML = `<p style="color:${t.emptyClr};font-size:.875rem;">No dated notes to display on the timeline yet.</p>`;
      return d;
    }

    const outer = document.createElement('div');
    Object.assign(outer.style, {
      position: 'absolute', inset: '0', overflow: 'hidden',
      userSelect: 'none', cursor: 'grab', background: t.mainBg,
      touchAction: 'none',   // prevent native scroll from swallowing pointer events
      opacity: '0',          // hidden until autofit paints the correct layout
      transition: 'opacity 0.15s ease',
    });

    // ── Spine on outer — always spans full viewport width ────
    //    (never scrolls with the rail — this is the fix for bug 1)
    const spine = document.createElement('div');
    Object.assign(spine.style, {
      position: 'absolute', top: `${SPINE_Y * 100}%`,
      left: '0', right: '0', height: '3px',
      background: t.spine, borderRadius: '2px',
      transform: 'translateY(-50%)', zIndex: '1', pointerEvents: 'none',
    });
    outer.appendChild(spine);

    // ── Rail (slides; spine-free) ────────────────────────────
    let _rail = _buildRail(notes, t);
    outer.appendChild(_rail);
    const getRail = ()  => _rail;
    const setRail = (r) => { _rail = r; outer.appendChild(r); };

    // ── Drag ────────────────────────────────────────────────
    const cleanupDrag = _attachDrag(outer, getRail);
    outer._cleanup    = cleanupDrag;

    // ── Wheel zoom ──────────────────────────────────────────
    outer.addEventListener('wheel', e => {
      e.preventDefault();
      const focalX = e.clientX - outer.getBoundingClientRect().left;
      _doZoom(outer, notes, t, getRail, setRail, e.deltaY < 0 ? 1.15 : 1 / 1.15, focalX);
    }, { passive: false });

    // ── Control buttons (−  +  ↔) ───────────────────────────
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute', top: '12px', right: '12px',
      display: 'flex', gap: '6px', zIndex: '10', pointerEvents: 'all',
    });

    function makeBtn(html, title, onClick) {
      const btn = document.createElement('button');
      btn.innerHTML = html;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      Object.assign(btn.style, {
        width: '32px', height: '32px', borderRadius: '8px',
        background: t.btnBg, border: `1px solid ${t.btnBord}`,
        color: t.btnClr, fontSize: '15px', lineHeight: '1',
        cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,.12)', flexShrink: '0',
      });
      btn.addEventListener('pointerdown', e => e.stopPropagation()); // must not reach outer
      btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return btn;
    }

    bar.appendChild(makeBtn('&#8722;', 'Zoom out (scroll down)', () =>
      _doZoom(outer, notes, t, getRail, setRail, 1 / 1.3, outer.offsetWidth / 2)));
    bar.appendChild(makeBtn('+', 'Zoom in (scroll up)', () =>
      _doZoom(outer, notes, t, getRail, setRail, 1.3, outer.offsetWidth / 2)));
    bar.appendChild(makeBtn('&#8596;', 'Fit all notes in view', () =>
      _doAutofit(outer, notes, t, getRail, setRail)));
    outer.appendChild(bar);

    // ── Hint ────────────────────────────────────────────────
    const hint = document.createElement('div');
    hint.setAttribute('aria-hidden', 'true');
    Object.assign(hint.style, {
      position: 'absolute', bottom: '14px', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '10px', color: t.hintClr,
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
    });
    hint.textContent = '\u2190 drag to navigate \u2192  \u00b7  scroll wheel to zoom  \u00b7  \u2194 to fit all';
    outer.appendChild(hint);

    // ── Auto-fit on first render (after layout is available) ─
    outer._onMount = () => _doAutofit(outer, notes, t, getRail, setRail);

    return outer;
  }

  // ── Public: mount ─────────────────────────────────────────────
  function mount() {
    if (_mounted) return;
    const main = document.getElementById('main-content');
    if (!main) return;

    _savedMainStyles = {
      position: main.style.position,
      overflow: main.style.overflow,
      padding:  main.style.padding,
    };
    main.style.position = 'relative';
    main.style.overflow = 'hidden';
    main.style.padding  = '0';

    _overlay = document.createElement('div');
    _overlay.id = '_bw-tl-overlay';
    Object.assign(_overlay.style, { position: 'absolute', inset: '0', zIndex: '10' });

    const notes = _collectNotes();
    const tl    = _buildTimeline(notes);
    if (tl._cleanup)  _dragCleanup = tl._cleanup;
    _overlay.appendChild(tl);
    main.appendChild(_overlay);

    // Double-rAF: first frame appends overlay to DOM, second frame reads
    // offsetWidth after the browser has run layout on the new subtree.
    if (tl._onMount) requestAnimationFrame(() => requestAnimationFrame(tl._onMount));
    _mounted = true;
  }

  // ── Public: unmount ───────────────────────────────────────────
  function unmount() {
    if (_rafId)       { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }

    const main = document.getElementById('main-content');
    if (main) {
      main.style.position = _savedMainStyles.position ?? '';
      main.style.overflow = _savedMainStyles.overflow ?? '';
      main.style.padding  = _savedMainStyles.padding  ?? '';
    }
    _savedMainStyles = {};
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _pxPerDay = 5;
    _mounted  = false;
  }

  // ── Public: remount (after HTMX swaps #note-list) ─────────────
  function remount() {
    if (_rafId)       { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }
    if (!_overlay)    { mount(); return; }

    _pxPerDay = 5;  // reset scale for the new workspace
    // Paint the overlay with a solid background BEFORE clearing innerHTML.
    // The new outer element starts at opacity:0 (revealed after autofit),
    // so without this the grid HTML underneath would show through for 2 frames.
    _overlay.style.background = _theme().mainBg;
    _overlay.innerHTML = '';
    const notes = _collectNotes();
    const tl    = _buildTimeline(notes);
    if (tl._cleanup)  _dragCleanup = tl._cleanup;
    _overlay.appendChild(tl);
    // Double-rAF for the same reason as mount()
    if (tl._onMount) requestAnimationFrame(() => requestAnimationFrame(tl._onMount));
  }

  function isMounted() { return _mounted; }

  return { mount, unmount, remount, isMounted };

})();