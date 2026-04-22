/* home-widget-stack.js — Widget Stack carousel engine
 *
 * Loaded once as a static file (not HTMX-reinjected), so let/const are fine.
 * var is used for module-state to stay consistent with home-widgets.js style.
 *
 * Public API (called from onclick attributes in home_page.html and from
 * home-widgets.js / home-widgets-settings.js):
 *
 *   initStackCards()                — boot all stack cards in DOM
 *   stackGoTo(stackId, index)       — jump to slide by index
 *   stackPrev(stackId)              — go to previous slide (wraps)
 *   stackNext(stackId)              — go to next slide (wraps)
 *   unstackWidget(stackId, pageId)  — POST /home/widgets/{id}/unstack
 */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────
// Survives HTMX partial re-renders (stack/unstack re-renders the widget grid
// but does NOT reload this script).  toggleStackMode() in home-widgets.js
// writes this; initStackCards() reads it back so edit mode is preserved.
var _hwStackModeOn = false;

// ── Internal helpers ───────────────────────────────────────────────────────

function _stackGetViewport(stackId) {
  return document.querySelector('.stack-viewport[data-stack-id="' + stackId + '"]');
}

function _stackSetActive(stackId, index) {
  var viewport = _stackGetViewport(stackId);
  if (!viewport) return;

  var slides = viewport.querySelectorAll('.stack-slide');
  var count  = slides.length;
  if (count === 0) return;

  // Wrap-safe modulo — handles negative values from stackPrev
  index = ((index % count) + count) % count;

  slides.forEach(function(slide, i) {
    var active = i === index;
    slide.classList.toggle('opacity-100',         active);
    slide.classList.toggle('z-10',                active);
    slide.classList.toggle('opacity-0',           !active);
    slide.classList.toggle('z-0',                 !active);
    slide.classList.toggle('pointer-events-none', !active);
  });
  viewport.dataset.active = index;

  // Update dot fill
  var card = document.getElementById('hw-card-' + stackId);
  if (card) {
    card.querySelectorAll('.stack-dot').forEach(function(dot, i) {
      dot.classList.toggle('bg-wblue',           i === index);
      dot.classList.toggle('bg-gray-300',        i !== index);
      dot.classList.toggle('dark:bg-zinc-600',   i !== index);
      dot.classList.toggle('hover:bg-gray-400',  i !== index);
    });
  }
}

function _stackPersist(stackId, index) {
  var card = document.getElementById('hw-card-' + stackId);
  if (!card) return;
  var cfg = {};
  try { cfg = JSON.parse(card.dataset.widgetConfig || '{}'); } catch(e) {}
  cfg.active_index = index;
  card.dataset.widgetConfig = JSON.stringify(cfg);  // keep DOM in sync
  // Fire-and-forget — losing active_index on network failure is acceptable
  var fd = new FormData();
  fd.append('config_json', JSON.stringify(cfg));
  fetch('/home/widgets/' + stackId + '/update-config', { method: 'POST', body: fd })
    .catch(function() {});  // silence network errors
}

function _stackInitSwipe(viewportEl, stackId) {
  // ── Touch swipe (mobile / touchpad) ───────────────────────────────────
  var _touchX = 0;
  viewportEl.addEventListener('touchstart', function(e) {
    _touchX = e.touches[0].clientX;
  }, { passive: true });
  viewportEl.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - _touchX;
    if (dx < -40) stackNext(stackId);
    if (dx >  40) stackPrev(stackId);
  }, { passive: true });

  // ── Mouse drag-to-swipe ───────────────────────────────────────
  // mousedown fires on the viewport; mouseup is attached to document so the
  // release is caught even when the cursor has moved outside the viewport.
  // A 40 px horizontal threshold separates swipe from a normal click.
  var _mouseX = 0;
  viewportEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;  // left-click only
    _mouseX = e.clientX;
    function onUp(ev) {
      document.removeEventListener('mouseup', onUp);
      var grid = document.querySelector('[id^="widget-grid-"]');
      if (grid && grid.dataset.stackMode === 'true') return;  // edit mode – no swipe
      var dx = ev.clientX - _mouseX;
      if (dx < -40) stackNext(stackId);
      if (dx >  40) stackPrev(stackId);
    }
    document.addEventListener('mouseup', onUp);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

function stackGoTo(stackId, index) {
  _stackSetActive(stackId, index);
  _stackPersist(stackId, index);
}

function stackPrev(stackId) {
  var viewport = _stackGetViewport(stackId);
  var cur = parseInt(viewport ? viewport.dataset.active : '0', 10);
  stackGoTo(stackId, cur - 1);
}

function stackNext(stackId) {
  var viewport = _stackGetViewport(stackId);
  var cur = parseInt(viewport ? viewport.dataset.active : '0', 10);
  stackGoTo(stackId, cur + 1);
}

