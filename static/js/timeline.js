/* =============================================================
   BookWorm – Timeline View
   Self-contained IIFE module exposed as window.bwTimeline.
   API:
     bwTimeline.mount()   – replace #note-list with timeline
     bwTimeline.unmount() – restore grid (from cache)
     bwTimeline.isMounted()
   ============================================================= */

window.bwTimeline = (function () {
  'use strict';

  // ── Layout constants ─────────────────────────────────────────
  const PX_PER_DAY = 5;        // horizontal scale
  const SPINE_Y    = 0.52;     // spine at 52% of container height
  const CARD_W     = 196;      // card width px
  const STEM_H     = 52;       // stem height px
  const PAD_ENDS   = 140;      // left/right rail padding px

  // ── State ────────────────────────────────────────────────────
  let _mounted   = false;
  let _gridCache = null;   // innerHTML snapshot before mounting
  let _rafId     = null;

  // ── Date helpers ─────────────────────────────────────────────
  function _parseDate(str) {
    if (!str) return null;
    // Normalise "YYYY-MM-DD HH:MM:SS" → ISO
    const s = str.length > 10 ? str.replace(' ', 'T') : str + 'T00:00:00';
    const d = new Date(s);
    return isNaN(d) ? null : d;
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
      dark,
      spine:     dark ? '#3b82f6' : '#0053e2',
      spineFade: dark ? 'rgba(59,130,246,0.4)'  : 'rgba(0,83,226,0.35)',
      tick:      dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.11)',
      tickYear:  dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.28)',
      label:     dark ? '#52525b' : '#9ca3af',
      labelYear: dark ? '#a1a1aa' : '#6b7280',
      cardBg:    dark ? '#18181b' : '#ffffff',
      cardBord:  dark ? '#3f3f46' : '#e5e7eb',
      cardHov:   dark ? '#3b82f6' : '#0053e2',
      titleClr:  dark ? '#f4f4f5' : '#111827',
      subClr:    dark ? '#71717a' : '#9ca3af',
      shadow:    dark ? '0 2px 14px rgba(0,0,0,0.5)' : '0 2px 14px rgba(0,0,0,0.10)',
      shadowHov: dark ? '0 4px 24px rgba(59,130,246,0.4)' : '0 4px 24px rgba(0,83,226,0.18)',
      emptyClr:  dark ? '#52525b' : '#9ca3af',
    };
  }

  // ── Collect note data from article data-attrs ─────────────────
  function _collectNotes(container) {
    const notes = [];
    container.querySelectorAll('article[data-note-id]').forEach(el => {
      const id      = el.getAttribute('data-note-id');
      const title   = el.getAttribute('data-title')   || 'Untitled';
      const icon    = el.getAttribute('data-icon')    || '';
      // Prefer meeting date; fall back to created_at
      const dateStr = el.getAttribute('data-meeting-date') || el.getAttribute('data-created-at') || '';
      const date    = _parseDate(dateStr);
      if (!id || !date) return;
      notes.push({ id, title, icon, dateStr, date });
    });
    notes.sort((a, b) => a.date - b.date);
    return notes;
  }

  // ── Build tick marks ─────────────────────────────────────────
  function _buildTicks(rail, earliest, latest, t) {
    // Step month-by-month from the first day of the earliest month
    let cur = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    const stop = new Date(latest.getFullYear(), latest.getMonth() + 2, 1);

    while (cur < stop) {
      const dayOff = _daysBetween(earliest, cur);
      const x      = PAD_ENDS + dayOff * PX_PER_DAY;
      const isJan  = cur.getMonth() === 0;

      const tick = document.createElement('div');
      const th   = isJan ? 28 : 16;
      Object.assign(tick.style, {
        position:  'absolute',
        left:      x + 'px',
        top:       `calc(${SPINE_Y * 100}% - ${th / 2}px)`,
        width:     isJan ? '2px' : '1px',
        height:    th + 'px',
        background: isJan ? t.tickYear : t.tick,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
      });
      rail.appendChild(tick);

      const lbl = document.createElement('span');
      lbl.textContent = isJan
        ? String(cur.getFullYear())
        : cur.toLocaleString('default', { month: 'short' });
      Object.assign(lbl.style, {
        position:   'absolute',
        left:       x + 'px',
        top:        `calc(${SPINE_Y * 100}% + 18px)`,
        transform:  'translateX(-50%)',
        fontSize:   isJan ? '11px' : '9px',
        fontWeight: isJan ? '700' : '400',
        color:      isJan ? t.labelYear : t.label,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        letterSpacing: '.02em',
      });
      rail.appendChild(lbl);

      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }

  // ── Build one note pin ────────────────────────────────────────
  function _buildPin(rail, note, x, above, t) {
    const DOT = 10;
    const GAP = 8;

    // Dot
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position:  'absolute',
      left:      x + 'px',
      top:       `${SPINE_Y * 100}%`,
      width:     DOT + 'px',
      height:    DOT + 'px',
      borderRadius: '50%',
      background: t.spine,
      transform: 'translate(-50%,-50%)',
      zIndex:    '2',
      pointerEvents: 'none',
    });
    rail.appendChild(dot);

    // Stem
    const stem = document.createElement('div');
    const stemTop = above
      ? `calc(${SPINE_Y * 100}% - ${STEM_H}px)`
      : `${SPINE_Y * 100}%`;
    Object.assign(stem.style, {
      position:  'absolute',
      left:      x + 'px',
      top:       stemTop,
      width:     '2px',
      height:    STEM_H + 'px',
      background: t.spineFade,
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
    });
    rail.appendChild(stem);

    // Card
    const card = document.createElement('article');
    card.setAttribute('role',      'button');
    card.setAttribute('tabindex',  '0');
    card.setAttribute('aria-label', `Open note: ${note.title}`);
    card.setAttribute('hx-get',    `/notes/${note.id}`);
    card.setAttribute('hx-target', '#detail-panel');
    card.setAttribute('hx-swap',   'innerHTML');
    card.setAttribute('onkeydown',
      "if(event.key==='Enter'||event.key===' '){this.click()}");

    const cardBottom = above
      ? `calc(${(1 - SPINE_Y) * 100}% + ${STEM_H + GAP}px)`
      : undefined;
    const cardTop = above
      ? undefined
      : `calc(${SPINE_Y * 100}% + ${STEM_H + GAP}px)`;

    Object.assign(card.style, {
      position:    'absolute',
      left:        (x - CARD_W / 2) + 'px',
      width:       CARD_W + 'px',
      background:  t.cardBg,
      border:      `1px solid ${t.cardBord}`,
      borderRadius: '10px',
      padding:     '10px 12px',
      boxShadow:   t.shadow,
      cursor:      'pointer',
      pointerEvents: 'all',
      zIndex:      '3',
      transition:  'box-shadow .15s, border-color .15s',
      ...(above ? { bottom: cardBottom } : { top: cardTop }),
    });

    card.innerHTML =
      `<h3 style="font-size:.8rem;font-weight:700;color:${t.titleClr};
                  margin:0 0 4px;line-height:1.35;
                  display:-webkit-box;-webkit-line-clamp:2;
                  -webkit-box-orient:vertical;overflow:hidden;">
        ${ note.icon ? `<span aria-hidden="true">${_esc(note.icon)} </span>` : '' }${_esc(note.title)}
      </h3>
      <time style="font-size:.7rem;color:${t.subClr};display:block;">
        📅 ${_fmtDate(note.dateStr)}
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

  // ── Drag + momentum ──────────────────────────────────────────
  function _attachDrag(outer, rail, railW) {
    let dragging = false;
    let didDrag  = false;
    let startX   = 0;
    let startLeft = 0;
    let lastX    = 0;
    let lastTime = 0;
    let velX     = 0;

    function getLeft()  { return parseFloat(rail.style.left) || 0; }
    function clampLeft(v) {
      const minLeft = -(railW - outer.offsetWidth + 80);
      return Math.min(0, Math.max(minLeft, v));
    }

    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging  = true;
      didDrag   = false;
      startX    = e.touches ? e.touches[0].clientX : e.clientX;
      startLeft = getLeft();
      lastX     = startX;
      lastTime  = Date.now();
      velX      = 0;
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      outer.style.cursor = 'grabbing';
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const cx  = e.touches ? e.touches[0].clientX : e.clientX;
      const dx  = cx - startX;
      if (Math.abs(dx) > 3) didDrag = true;
      const now = Date.now();
      const dt  = now - lastTime || 1;
      velX     = (cx - lastX) / dt * 16;  // px/frame at ~60fps
      lastX    = cx;
      lastTime = now;
      rail.style.left = clampLeft(startLeft + dx) + 'px';
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      outer.style.cursor = 'grab';
      let pos = getLeft();
      function decay() {
        velX *= 0.93;
        if (Math.abs(velX) < 0.4) return;
        pos = clampLeft(pos + velX);
        rail.style.left = pos + 'px';
        _rafId = requestAnimationFrame(decay);
      }
      _rafId = requestAnimationFrame(decay);
    }

    // Swallow click if we actually dragged (prevents note open)
    outer.addEventListener('click', e => {
      if (didDrag) { e.stopPropagation(); e.preventDefault(); didDrag = false; }
    }, true);

    outer.addEventListener('mousedown',  onDown);
    outer.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove',  onMove);
    window.addEventListener('touchmove',  onMove, { passive: false });
    window.addEventListener('mouseup',    onUp);
    window.addEventListener('touchend',   onUp);
  }

  // ── Build the full timeline element ──────────────────────────
  function _buildTimeline(notes) {
    const t = _theme();

    if (!notes.length) {
      const d = document.createElement('div');
      d.style.cssText =
        'display:flex;align-items:center;justify-content:center;height:100%;';
      d.innerHTML =
        `<p style="color:${t.emptyClr};font-size:.875rem;"
          >No dated notes to display on the timeline yet.</p>`;
      return d;
    }

    const earliest = notes[0].date;
    const latest   = notes[notes.length - 1].date;
    const span     = _daysBetween(earliest, latest) || 30;
    const railW    = span * PX_PER_DAY + PAD_ENDS * 2;

    // ── outer wrapper (fills allocated height) ────────────────
    const outer = document.createElement('div');
    outer.id = '_bw-tl-outer';
    Object.assign(outer.style, {
      position:   'relative',
      width:      '100%',
      height:     '100%',
      overflow:   'hidden',
      userSelect: 'none',
      cursor:     'grab',
    });

    // ── scrollable rail ───────────────────────────────────────
    const rail = document.createElement('div');
    rail.id = '_bw-tl-rail';
    Object.assign(rail.style, {
      position: 'absolute',
      top: '0', bottom: '0', left: '0',
      width: railW + 'px',
      pointerEvents: 'none',  // cards re-enable per-element
    });

    // Spine line
    const spine = document.createElement('div');
    Object.assign(spine.style, {
      position:  'absolute',
      top:       `${SPINE_Y * 100}%`,
      left:      '0', right: '0',
      height:    '3px',
      background: t.spine,
      borderRadius: '2px',
      transform: 'translateY(-50%)',
    });
    rail.appendChild(spine);

    _buildTicks(rail, earliest, latest, t);

    notes.forEach((note, i) => {
      const dayOff = _daysBetween(earliest, note.date);
      const x      = PAD_ENDS + dayOff * PX_PER_DAY;
      _buildPin(rail, note, x, i % 2 === 0, t);
    });

    outer.appendChild(rail);
    _attachDrag(outer, rail, railW);

    // Scroll so most-recent note is 65% from left on first render
    outer._scrollToRecent = function () {
      const cw      = outer.offsetWidth;
      const lastOff = _daysBetween(earliest, latest);
      const target  = PAD_ENDS + lastOff * PX_PER_DAY - cw * 0.65;
      rail.style.left = Math.min(0, -target) + 'px';
    };

    return outer;
  }

  // ── Saved main-content styles so we can restore exactly ──────
  let _savedMainStyles = {};

  // ── Public API ────────────────────────────────────────────────
  function mount() {
    const noteList = document.getElementById('note-list');
    if (!noteList) return;

    const notes = _collectNotes(noteList);

    // Cache current grid HTML so unmount can restore it instantly
    _gridCache = noteList.innerHTML;

    const main = document.getElementById('main-content');
    if (main) {
      _savedMainStyles = {
        overflowY: main.style.overflowY,
        paddingTop: main.style.paddingTop,
        paddingBottom: main.style.paddingBottom,
        paddingLeft: main.style.paddingLeft,
        paddingRight: main.style.paddingRight,
      };
      main.style.overflowY      = 'hidden';
      main.style.paddingTop     = '0';
      main.style.paddingBottom  = '0';
      main.style.paddingLeft    = '0';
      main.style.paddingRight   = '0';
    }

    noteList.style.height   = '100%';
    noteList.style.overflow = 'hidden';

    const tl = _buildTimeline(notes);
    noteList.innerHTML = '';
    noteList.appendChild(tl);

    if (tl._scrollToRecent) requestAnimationFrame(tl._scrollToRecent);
    _mounted = true;
  }

  function unmount() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    const noteList = document.getElementById('note-list');
    const main     = document.getElementById('main-content');

    if (main) {
      Object.assign(main.style, _savedMainStyles);
      _savedMainStyles = {};
    }
    if (noteList) {
      noteList.style.height   = '';
      noteList.style.overflow = '';
      if (_gridCache !== null) {
        noteList.innerHTML = _gridCache;
        _gridCache = null;
        if (window.htmx) htmx.process(noteList);
      }
    }

    _mounted = false;
  }

  function isMounted() { return _mounted; }

  /* remount() — used after HTMX injects fresh grid HTML into #note-list
     while timeline mode is already active.  We must NOT restore _gridCache
     (it would overwrite the new HTML), so we just discard old state and
     re-mount from whatever is currently in the DOM.                        */
  function remount() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    // Reset internal flags without touching the DOM
    _mounted   = false;
    _gridCache = null;
    mount();
  }

  return { mount, unmount, isMounted, remount };
})();