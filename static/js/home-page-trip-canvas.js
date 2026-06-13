/**
 * home-page-trip-canvas.js — DESKTOP-ONLY "Planning Canvas".
 *
 * Docks a spot palette (all the trip's Research spots) beside the day timeline
 * inside the Plan tab's day-lanes view, so you can drag a spot straight onto a
 * day without tab-bouncing. It's pure composition over existing code:
 *   • palette cards are the existing _tripRenderSpotCard output (already
 *     draggable via tripDragSpotStart → sets 'bw-spot-id'),
 *   • day lanes already accept that drop (tripDragDayDrop → assign endpoint),
 *   • all-trip spots come from GET …/spots?location_id=0.
 *
 * Guarded by window._tripCanvasMode() (desktop, non-touch, ≥768px) so phones —
 * which get the agenda instead — never build or see any of this.
 *
 * Loaded (defer) after home-page-trip-plan.js / -filters.js.
 */

window._tripCanvasMode = function() {
  var touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  return !touch && window.innerWidth >= 768;
};

var _tripPaletteSpots = null;   // null = not yet fetched
var _tripPaletteQuery = '';
var _tripPaletteCollapsed = (function () {
  try { return localStorage.getItem('bw-trip-canvas-palette') === 'collapsed'; }
  catch (e) { return false; }
})();

function _tripPaletteShell() {
  return '' +
    '<div class="tcp-head"><span>🔬 Spots</span>' +
      '<button class="tcp-btn" onclick="tripToggleCanvasPalette()" title="Collapse spots">⟨⟨</button></div>' +
    '<div class="tcp-search-wrap">' +
      '<input id="trip-palette-search" type="search" placeholder="Search spots…" ' +
        'oninput="tripPaletteSearch()"></div>' +
    '<div id="trip-palette-grid"></div>';
}
function _tripPaletteRail() {
  return '<button class="tcp-railbtn" onclick="tripToggleCanvasPalette()" title="Show spots">🔬 Spots ⟩⟩</button>';
}

// Build (once) the two-pane row and move #trip-days-container into it.
window._tripBuildCanvas = function() {
  if (!window._tripCanvasMode()) return;
  var daysView  = document.getElementById('trip-days-view');
  var container = document.getElementById('trip-days-container');
  if (!daysView || !container) return;
  if (daysView.classList.contains('hidden')) return;   // only when day lanes are shown

  var row = document.getElementById('trip-canvas-row');
  if (!row) {
    row = document.createElement('div');
    row.id = 'trip-canvas-row';
    var palette = document.createElement('div');
    palette.id = 'trip-canvas-palette';
    // Insert the row where the container currently sits, then move both panes in.
    container.parentNode.insertBefore(row, container);
    row.appendChild(palette);
    row.appendChild(container);   // moves the existing container (content preserved)
  }
  _tripApplyPaletteCollapsed();
};

function _tripApplyPaletteCollapsed() {
  var palette = document.getElementById('trip-canvas-palette');
  if (!palette) return;
  if (_tripPaletteCollapsed) {
    palette.classList.add('collapsed');
    palette.innerHTML = _tripPaletteRail();
  } else {
    palette.classList.remove('collapsed');
    palette.innerHTML = _tripPaletteShell();
    var srch = document.getElementById('trip-palette-search');
    if (srch) srch.value = _tripPaletteQuery;
    _tripRenderCanvasPalette();
  }
}

window.tripToggleCanvasPalette = function() {
  _tripPaletteCollapsed = !_tripPaletteCollapsed;
  try { localStorage.setItem('bw-trip-canvas-palette', _tripPaletteCollapsed ? 'collapsed' : 'open'); } catch (e) {}
  _tripApplyPaletteCollapsed();
};

window.tripPaletteSearch = function() {
  var el = document.getElementById('trip-palette-search');
  _tripPaletteQuery = el ? el.value : '';
  _tripRenderCanvasPalette();   // only the grid re-renders → search keeps focus
};

window._tripRenderCanvasPalette = function() {
  var grid = document.getElementById('trip-palette-grid');
  if (!grid) return;
  if (_tripPaletteSpots === null) {
    grid.innerHTML = '<p class="tcp-empty">Loading spots…</p>';
    _tripFetch('/home/trip/' + _tripPid + '/spots?location_id=0')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _tripPaletteSpots = Array.isArray(data) ? data : [];
        _tripRenderCanvasPalette();
      })
      .catch(function() { grid.innerHTML = '<p class="tcp-empty">Couldn\'t load spots.</p>'; });
    return;
  }
  var q = (_tripPaletteQuery || '').toLowerCase();
  var items = _tripPaletteSpots.filter(function(s) {
    return !q || ((s.name || '').toLowerCase().indexOf(q) >= 0);
  });
  if (!items.length) {
    grid.innerHTML = '<p class="tcp-empty">' +
      (_tripPaletteSpots.length ? 'No spots match.' : 'No spots yet — add them in the Research tab.') +
      '</p>';
    return;
  }
  // Reuse the Research spot card (draggable; its ＋Day dropdown reads _tripDays).
  grid.innerHTML = items.map(_tripRenderSpotCard).join('');
};

// Force a palette refetch (e.g. after spots change) — called opportunistically.
window._tripCanvasRefreshSpots = function() {
  _tripPaletteSpots = null;
  if (document.getElementById('trip-palette-grid')) _tripRenderCanvasPalette();
};

// Unwrap: move the container back out and remove the row (palette state kept).
window._tripCanvasTeardown = function() {
  var row       = document.getElementById('trip-canvas-row');
  var daysView  = document.getElementById('trip-days-view');
  var container = document.getElementById('trip-days-container');
  if (row && daysView && container) {
    daysView.appendChild(container);   // back to its original position
    row.remove();
  }
  _tripPaletteSpots = null;            // refetch on next open
};