/**
 * initStackCards — boot every stack card currently in the DOM.
 * Called by initHomeWidgets() in home-widgets.js on every page swap.
 * Idempotent: skips viewports that already have touch swipe bound.
 */
function initStackCards() {
  document.querySelectorAll('.hw-card[data-widget-type="stack"]').forEach(function(card) {
    var stackId  = parseInt(card.dataset.widgetId, 10);
    var viewport = card.querySelector('.stack-viewport');

    if (viewport && !viewport.dataset.swipeInited) {
      _stackInitSwipe(viewport, stackId);
      viewport.dataset.swipeInited = '1';
    }

    // Disable draggable on child cards so they don't interfere with grid drag-drop
    card.querySelectorAll('.stack-child-frame .hw-card').forEach(function(child) {
      child.setAttribute('draggable', 'false');
    });

    // Hide action bars on child cards — they would overlap slide content
    card.querySelectorAll('.stack-slide .hw-actions-bar').forEach(function(bar) {
      bar.style.display = 'none';
    });

    // Hide drag handles on child cards inside the stack
    card.querySelectorAll('.stack-slide .drag-handle').forEach(function(handle) {
      handle.style.display = 'none';
    });
  });

  // ── Restore edit mode state ──
  // _hwStackModeOn survives HTMX swaps (script stays in memory).
  // On fresh page load it is false (module initialises to false above).
  var grid = document.querySelector('[id^="widget-grid-"]');
  if (grid && typeof _applyStackModeState === 'function') {
    _applyStackModeState(grid, _hwStackModeOn);
  }
}

/**
 * unstackWidget — POST to break stack apart; replace canvas with response.
 * The server returns the full re-rendered home_page.html partial.
 */
async function unstackWidget(stackId, pageId) {
  var fd = new FormData();
  fd.append('page_id', pageId);
  try {
    var res = await fetch('/home/widgets/' + stackId + '/unstack',
                         { method: 'POST', body: fd });
    if (!res.ok) {
      if (typeof _bwToast === 'function') _bwToast('Unstack failed', 'error');
      return;
    }
    var html = await res.text();
    var hc   = document.getElementById('home-content');
    if (hc) {
      hc.innerHTML = html;
      if (typeof _initSwappedPage === 'function') {
        try { _initSwappedPage(); } catch(e) {
          console.error('[stack] _initSwappedPage after unstack:', e);
        }
      }
    }
    if (typeof invalidateHomePageCache === 'function') invalidateHomePageCache(pageId);
    if (typeof _bwToast === 'function') _bwToast('Stack removed', 'success');
  } catch(err) {
    console.error('[stack] unstackWidget error:', err);
    if (typeof _bwToast === 'function') _bwToast('Unstack failed', 'error');
  }
}

// ── Widget type label / icon lookup ────────────────────────────────────────
var _STACK_WIDGET_META = {
  clock:          ['Clock',        '🕐'],
  weather:        ['Weather',      '⛅'],
  calendar:       ['Calendar',     '📅'],
  todo:           ['To-Do',        '✅'],
  note_link:      ['Note Link',    '🔗'],
  timer:          ['Timer',        '⏱️'],
  countdown:      ['Countdown',    '⏳'],
  event:          ['Events',       '🗓️'],
  reminder:       ['Reminders',    '🔔'],
  title:          ['Title',        '🔤'],
  banner:         ['Banner',       '🖼️'],
  text:           ['Text',         '📝'],
  sticky:         ['Sticky Note',  '📌'],
  quote:          ['Quote',        '❝'],
  rss_feed:       ['RSS Feed',     '📡'],
  buds:           ['Buds',         '🌱'],
  upload_preview: ['Files',        '📁'],
};

/**
 * openStackChildSettings — gear icon calls this instead of openWidgetSettings().
 * Finds the active slide's child widget, syncs its size attrs from the parent
 * stack card (so the size picker shows stack dimensions, not stale child ones),
 * then delegates to the standard openWidgetSettings() with the child's ID.
 */
