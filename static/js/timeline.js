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
  let _keyCleanup      = null;   // keyboard shortcut teardown
  let _wormCleanup     = null;   // bookworm RAF loop teardown

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
      const id       = el.getAttribute('data-note-id');
      const title    = el.getAttribute('data-title')        || 'Untitled';
      const icon     = el.getAttribute('data-icon')         || '';
      const dateStr  = el.getAttribute('data-meeting-date') ||
                       el.getAttribute('data-created-at')   || '';
      const catColor = el.getAttribute('data-cat-color')    || '';
      const date     = _parseDate(dateStr);
      if (!id || !date) return;
      out.push({ id, title, icon, dateStr, date, catColor });
    });
    return out.sort((a, b) => a.date - b.date);
  }

  // ── Tick marks + note pins → see timeline-render.js (_bwTLRender) ──

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

    // Config bundle passed to stateless render helpers in timeline-render.js.
    const rCfg = {
      pxPerDay: _pxPerDay, PAD_ENDS, SPINE_Y, STEM_H, CARD_H, CARD_W,
      daysBetween: _daysBetween, esc: _esc, fmtDate: _fmtDate,
    };
    _bwTLRender.buildTicks(rail, earliest, span, rCfg, t);

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
        _bwTLRender.buildPin(rail, n, col.x, above, laneIdx, rCfg, t);
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
  // _clamp bounds the rail so every note in the set is reachable.
  // margin = max(45% of viewport, half the rail width) ensures multi-year
  // timelines can be scrolled all the way to their first and last notes.
  function _clamp(outer, getRail, v) {
    const ow        = outer.offsetWidth || 1;
    const rail      = getRail();
    const centeredL = ow / 2 - (rail._notesCenter || PAD_ENDS);
    const margin    = Math.max(Math.round(ow * 0.45), (rail._railW || 400) / 2);
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
  function _attachDrag(outer, getRail, onMove) {
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
      if (onMove) onMove();
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
        if (onMove) onMove();
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

    // ── Year corner labels ─────────────────────────────────────
    // Fixed to the far-left and far-right corners of the viewport.
    // Updates on every drag frame, zoom step, and autofit so the user
    // Fixed to the far-left and far-right corners, vertically just above
    // the spine (bottom edge sits 16px above center = 2px above the tallest
    // year tick mark).  translateY(-100%) makes `top` anchor the BOTTOM edge.
    const _ylStyle = {
      position: 'absolute',
      top: `calc(${SPINE_Y * 100}% - 16px)`,
      transform: 'translateY(-100%)',
      fontSize: '13px', fontWeight: '700', color: t.labelYear,
      pointerEvents: 'none', userSelect: 'none',
      zIndex: '9', letterSpacing: '.03em',
    };
    const yearLabelL = document.createElement('div');
    Object.assign(yearLabelL.style, { ..._ylStyle, left: '12px' });
    outer.appendChild(yearLabelL);
    const yearLabelR = document.createElement('div');
    Object.assign(yearLabelR.style, { ..._ylStyle, right: '12px' });
    outer.appendChild(yearLabelR);

    function updateYearLabels() {
      const rail = getRail();
      if (!rail || !rail._earliest) return;
      const rl    = parseFloat(rail.style.left) || 0;
      const railW = rail._railW || parseFloat(rail.style.width) || 400;
      // -rl is the viewport left edge expressed in rail-x coordinates.
      // Clamp to [PAD_ENDS, railW-PAD_ENDS] — the actual note content zone.
      // Without this, zooming out + dragging puts the left edge in empty
      // void (e.g. 2022) while notes from 2025 appear to float between
      // those wrong year labels.
      const leftRailX = Math.max(PAD_ENDS, Math.min(railW - PAD_ENDS, -rl));
      const days      = (leftRailX - PAD_ENDS) / _pxPerDay;
      const leftYear  = new Date(rail._earliest.getTime() + days * 86_400_000).getFullYear();
      yearLabelL.textContent = String(leftYear);
      yearLabelR.textContent = String(leftYear + 1);
    }

    // ── Minimap + legend ─────────────────────────────────
    const categories = _bwTLUi.collectCategories();
    const minimap    = _bwTLUi.buildMinimap(
      notes, _rail._earliest, _rail._span,
      getRail, () => _pxPerDay, PAD_ENDS, outer, t,
      // jumpCb: centre on the clicked rail-x with smooth animation
      (railX) => {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        const targetL = _clamp(outer, getRail,
          Math.round(outer.offsetWidth / 2 - railX));
        let cur = parseFloat(getRail().style.left) || 0;
        let vel = (targetL - cur) * 0.35;
        function step() {
          const diff = targetL - cur;
          if (Math.abs(diff) < 0.5) { getRail().style.left = targetL + 'px'; onAllMove(); return; }
          vel = diff * 0.22;
          cur += vel;
          getRail().style.left = Math.round(cur) + 'px';
          onAllMove();
          _rafId = requestAnimationFrame(step);
        }
        _rafId = requestAnimationFrame(step);
      },
    );
    const legendEl = _bwTLUi.buildLegend(categories, t);
    if (legendEl) outer.appendChild(legendEl);
    outer.appendChild(minimap.el);

    // ── Bookworm character ─────────────────────────────────────
    // Stop any previous worm's RAF loop before building a fresh one.
    if (_wormCleanup) { _wormCleanup(); _wormCleanup = null; }
    const worm = notes.length
      ? _bwTLUi.buildWorm(_rail._earliest, SPINE_Y, outer)
      : null;
    if (worm) { outer.appendChild(worm.el); _wormCleanup = worm.destroy; }

    // ── Unified onMove ─────────────────────────────
    function onAllMove() {
      updateYearLabels();
      minimap.update();
      if (worm) worm.update(
        parseFloat(getRail().style.left) || 0, _pxPerDay, PAD_ENDS);
    }

    // ── Drag ───────────────────────────────────────────
    const cleanupDrag = _attachDrag(outer, getRail, onAllMove);
    outer._cleanup    = cleanupDrag;

    // ── Wheel zoom ──────────────────────────────────
    outer.addEventListener('wheel', e => {
      e.preventDefault();
      const focalX = e.clientX - outer.getBoundingClientRect().left;
      _doZoom(outer, notes, t, getRail, setRail, e.deltaY < 0 ? 1.15 : 1 / 1.15, focalX);
      onAllMove();
    }, { passive: false });

    // ── Control buttons (−  +  ↔  T) ────────────────────
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
      btn.addEventListener('pointerdown', e => e.stopPropagation());
      btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return btn;
    }

    bar.appendChild(makeBtn('&#8722;', 'Zoom out', () => {
      _doZoom(outer, notes, t, getRail, setRail, 1 / 1.3, outer.offsetWidth / 2);
      onAllMove();
    }));
    bar.appendChild(makeBtn('+', 'Zoom in', () => {
      _doZoom(outer, notes, t, getRail, setRail, 1.3, outer.offsetWidth / 2);
      onAllMove();
    }));
    bar.appendChild(makeBtn('&#8596;', 'Fit all notes in view', () => {
      _doAutofit(outer, notes, t, getRail, setRail);
      onAllMove();
    }));
    outer.appendChild(bar);

    // ── T key → jump to today ───────────────────────────
    const keyHandler = (e) => {
      // Skip when user is typing in an input / textarea / contenteditable
      if (e.target && (e.target.closest('input,textarea,[contenteditable]'))) return;
      if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey) {
        const rail   = getRail();
        if (!rail || !rail._earliest) return;
        const today  = new Date(); today.setHours(0, 0, 0, 0);
        const days   = _daysBetween(rail._earliest, today);
        const todayX = PAD_ENDS + days * _pxPerDay;
        // Animate to centre today in the viewport
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        const targetL = _clamp(outer, getRail,
          Math.round(outer.offsetWidth / 2 - todayX));
        let cur = parseFloat(rail.style.left) || 0;
        function step() {
          const diff = targetL - cur;
          if (Math.abs(diff) < 0.5) { getRail().style.left = targetL + 'px'; onAllMove(); return; }
          cur += diff * 0.22;
          getRail().style.left = Math.round(cur) + 'px';
          onAllMove();
          _rafId = requestAnimationFrame(step);
        }
        _rafId = requestAnimationFrame(step);
        if (worm) worm.burst();   // bookworm gets excited!
      }
    };
    document.addEventListener('keydown', keyHandler);
    if (_keyCleanup) _keyCleanup();   // remove any prior listener on remount
    _keyCleanup = () => document.removeEventListener('keydown', keyHandler);

    // ── Hint ───────────────────────────────────────────
    const hint = document.createElement('div');
    hint.setAttribute('aria-hidden', 'true');
    Object.assign(hint.style, {
      position: 'absolute', bottom: '58px', left: '50%',
      transform: 'translateX(-50%)',
      fontSize: '10px', color: t.hintClr,
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
    });
    hint.textContent = '\u2190 drag  \u00b7  scroll to zoom  \u00b7  \u2194 fit  \u00b7  T = today';
    outer.appendChild(hint);

    // ── Auto-fit on first render (after layout is available) ─
    outer._onMount = () => {
      _doAutofit(outer, notes, t, getRail, setRail);
      onAllMove();
    };

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
    if (_keyCleanup)  { _keyCleanup();  _keyCleanup  = null; }
    if (_wormCleanup) { _wormCleanup(); _wormCleanup = null; }

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