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
      fontSize: '9px', fontWeight: '800', letterSpacing: '.1em',
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
        fontSize: isJan ? '11px' : '9px', fontWeight: isJan ? '700' : '400',
        color: isJan ? t.labelYear : t.label,
        whiteSpace: 'nowrap', pointerEvents: 'none', letterSpacing: '.02em',
      });
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
          fontSize: '8px', color: t.label,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        rail.appendChild(dlbl);
      }
    }
  }

  // ── One note pin: dot + stem + card ─────────────────────────────
  // Dot colour = first category colour (passed on note.catColor) or
  // falls back to the theme's spine colour.  A thin white ring separates
  // the dot from the spine line for a clean "pin" appearance.
  function buildPin(rail, note, x, above, laneIdx, cfg, t) {
    const { SPINE_Y, STEM_H, CARD_H, CARD_W, esc, fmtDate } = cfg;
    const DOT = 10, GAP = 8;
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
      borderRadius: '10px', padding: '10px 12px', boxShadow: t.shadow,
      cursor: 'pointer', pointerEvents: 'all', zIndex: '4',
      transition: 'box-shadow .15s, border-color .15s', ...vert,
    });
    card.innerHTML =
      `<h3 style="font-size:.8rem;font-weight:700;color:${t.titleClr};
                  margin:0 0 4px;line-height:1.35;
                  display:-webkit-box;-webkit-line-clamp:2;
                  -webkit-box-orient:vertical;overflow:hidden;">
        ${note.icon ? `<span aria-hidden="true">${esc(note.icon)} </span>` : ''}${esc(note.title)}
      </h3>
      <time style="font-size:.7rem;color:${t.subClr};display:block;">
        ${note.isDb ? '&#128197; Updated ' : '&#128197; '}${fmtDate(note.dateStr)}
      </time>
      ${note.isDb
        ? `<span style="display:inline-block;margin-top:5px;font-size:.6rem;font-weight:700;
                        letter-spacing:.06em;padding:1px 5px;border-radius:4px;
                        background:#7c3aed18;color:#7c3aed;">&#x1F5C3;&#xFE0F; DB CARD</span>`
        : ''}`;

    // Stop pointerdown bubbling so outer's drag handler never calls
    // setPointerCapture on a card tap — otherwise the browser routes
    // the subsequent click to outer and HTMX never fires.
    card.addEventListener('pointerdown', e => e.stopPropagation());

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