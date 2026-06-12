/* ================================================================
   BookWorm – Timeline Render Helpers  (loaded before timeline.js)
   Pure DOM-builders: no state, no side-effects.
   Everything dynamic is injected via cfg + t.

   cfg = { pxPerDay, PAD_ENDS, SPINE_Y, STEM_H, CARD_H, CARD_W,
           daysBetween, esc, fmtDate }
   t   = theme colours object (from _theme() in timeline.js)
   ================================================================ */

window._bwTLRender = (function () {
  'use strict';

  // ── Private: today indicator ─────────────────────────────────────
  // Draws a short spark-yellow tick that straddles the spine (not a
  // full-height line) plus a compact 'TODAY' label above the tick.
  // Skipped when today is >6 months outside the note range.
  function _buildTodayLine(rail, earliest, span, cfg, t) {
    const { pxPerDay, PAD_ENDS, SPINE_Y } = cfg;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDays = Math.round((today - earliest) / 86_400_000);
    if (todayDays < -180 || todayDays > span + 180) return;
    const x = PAD_ENDS + todayDays * pxPerDay;

    // Short tick centred on the spine (16px above + 16px below = 32px total)
    const tick = document.createElement('div');
    Object.assign(tick.style, {
      position: 'absolute', left: x + 'px',
      top:  `calc(${SPINE_Y * 100}% - 16px)`,
      width: '2px', height: '32px',
      background: '#ffc220',
      transform: 'translateX(-50%)',
      zIndex: '5', pointerEvents: 'none',
    });
    rail.appendChild(tick);

    // Label sits 4px above the tick top
    const lbl = document.createElement('div');
    lbl.textContent = 'TODAY';
    Object.assign(lbl.style, {
      position: 'absolute', left: x + 'px',
      top:  `calc(${SPINE_Y * 100}% - 20px)`,
      transform: 'translateX(-50%) translateY(-100%)',
      fontSize: '11px', fontWeight: '800', letterSpacing: '.1em',
      color: '#ffc220', whiteSpace: 'nowrap',
      pointerEvents: 'none', zIndex: '6',
      background: t.mainBg, padding: '1px 5px', borderRadius: '3px',
    });
    rail.appendChild(lbl);
  }

  // ── Tick marks ────────────────────────────────────────────────────
  // Month/year marks always. Range: 2 months before earliest note
  // to 6 months after latest. Week marks ≥2 px/day; day ≥8; labels ≥14.
  function buildTicks(rail, earliest, span, cfg, t) {
    const { pxPerDay, PAD_ENDS, SPINE_Y, daysBetween } = cfg;

    // Make a date label tappable → zoom in + centre on that date (feature: snap-zoom).
    // Labels live on the pointer-events:none rail, so we re-enable events per label
    // and stop pointerdown from arming the drag handler.
    function _wireTap(lbl, date) {
      if (!cfg.onDateTap) return;
      lbl.style.pointerEvents = 'all';
      lbl.style.cursor        = 'pointer';
      lbl.title               = 'Zoom to this date';
      lbl.addEventListener('pointerdown', e => e.stopPropagation());
      lbl.addEventListener('click', e => { e.stopPropagation(); cfg.onDateTap(date); });
    }

    // ── Month / year tick marks ───────────────────────────────
    let cur      = new Date(earliest.getFullYear(), earliest.getMonth() - 2, 1);
    const stopMs = earliest.getTime() + (span + 180) * 86_400_000;

    while (cur.getTime() < stopMs) {
      const x     = PAD_ENDS + daysBetween(earliest, cur) * pxPerDay;
      const isJan = cur.getMonth() === 0;

      // Tick mark – taller + bolder for January
      const th   = isJan ? 28 : 16;
      const tick = document.createElement('div');
      Object.assign(tick.style, {
        position: 'absolute', left: x + 'px',
        top: `calc(${SPINE_Y * 100}% - ${th / 2}px)`,
        width: isJan ? '2px' : '1px', height: th + 'px',
        background: isJan ? t.tickYear : t.tick,
        transform: 'translateX(-50%)', pointerEvents: 'none',
      });
      rail.appendChild(tick);

      // Month / year label below the spine
      const lbl = document.createElement('span');
      lbl.textContent = isJan
        ? String(cur.getFullYear())
        : cur.toLocaleString('default', { month: 'short' });
      Object.assign(lbl.style, {
        position: 'absolute', left: x + 'px',
        top: `calc(${SPINE_Y * 100}% + 18px)`,
        transform: 'translateX(-50%)',
        fontSize: isJan ? '13px' : '11px', fontWeight: isJan ? '700' : '400',
        color: isJan ? t.labelYear : t.label,
        whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: '.02em',
      });
      _wireTap(lbl, new Date(cur));
      rail.appendChild(lbl);

      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    // ── Today indicator ──────────────────────────────────────────
    _buildTodayLine(rail, earliest, span, cfg, t);

    // ── Week / day minor ticks ───────────────────────────────────
    // Thresholds (px/day):
    //   ≥2  → week ticks  (every 7 days, no label)
    //   ≥8  → day ticks   (every 1 day,  no label)
    //   ≥14 → day ticks   + day-number labels
    if (pxPerDay < 2) return;
    const showDays  = pxPerDay >= 8;
    const labelDays = pxPerDay >= 14;
    const step      = showDays ? 1 : 7;
    const padDays   = Math.ceil(PAD_ENDS / pxPerDay) + 1;

    for (let d = -padDays; d <= span + padDays; d += step) {
      const dayDate = new Date(earliest.getTime() + d * 86_400_000);
      if (dayDate.getDate() === 1) continue; // month boundaries already drawn
      const x  = PAD_ENDS + d * pxPerDay;
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
          fontSize: '10px', color: t.label,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        _wireTap(dlbl, new Date(dayDate));
        rail.appendChild(dlbl);
      }
    }
  }

  // ── One note pin: dot + stem + card ─────────────────────────────
  // Dot colour = first category colour (passed on note.catColor) or
  // falls back to the theme's spine colour.  A thin white ring separates
  // the dot from the spine line for a clean "pin" appearance.
  function buildPin(rail, note, x, above, laneIdx, cfg, t) {
    const { SPINE_Y, STEM_H, CARD_H, CARD_W, esc, fmtDate, isMobile } = cfg;
    const DOT = isMobile ? 9 : 15, GAP = isMobile ? 6 : 12;
    const stemH   = STEM_H + laneIdx * (CARD_H + GAP);
    const pinClr  = note.catColor || t.spine;
    const stemClr = note.catColor ? (note.catColor + '50') : t.spineFade;

    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute', left: x + 'px', top: `${SPINE_Y * 100}%`,
      width: DOT + 'px', height: DOT + 'px', borderRadius: '50%',
      background: pinClr,
      border: `2px solid ${t.cardBg}`,   // white ring = pin-head look
      boxSizing: 'border-box',
      transform: 'translate(-50%,-50%)',
      zIndex: '3', pointerEvents: 'none',
    });
    rail.appendChild(dot);

    const stem = document.createElement('div');
    Object.assign(stem.style, {
      position: 'absolute', left: x + 'px',
      top: above ? `calc(${SPINE_Y * 100}% - ${stemH}px)` : `${SPINE_Y * 100}%`,
      width: '2px', height: stemH + 'px',
      background: stemClr, transform: 'translateX(-50%)',
      zIndex: '2', pointerEvents: 'none',
    });
    rail.appendChild(stem);

    const card = document.createElement('article');
    card.setAttribute('role',       'button');
    card.setAttribute('tabindex',   '0');
    card.setAttribute('aria-label', `${note.isDb ? 'Open card' : 'Open note'}: ${note.title}`);
    card.setAttribute('onkeydown', "if(event.key==='Enter'||event.key===' '){this.click()}");

    // DB cards: call _dbOpenDetail directly. Notes: HTMX navigation.
    if (note.onClick) {
      card.setAttribute('onclick', note.onClick);
    } else {
      card.setAttribute('hx-get',    `/notes/${note.id}`);
      card.setAttribute('hx-target', '#detail-panel');
      card.setAttribute('hx-swap',   'innerHTML');
    }

    const vert = above
      ? { bottom: `calc(${(1 - SPINE_Y) * 100}% + ${stemH + GAP}px)` }
      : { top:    `calc(${SPINE_Y * 100}%        + ${stemH + GAP}px)` };

    Object.assign(card.style, {
      position: 'absolute', left: (x - CARD_W / 2) + 'px', width: CARD_W + 'px',
      background: t.cardBg, border: `1px solid ${t.cardBord}`,
      borderRadius: isMobile ? '6px' : '10px',
      padding: isMobile ? '6px 8px' : '15px 18px',
      boxShadow: t.shadow,
      cursor: 'pointer', pointerEvents: 'all', zIndex: '4',
      transition: 'box-shadow .15s, border-color .15s', ...vert,
    });
    card.innerHTML =
      `<h3 style="font-size:${isMobile ? '.75rem' : '1.05rem'};font-weight:700;color:${t.titleClr};
                  margin:0 0 ${isMobile ? '2px' : '6px'};line-height:1.25;
                  display:-webkit-box;-webkit-line-clamp:${isMobile ? 1 : 2};
                  -webkit-box-orient:vertical;overflow:hidden;">
        ${note.icon ? `<span aria-hidden="true">${esc(note.icon)} </span>` : ''}${esc(note.title)}
      </h3>
      <time style="font-size:${isMobile ? '.68rem' : '.875rem'};color:${t.subClr};display:block;">
        ${note.isDb ? '&#128197; Updated ' : '&#128197; '}${fmtDate(note.dateStr)}
      </time>
      ${note.isDb
        ? `<span style="display:inline-block;margin-top:${isMobile ? '3px' : '7px'};
                        font-size:${isMobile ? '.62rem' : '.78rem'};font-weight:700;
                        letter-spacing:.06em;padding:2px 4px;border-radius:3px;
                        background:#7c3aed18;color:#7c3aed;">DB</span>`
        : ''}`;

    // Persistent colour accent down the left edge — colour-codes the card by its
    // category (note.catColor) or type (DB cards = purple). Independent of the
    // hover border/shadow so it never disappears (feature: colour-coding).
    const radius = isMobile ? '6px' : '10px';
    const accent = document.createElement('div');
    Object.assign(accent.style, {
      position: 'absolute', left: '0', top: '0', bottom: '0',
      width: isMobile ? '3px' : '4px', background: pinClr,
      borderTopLeftRadius: radius, borderBottomLeftRadius: radius,
      pointerEvents: 'none',
    });
    card.appendChild(accent);
    card._cx = x;   // card centre in rail coords — read by the depth-of-field pass

    // Allow pointerdown to bubble so the outer drag handler can activate
    // even when a touch starts on a card. The outer click-guard suppresses
    // card navigation after a genuine swipe.

    card.addEventListener('mouseenter', () => {
      card.style.boxShadow    = t.shadowHov;
      card.style.borderColor  = pinClr;     // glow in category colour
    });
    card.addEventListener('mouseleave', () => {
      card.style.boxShadow   = t.shadow;
      card.style.borderColor = t.cardBord;
    });
    rail.appendChild(card);
    // Only HTMX-process note cards — DB cards use onclick directly.
    if (!note.isDb && window.htmx) htmx.process(card);
  }

  return { buildTicks, buildPin };
})();