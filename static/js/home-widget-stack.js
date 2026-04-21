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

// ── Internal helpers ────────────────────────────────────────────────────────

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

  // Update "N/total" counter
  var counter = document.querySelector('.stack-counter[data-stack-id="' + stackId + '"]');
  if (counter) counter.textContent = (index + 1) + '/' + count;

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

function _stackInitTouchSwipe(viewportEl, stackId) {
  var _touchX = 0;
  viewportEl.addEventListener('touchstart', function(e) {
    _touchX = e.touches[0].clientX;
  }, { passive: true });
  viewportEl.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - _touchX;
    if (dx < -40) stackNext(stackId);
    if (dx >  40) stackPrev(stackId);
  }, { passive: true });
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
      _stackInitTouchSwipe(viewport, stackId);
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

  // ── Restore stack mode from localStorage ──
  // Runs after every re-render (unstack, stack creation, F5 refresh).
  // _applyStackModeState is defined in home-widgets.js and is always
  // loaded before home-widget-stack.js.
  var grid = document.querySelector('[id^="widget-grid-"]');
  if (grid && typeof _applyStackModeState === 'function') {
    var pageId = (grid.id || '').replace('widget-grid-', '');
    var saved  = pageId ? localStorage.getItem('bw_stack_' + pageId) : null;
    if (saved === '1') _applyStackModeState(grid, true);
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