function openStackChildSettings(stackId) {
  var stackCard = document.getElementById('hw-card-' + stackId);
  if (!stackCard) return;

  var viewport = stackCard.querySelector('.stack-viewport');
  if (!viewport) return;

  var activeIdx = parseInt(viewport.dataset.active || '0', 10);
  var slides    = viewport.querySelectorAll('.stack-slide');
  var slide     = slides[activeIdx];
  if (!slide) return;

  var frame = slide.querySelector('[data-child-id]');
  if (!frame) return;

  var childId = parseInt(frame.dataset.childId, 10);
  var wtype   = frame.dataset.widgetType || '';

  // Sync stack card's current col/row → child card so the size picker reflects
  // the real stack dimensions, not whatever the child had at creation time.
  var childCard = document.getElementById('hw-card-' + childId);
  if (childCard) {
    var col = stackCard.dataset.colSpan || '1';
    var row = stackCard.dataset.rowSpan || '1';
    childCard.dataset.colSpan = col;
    childCard.dataset.rowSpan = row;
    try {
      var cfg = JSON.parse(childCard.dataset.widgetConfig || '{}');
      cfg.col_span = parseInt(col, 10);
      cfg.row_span = parseInt(row, 10);
      childCard.dataset.widgetConfig = JSON.stringify(cfg);
    } catch (e) {}
  }

  var meta = _STACK_WIDGET_META[wtype] || [wtype || 'Widget', '⚙️'];
  if (typeof openWidgetSettings === 'function') {
    openWidgetSettings(childId, meta[0], meta[1]);
  }

  // Inject slide-nav row at the very top of the settings body so the user
  // can flip between stacked widgets without closing the modal.
  if (slides.length > 1) {
    var body = document.getElementById('ws-settings-body');
    if (body) {
      var nav = document.createElement('div');
      nav.className = 'flex items-center justify-between gap-2 pb-2 mb-1 border-b ' +
                      'border-gray-100 dark:border-zinc-800';
      nav.innerHTML =
        '<button type="button" title="Previous widget" aria-label="Previous widget"' +
        '  onclick="stackPrev(' + stackId + '); openStackChildSettings(' + stackId + ')"' +
        '  class="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500' +
        '         dark:text-zinc-400 hover:text-wblue hover:bg-blue-50' +
        '         dark:hover:bg-wblue/10 transition font-medium">' +
        '  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"' +
        '       stroke-width="2.5" aria-hidden="true">' +
        '    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>' +
        '  </svg>Prev' +
        '</button>' +
        '<span class="text-[10px] tabular-nums text-gray-400 dark:text-zinc-500 select-none">' +
          (activeIdx + 1) + ' of ' + slides.length +
        '</span>' +
        '<button type="button" title="Next widget" aria-label="Next widget"' +
        '  onclick="stackNext(' + stackId + '); openStackChildSettings(' + stackId + ')"' +
        '  class="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500' +
        '         dark:text-zinc-400 hover:text-wblue hover:bg-blue-50' +
        '         dark:hover:bg-wblue/10 transition font-medium">' +
        'Next<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"' +
        '        stroke-width="2.5" aria-hidden="true">' +
        '  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>' +
        '</svg>' +
        '</button>';
      body.prepend(nav);
    }
  }
}

/**
 * _resizeStack — called by _selectSize (home-widgets-settings.js) when the
 * widget being resized lives inside a stack carousel.
 *
 * 1. Updates the outer STACK card's DOM (gridColumn / gridRow).
 * 2. Persists the new size to the stack's own config_json.
 * 3. Persists the new size to every child widget's config_json so that
 *    unstacking later restores the correct dimensions.
 */
async function _resizeStack(stackId, col, row) {
  var stackCard = document.getElementById('hw-card-' + stackId);
  if (!stackCard) return;

  // 1. DOM update on the stack container
  var gridEl  = stackCard.closest('[data-col-count]');
  var maxCols = parseInt(gridEl ? gridEl.dataset.colCount || '3' : '3', 10);
  stackCard.style.gridColumn = (col >= maxCols) ? '1 / -1' : 'span ' + col;
  stackCard.style.gridRow    = 'span ' + row;
  stackCard.dataset.colSpan  = col;
  stackCard.dataset.rowSpan  = row;

  // 2. Update the size picker label (modal is open for a child widget ID)
  var modal      = document.getElementById('ws-settings-modal');
  var childIdStr = modal ? modal.dataset.widgetId : null;
  if (childIdStr) {
    var lbl = document.getElementById('sz-label-' + childIdStr);
    if (lbl) lbl.textContent = col + ' col × ' + row + ' row';
  }

  // 3. Persist stack config
  var stackCfg = {};
  try { stackCfg = JSON.parse(stackCard.dataset.widgetConfig || '{}'); } catch (e) {}
  stackCfg.col_span = col;
  stackCfg.row_span = row;
  stackCard.dataset.widgetConfig = JSON.stringify(stackCfg);
  await _post('/home/widgets/' + stackId + '/update-config',
              { config_json: JSON.stringify(stackCfg) });

  // 4. Persist each child's config so dimensions survive unstacking
  var frames = stackCard.querySelectorAll('[data-child-id]');
  for (var i = 0; i < frames.length; i++) {
    var cid   = parseInt(frames[i].dataset.childId, 10);
    if (!cid) continue;
    var cCard = document.getElementById('hw-card-' + cid);
    var cCfg  = {};
    try { cCfg = JSON.parse((cCard && cCard.dataset.widgetConfig) || '{}'); } catch (e) {}
    cCfg.col_span = col;
    cCfg.row_span = row;
    if (cCard) {
      cCard.dataset.colSpan      = col;
      cCard.dataset.rowSpan      = row;
      cCard.dataset.widgetConfig = JSON.stringify(cCfg);
    }
    await _post('/home/widgets/' + cid + '/update-config',
                { config_json: JSON.stringify(cCfg) });
  }
}
