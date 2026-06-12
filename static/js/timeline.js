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
  // Use the smaller dimension so landscape phones still get mobile sizing.
  // Touch capability is the reliable mobile signal.
  // innerWidth-based checks break on Safari 'Request Desktop Site'.
  const _isMob    = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const CARD_W    = _isMob ? 130 : 272;
  const CARD_H    = _isMob ? 52  : 118;  // approx. card height for vertical lane stacking
  const STEM_H    = _isMob ? 30  : 80;
  const PAD_ENDS  = _isMob ? 50  : 120;  // left & right padding inside the rail
  // Scroll headroom added above/below the viewport on mobile.
  // vScroll.scrollTop is initialised to MOB_VPAD so the spine sits centred.
  const MOB_VPAD  = 400;

  // ── Module state ──────────────────────────────────────────────────
  let _mounted         = false;
  let _savedMainStyles = {};
  let _rafId           = null;
  let _overlay         = null;
  let _dragCleanup     = null;
  let _keyCleanup      = null;   // keyboard shortcut teardown
  let _pinching        = false;  // true while two-finger pinch-zoom is active
  let _wormCleanup     = null;   // bookworm RAF loop teardown
  let _bgCleanup       = null;   // aurora WebGL background teardown
  let _tlDateMode      = 'created'; // 'created' | 'updated'

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

  // ── Collect workspace notes from DOM data-attrs ─────────────
  function _collectNotes() {
    const nl  = document.getElementById('note-list');
    const out = [];
    if (nl) {
      nl.querySelectorAll('article[data-note-id]').forEach(el => {
        const id       = el.getAttribute('data-note-id');
        const title    = el.getAttribute('data-title')        || 'Untitled';
        const icon     = el.getAttribute('data-icon')         || '';
        const catColor = el.getAttribute('data-cat-color')    || '';
        // 'created' mode: meeting_date → created_at (event date wins when set)
        // 'updated' mode: updated_at only
        const dateStr  = _tlDateMode === 'updated'
          ? (el.getAttribute('data-updated-at') || el.getAttribute('data-created-at') || '')
          : (el.getAttribute('data-meeting-date') || el.getAttribute('data-created-at') || '');
        const date     = _parseDate(dateStr);
        if (!id || !date) return;
        out.push({ id, title, icon, dateStr, date, catColor });
      });
    }
    // Merge database cards when a DB workspace is active.
    // _dbCards lives in workspace-database.js; use updated_at → created_at for date.
    return out.concat(_collectDbCards()).sort((a, b) => a.date - b.date);
  }

  // ── Collect DB workspace cards (window._dbCards, if present) ──
  function _collectDbCards() {
    if (!window._dbCards || !window._dbCards.length) return [];
    const out = [];
    window._dbCards.forEach(c => {
      const dateStr = _tlDateMode === 'updated'
        ? (c.updated_at || c.created_at || '')
        : (c.created_at || c.updated_at || '');
      const date    = _parseDate(dateStr);
      if (!date) return;
      out.push({
        id:       c.id,
        title:    c.title || 'Untitled',
        icon:     '',                  // no note icon — badge shown in card instead
        dateStr,
        date,
        catColor: '#7c3aed',          // purple — visually distinct from note pins
        onClick:  '_dbOpenDetail(' + c.id + ')',
        isDb:     true,
      });
    });
    return out;
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
      daysBetween: _daysBetween, esc: _esc, fmtDate: _fmtDate, isMobile: _isMob,
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

  // ── Center on Today: keeps current zoom, puts Today at 50% width ──
  // Called on first mount so the user always opens with Today visible
  // and centred.  _doAutofit (the ↔ button) is a separate action.
  function _centerToday(outer, notes, t, getRail, setRail) {
    const cw = outer.offsetWidth;
    if (!cw) return;
    const rail      = _buildRail(notes, t);
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const d         = Math.max(0, Math.round((today - rail._earliest) / 86_400_000));
    const todayAbsX = PAD_ENDS + d * _pxPerDay;
    rail.style.left = Math.round(cw / 2 - todayAbsX) + 'px';
    getRail().replaceWith(rail);
    setRail(rail);
    outer.style.opacity = '1';
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

  // ── Drag + momentum (Pointer Events API, lazy capture, axis-locked) ─────
  // Lazy capture: setPointerCapture is deferred until the drag threshold is
  // exceeded in pointermove. This allows pointerdown on card elements (which
  // stop propagation) to still be captured during a genuine swipe gesture,
  // because the card's *pointermove* events bubble up to outer normally.
  //
  // Axis-lock: after 8 px of movement the dominant axis is locked for the
  // rest of the gesture so vertical and horizontal swipes never fight each
  // other. Axis resets on every pointerdown.
  //
  // maxScrollY : max scrollTop in px (0 on desktop = no vertical pan)
  function _attachDrag(outer, getVScroll, getRail, onMove, maxScrollY) {
    let dragging = false, captured = false, didDrag = false;
    let axis = null;  // null | 'h' | 'v'
    let startX = 0, startLeft = 0, lastX = 0, velX = 0;
    let startY = 0, startST = 0,    lastY = 0, velY = 0;  // startST = scrollTop at drag start
    let activeId = null, lastTime = 0;

    function clampH(v)  { return _clamp(outer, getRail, v); }
    // clampST: keep scrollTop between 0 and maxScrollY (= MOB_VPAD*2 on mobile, 0 desktop)
    function clampST(v) { return Math.max(0, Math.min(maxScrollY, v)); }

    // pointerdown on outer (direct hits on empty rail areas)
    outer.addEventListener('pointerdown', e => {
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      dragging = true; captured = false; didDrag = false; axis = null;
      activeId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startLeft = parseFloat(getRail().style.left) || 0;
      const _vs0 = getVScroll();
      startST   = _vs0 ? _vs0.scrollTop : 0;
      lastX = startX; lastY = startY; lastTime = Date.now();
      velX = 0; velY = 0;
      outer.style.cursor = 'grabbing';
      outer.setPointerCapture(e.pointerId);
      captured = true;
    });

    // pointermove on outer — also fires for bubbled moves from card children
    outer.addEventListener('pointermove', e => {
      if (!e.isPrimary) return;
      // Yield to two-finger pinch: reset drag state so the next single-finger
      // move after pinch-end restarts from the current position (no jump).
      if (_pinching) {
        dragging = false; axis = null;
        startX = e.clientX; startY = e.clientY;
        startLeft = parseFloat(getRail().style.left) || 0;
        const _vsP = getVScroll();
        startST = _vsP ? _vsP.scrollTop : 0;
        return;
      }
      // Short-circuit if no button is physically held — prevents lazy-capture
      // from re-activating the drag after pointerup (stale startX/Y issue).
      if (!dragging && e.buttons === 0) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);

      // Lazy capture: card ate the pointerdown — grab on first move while pressed
      if (!dragging && e.buttons > 0 && (adx > 3 || ady > 3)) {
        dragging = true; didDrag = false; axis = null;
        activeId = e.pointerId;
        startX = e.clientX - dx; startY = e.clientY - dy; // back-calc start
        startLeft = parseFloat(getRail().style.left) || 0;
        const _vs1 = getVScroll();
        startST   = _vs1 ? _vs1.scrollTop : 0;
        lastX = e.clientX; lastY = e.clientY; lastTime = Date.now();
        velX = 0; velY = 0;
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        try { outer.setPointerCapture(e.pointerId); captured = true; } catch(_) {}
        outer.style.cursor = 'grabbing';
      }
      if (!dragging) return;

      const cx = e.clientX, cy = e.clientY;
      const now = Date.now(), dt = now - lastTime || 1;

      // Lock axis — bias toward vertical so upward swipes aren't eaten by h
      if (!axis && (adx > 8 || ady > 8)) {
        axis = adx > ady ? 'h' : 'v';
      }
      if (adx > 3 || ady > 3) didDrag = true;

      velX = (cx - lastX) / dt * 16;
      velY = (cy - lastY) / dt * 16;
      lastX = cx; lastY = cy; lastTime = now;

      if (axis !== 'v') {  // horizontal (or not yet locked)
        getRail().style.left = clampH(startLeft + (cx - startX)) + 'px';
      }
      if (axis !== 'h' && maxScrollY > 0) {  // vertical (or not yet locked)
        // Drag finger DOWN → content follows → scrollTop DECREASES
        const _vs2 = getVScroll();
        if (_vs2) _vs2.scrollTop = clampST(startST - (cy - startY));
      }
      if (onMove) onMove();
    });

    function endDrag(e) {
      if (!dragging || !e.isPrimary) return;
      dragging = false; outer.style.cursor = 'grab';
      let posX = parseFloat(getRail().style.left) || 0;
      const _vs3 = getVScroll();
      let posY = _vs3 ? _vs3.scrollTop : 0;
      const lockedAxis = axis;
      function decay() {
        velX *= 0.93; velY *= 0.93;
        const moveH = lockedAxis !== 'v' && Math.abs(velX) >= 0.4;
        const moveV = lockedAxis !== 'h' && maxScrollY > 0 && Math.abs(velY) >= 0.4 && _vs3;
        if (!moveH && !moveV) return;
        if (moveH) { posX = clampH(posX + velX); getRail().style.left = posX + 'px'; }
        if (moveV) {
          // velY > 0 = was dragging down → keep scrolling content down (scrollTop decreases)
          posY = clampST(posY - velY);
          _vs3.scrollTop = posY;
        }
        if (onMove) onMove();
        _rafId = requestAnimationFrame(decay);
      }
      _rafId = requestAnimationFrame(decay);
    }
    outer.addEventListener('pointerup',     endDrag);
    outer.addEventListener('pointercancel', e => {
      if (e.isPrimary) {
        dragging = false; axis = null; outer.style.cursor = 'grab';
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      }
    });

    // Swallow click after a real drag so card HTMX links don’t fire
    outer.addEventListener('click', e => {
      if (didDrag) { e.stopPropagation(); e.preventDefault(); didDrag = false; }
    }, true);

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

    // ── Aurora WebGL background (sits behind everything; subtle + perf-guarded) ──
    if (_bgCleanup) { _bgCleanup(); _bgCleanup = null; }
    if (window.bwTimelineBg) {
      try { _bgCleanup = window.bwTimelineBg(outer, _isDark()); } catch (_) { _bgCleanup = null; }
    }

    // ── contentWrap: holds spine + rail + year labels + worm ─────────────
    // On mobile contentWrap lives inside vScroll and is taller than the viewport;
    // scrollTop panning reveals cards above/below. outer keeps overflow:hidden.
    // Mobile: vScroll is a native-scrollable shell that gives the contentWrap
    // real height to scroll through. touchAction:'none' lets our pointer handler
    // own scrollTop; the hidden scrollbar keeps it invisible to the user.
    // Spine lives at 50% of contentWrap. With scrollTop = MOB_VPAD the spine
    // appears at exactly 50% of vScroll's client height. ✓
    let vScroll = null;
    if (_isMob) {
      if (!document.getElementById('_bwVsStyle')) {
        const _s = document.createElement('style');
        _s.id = '_bwVsStyle';
        _s.textContent = '._bwVs::-webkit-scrollbar{display:none}';
        document.head.appendChild(_s);
      }
      vScroll = document.createElement('div');
      Object.assign(vScroll.style, {
        position: 'absolute', inset: '0',
        overflowY: 'scroll', overflowX: 'hidden',
        touchAction: 'none',   // we drive scrollTop; block native scroll
        scrollbarWidth: 'none',
      });
      vScroll.className = '_bwVs';
      outer.appendChild(vScroll);
    }

    const contentWrap = document.createElement('div');
    Object.assign(contentWrap.style, {
      position: 'absolute', left: '0', right: '0', top: '0',
      // On mobile: taller than vScroll so there's room to scroll vertically.
      // scrollHeight - clientHeight = MOB_VPAD*2. Init scrollTop = MOB_VPAD centres spine.
      height: _isMob ? ('calc(100% + ' + (MOB_VPAD * 2) + 'px)') : '100%',
      pointerEvents: 'none',
    });
    (vScroll || outer).appendChild(contentWrap);

    // ── Spine on contentWrap — spans full width, never scrolls horizontally ──
    const spine = document.createElement('div');
    Object.assign(spine.style, {
      position: 'absolute', top: `${SPINE_Y * 100}%`,
      left: '0', right: '0', height: '3px',
      // soft horizontal fade at the ends + a gentle glow so it reads as a
      // light beam across the aurora rather than a flat bar.
      background: `linear-gradient(90deg, transparent, ${t.spine} 12%, ${t.spine} 88%, transparent)`,
      borderRadius: '2px',
      boxShadow: `0 0 14px ${t.spineFade}, 0 0 4px ${t.spine}`,
      transform: 'translateY(-50%)', zIndex: '1', pointerEvents: 'none',
    });
    contentWrap.appendChild(spine);

    // ── Rail (slides; spine-free) ─────────────────────────────
    let _rail = _buildRail(notes, t);
    contentWrap.appendChild(_rail);
    const getRail = ()  => _rail;
    const setRail = (r) => { _rail = r; contentWrap.appendChild(r); };

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
    contentWrap.appendChild(yearLabelL);
    const yearLabelR = document.createElement('div');
    Object.assign(yearLabelR.style, { ..._ylStyle, right: '12px' });
    contentWrap.appendChild(yearLabelR);

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
    if (worm) { contentWrap.appendChild(worm.el); _wormCleanup = worm.destroy; }

    // ── Unified onMove ─────────────────────────────
    function onAllMove() {
      updateYearLabels();
      minimap.update();
      if (worm) worm.update(
        parseFloat(getRail().style.left) || 0, _pxPerDay, PAD_ENDS);
    }

    // ── Drag ───────────────────────────────────────────
    // On mobile: maxScrollY = MOB_VPAD*2 (= contentWrap overflow).
    // On desktop: 0 (no vertical pan — wheel zoom is enough).
    const cleanupDrag = _attachDrag(
      outer, () => vScroll, getRail, onAllMove, _isMob ? MOB_VPAD * 2 : 0);
    outer._cleanup    = cleanupDrag;

    // ── Pinch-to-zoom (two-finger gesture on touch screens) ─────────────────
    // Uses Pointer Events so it co-exists cleanly with the existing drag system.
    // When a second pointer lands we enter pinch mode (_pinching = true);
    // _attachDrag's pointermove yields and keeps resetting startX/Y so that
    // the first drag after the pinch ends starts from the correct position.
    const _pinchPtrs = new Map(); // pointerId → { x, y }
    let   _lastPinchDist = 0;

    function _pinchDist() {
      const pts = [..._pinchPtrs.values()];
      const dx  = pts[1].x - pts[0].x;
      const dy  = pts[1].y - pts[0].y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function _pinchMidX() {
      const pts = [..._pinchPtrs.values()];
      return ((pts[0].x + pts[1].x) / 2) - outer.getBoundingClientRect().left;
    }

    outer.addEventListener('pointerdown', e => {
      _pinchPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (_pinchPtrs.size === 2) {
        // Cancel any momentum animation so it doesn't fight the pinch
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
        _pinching       = true;
        _lastPinchDist  = _pinchDist();
      }
    });

    outer.addEventListener('pointermove', e => {
      if (!_pinchPtrs.has(e.pointerId)) return;
      _pinchPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!_pinching || _pinchPtrs.size < 2) return;

      const dist = _pinchDist();
      if (_lastPinchDist > 0 && Math.abs(dist - _lastPinchDist) > 0.5) {
        const factor = dist / _lastPinchDist;
        _doZoom(outer, notes, t, getRail, setRail, factor, _pinchMidX());
        onAllMove();
      }
      _lastPinchDist = dist;
    });

    function _pinchEnd(e) {
      _pinchPtrs.delete(e.pointerId);
      if (_pinchPtrs.size < 2) {
        _pinching      = false;
        _lastPinchDist = 0;
      }
    }
    outer.addEventListener('pointerup',     _pinchEnd);
    outer.addEventListener('pointercancel', _pinchEnd);

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
      // Stop ALL pointer events from bubbling to outer so the drag system
      // never sees button taps as drag gestures.
      // pointerdown alone isn’t enough on touch — micro finger-movement during
      // a tap sends pointermove to outer’s lazy-capture, which sets dragging=true;
      // the subsequent pointerup then triggers endDrag + decay(), overriding any
      // scrollTop we set in the click handler (the autofit bug on real devices).
      btn.addEventListener('pointerdown',  e => e.stopPropagation());
      btn.addEventListener('pointermove',  e => e.stopPropagation());
      btn.addEventListener('pointerup',    e => e.stopPropagation());
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
      // Cancel any in-flight momentum animation before repositioning.
      // On mobile, a tap can leave a decay() RAF running that would
      // overwrite the scrollTop we set below (autofit pushed-up bug).
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      _doAutofit(outer, notes, t, getRail, setRail);
      if (vScroll) vScroll.scrollTop = MOB_VPAD;  // reset vertical to spine-centre
      onAllMove();
    }));

    // ── Date mode toggle: Created ↔ Updated ────────────────────
    const dateBtn = document.createElement('button');
    function _syncDateBtn() {
      const isUpdated = _tlDateMode === 'updated';
      dateBtn.textContent = isUpdated ? '\uD83D\uDD04 Updated' : '\uD83D\uDCC5 Created';
      dateBtn.title       = isUpdated ? 'Showing updated date — click for created' : 'Showing created date — click for updated';
      dateBtn.setAttribute('aria-label', dateBtn.title);
      dateBtn.style.background   = isUpdated ? '#7c3aed'  : t.btnBg;
      dateBtn.style.borderColor  = isUpdated ? '#7c3aed'  : t.btnBord;
      dateBtn.style.color        = isUpdated ? '#ffffff'  : t.btnClr;
    }
    Object.assign(dateBtn.style, {
      height: '32px', padding: '0 10px', borderRadius: '8px',
      border: `1px solid ${t.btnBord}`, fontSize: '11px', fontWeight: '600',
      lineHeight: '1', cursor: 'pointer', whiteSpace: 'nowrap',
      boxShadow: '0 1px 4px rgba(0,0,0,.12)', flexShrink: '0',
      transition: 'background .15s, color .15s, border-color .15s',
    });
    _syncDateBtn();
    dateBtn.addEventListener('pointerdown',  e => e.stopPropagation());
    dateBtn.addEventListener('pointermove',   e => e.stopPropagation());
    dateBtn.addEventListener('pointerup',     e => e.stopPropagation());
    dateBtn.addEventListener('click', e => {
      e.stopPropagation();
      _tlDateMode = _tlDateMode === 'created' ? 'updated' : 'created';
      // Soft redraw — preserve zoom (_pxPerDay) and current scroll position.
      // Reassigning `notes` (a parameter = closed-over binding) means the
      // wheel-zoom handler automatically picks up the refreshed dates too.
      notes = _collectNotes();
      const savedLeft = parseFloat(getRail().style.left) || 0;
      const newRail   = _buildRail(notes, t);
      newRail.style.left = _clamp(outer, () => newRail, savedLeft) + 'px';
      getRail().replaceWith(newRail);
      setRail(newRail);
      _syncDateBtn();
      onAllMove();
    });
    bar.appendChild(dateBtn);

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
    hint.textContent = _isMob
      ? '\u2190\u2192 drag to scroll  \u00b7  \u2195 drag up/down  \u00b7  \u2194 fit  \u00b7  T = today'
      : '\u2190 drag  \u00b7  scroll to zoom  \u00b7  \u2194 fit  \u00b7  T = today  \u00b7  \uD83D\uDCC5 / \uD83D\uDD04 = date mode';
    outer.appendChild(hint);

    // ── Center on Today on first render (after layout is available) ──
    outer._onMount = () => {
      _centerToday(outer, notes, t, getRail, setRail);
      // Centre spine vertically — must happen AFTER _centerToday so
      // the rail has its final dimensions before we show the overlay.
      if (vScroll) vScroll.scrollTop = MOB_VPAD;
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
    // Give the overlay an immediate opaque background so the note-list grid
    // never bleeds through while the inner canvas fades in from opacity:0.
    // z-index: 25 — must clear #ws-breadcrumb (sticky z-20) so the control
    // buttons (−  +  ↔  date-mode) are never obscured by the breadcrumb bar.
    // Kept below the fixed site header (z-30) and mobile sidebar (z-22/23).
    Object.assign(_overlay.style, {
      position:   'absolute',
      inset:      '0',
      zIndex:     '25',
      background: _theme().mainBg,
    });

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
    if (_bgCleanup)   { _bgCleanup();   _bgCleanup   = null; }

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