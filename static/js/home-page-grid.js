/**
 * home-page-grid.js — Grid Homespace page engine.
 *
 * Public API (called from home-widgets.js _initSwappedPage):
 *   initGridPage(pageId)
 *
 * Public API (called from template onclick attributes):
 *   gridSetCols(n)       — preset: 3/4/5 columns (snaps size slider)
 *   gridSetAspect(a)      — page-wide aspect override ('' | '1:1' | '4:5' | '16:9')
 *   gridSetSize(px)       — live size slider
 *   gridSetGap(px)        — live gap slider
 *   gridAddMedia()
 *   gridOpenMediaPicker(cellId)  — cellId may be null (adds new cell)
 *   gridCloseMediaPicker()
 *   gridMediaLoadPage(uploadsPageId)
 *   gridMediaPrevPage()
 *   gridMediaNextPage()
 *   gridPickMedia(uploadId, mimeType)
 *   gridOpenCellEdit(cellId)
 *   gridCloseCellEdit()
 *   gridSaveCellEdit()
 *   gridDeleteCell(cellId)
 *   _gridCancelDelete()
 *   _gridConfirmDelete()
 *
 * Module-level vars use `var` (codebase convention).
 */

/* ── Module state ────────────────────────────────────────────────────── */
var _gridPid          = 0;      // current page id
var _gridMin          = 240;    // cell min-width px for auto-fill (80-400); used when _gridFixedCols is null
var _gridGap          = 8;      // gap between cells in px (0-20)
var _gridZoom         = 100;    // zoom level 30-100%: scales physical cell size, column count unchanged
var _gridFixedCols    = null;   // null=auto-fill (slider), 3/4/5=exact fixed columns
var _gridAspectOverride = '';   // ''=per-cell, '1:1'|'4:5'|'16:9'=page-wide override
var _gridSaveTimer    = null;   // debounce handle for persisting config
var _gridResizeTimer  = null;   // debounce handle for window-resize reapply
var _gridCells        = [];     // [{id, position, cell_type, upload_id, aspect, caption, file_url, mime_type, ...}]
var _gridBusy         = false;  // optimistic-lock: one mutation at a time
var _gridEditCellId   = null;   // cell being edited in the caption modal
var _gridPendingDelId = null;   // cell pending deletion confirmation
var _gridPickerCell   = null;   // cell waiting for a media pick (null = new from toolbar)
var _gridPickerPageId = null;   // current uploads page id in the picker
var _gridPickerPage   = 1;
var _gridPickerTotal  = 0;
var _gridDragId       = null;   // id of the cell being dragged
var _gridDragOverEl   = null;   // DOM element currently under the drag cursor
var _gridDropBefore   = true;   // true = insert before target, false = insert after
var _gridScrollTick   = null;   // setInterval handle — runs from dragstart to dragend
var _gridLastCursorY  = -1;     // last clientY seen from any dragover event

/* ── Entry point ───────────────────────────────────────────────────────── */
function initGridPage(pageId) {
    _gridPid = pageId;

    // Read initial settings from data attrs (seeded by Jinja template)
    var root = document.getElementById('grid-page-root');
    if (!root) return;
    _gridMin = parseInt(root.dataset.gridMin, 10) || 240;
    _gridGap = parseInt(root.dataset.gridGap, 10);
    if (isNaN(_gridGap)) _gridGap = 8;
    var fc = parseInt(root.dataset.gridFixedCols, 10);
    _gridFixedCols = (fc >= 2 && fc <= 10) ? fc : null;
    // Aspect override: page-wide ratio preference, '' = use per-cell setting.
    var ga = root.dataset.gridAspect || '';
    _gridAspectOverride = ['1:1', '4:5', '16:9'].includes(ga) ? ga : '';
    // Zoom: 30–100%. Saved in config as grid_zoom (integer percent).
    var zv = parseInt(root.dataset.gridZoom, 10);
    _gridZoom = (zv >= 30 && zv <= 100) ? zv : 100;
    var zoomSlider = document.getElementById('grid-zoom-slider');
    if (zoomSlider) zoomSlider.value = _gridZoom;
    _gridApplyLayout();
    _gridHighlightColBtn();
    _gridHighlightAspectBtn();
    var sizeSlider = document.getElementById('grid-size-slider');
    if (sizeSlider) sizeSlider.value = _gridMin;
    var gapSlider = document.getElementById('grid-gap-slider');
    if (gapSlider) gapSlider.value = _gridGap;

    // Auto-load the first uploads page into the picker selector
    var sel = document.getElementById('grid-media-page-sel');
    if (sel && sel.options.length > 0) {
        _gridPickerPageId = parseInt(sel.value, 10) || null;
    }

    // Keep px-based columns accurate when window is resized.
    // Remove first so HTMX re-swaps don’t stack duplicate listeners.
    window.removeEventListener('resize', _gridOnWindowResize);
    window.addEventListener('resize', _gridOnWindowResize);

    // Auto-scroll during drag: document-level listener records cursor Y;
    // setInterval tick (started on dragstart) does the actual scrolling.
    // remove+add prevents duplicate listeners on HTMX re-swaps.
    document.removeEventListener('dragover', _gridOnDragScroll);
    document.addEventListener('dragover', _gridOnDragScroll);

    _gridLoadCells();
}

// Window resize handler: when using explicit px columns (fixed cols + zoom < 100%)
// the px values go stale if the window is resized — reapply with fresh measurements.
function _gridOnWindowResize() {
    if (!_gridFixedCols || _gridZoom >= 100) return;
    clearTimeout(_gridResizeTimer);
    _gridResizeTimer = setTimeout(_gridApplyLayout, 120);
}

/* ── Data load ─────────────────────────────────────────────────────────────── */
async function _gridLoadCells() {
    try {
        var r = await fetch('/home/grid/' + _gridPid + '/cells');
        if (!r.ok) throw new Error('load cells ' + r.status);
        _gridCells = await r.json();
        _gridRender();
        // Silently backfill grid: tags on Uploads page for any pre-existing cells
        // that were added before auto-tagging was introduced. Idempotent.
        fetch('/home/grid/' + _gridPid + '/backfill-tags', {method: 'POST'})
            .catch(function() {});  // fire-and-forget, errors are non-fatal
    } catch(e) {
        console.error('[grid] load cells failed:', e);
    }
}

/* ── Render ─────────────────────────────────────────────────────────────────── */
function _gridRender() {
    var canvas = document.getElementById('grid-canvas');
    var hint   = document.getElementById('grid-empty-hint');
    if (!canvas) return;

    if (_gridCells.length === 0) {
        canvas.innerHTML = '';
        if (hint) { hint.classList.remove('hidden'); hint.classList.add('flex'); }
        return;
    }
    if (hint) { hint.classList.add('hidden'); hint.classList.remove('flex'); }

    canvas.innerHTML = _gridCells.filter(function(c) {
        // Skip legacy empty cells — grid is media-only now
        return c.cell_type !== 'empty';
    }).map(function(cell) {
        return _gridRenderCell(cell);
    }).join('');

    // Attach drag + hover listeners after DOM injection
    canvas.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        _gridBindDrag(el);
        _gridBindHover(el);
    });
    // Re-apply layout (inline gap=0 ring-strip depends on children existing)
    _gridApplyLayout();
}

// ─ SVG icons (inlined, no external dep) ─────────────────────────────────────────────
var _SVG_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none"'
    + ' viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M12 4v12m0 0-3.5-3.5M12 16l3.5-3.5M4 20h16"/></svg>';

var _SVG_EXPAND = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none"'
    + ' viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M4 8V4h4M16 4h4v4M4 16v4h4M16 20h4v-4"/></svg>';

var _SVG_PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5" fill="none"'
    + ' viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
    + '<path stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M15.232 5.232 18.768 8.768M9 15l-4 1 1-4L15.232 5.232a2.121 2.121 0 0 1 3 3L9 15Z"/></svg>';

// ─ Shared button class strings ─────────────────────────────────────────────
var _BTN_PILL = 'w-6 h-6 flex items-center justify-center bg-white/80 dark:bg-zinc-800/80'
    + ' backdrop-blur-sm rounded-full text-gray-600 dark:text-gray-300 shadow'
    + ' hover:bg-white dark:hover:bg-zinc-700 focus:outline-none'
    + ' focus-visible:ring-2 focus-visible:ring-[#0053e2]';

function _gridRenderCell(cell) {
    var aspect  = _gridAspectClass(_gridAspectOverride || cell.aspect || '1:1');
    var inner   = _gridRenderCellInner(cell);
    var hasFile = (cell.cell_type === 'image' || cell.cell_type === 'video') && cell.file_url;

    // ─ Top-right action row ─────────────────────────────────────────────
    var dlBtn = '';
    if (hasFile) {
        var fname = cell.original_name ? _gridEsc(cell.original_name) : '';
        dlBtn = '<a href="' + _gridEsc(cell.file_url) + '" download="' + fname + '"'
            + ' draggable="false" onclick="event.stopPropagation()"'
            + ' class="' + _BTN_PILL + '" aria-label="Download">'
            + _SVG_DOWNLOAD + '</a>';
    }

    // Expand button only for video (images open lightbox on click directly)
    var expandBtn = '';
    if (cell.cell_type === 'video' && cell.file_url) {
        expandBtn = '<button onclick="event.stopPropagation();gridLightboxOpen(' + cell.id + ')"'
            + ' draggable="false" class="' + _BTN_PILL + '" aria-label="Expand">'
            + _SVG_EXPAND + '</button>';
    }

    var menuBtn = '<button onclick="_gridOpenCellMenu(event,' + cell.id + ')"'
        + ' class="' + _BTN_PILL + ' text-xs leading-none" aria-label="Cell options">⋯</button>';

    // ─ Bottom caption bar ──────────────────────────────────────────────
    var captionBar = cell.caption
        ? '<p data-caption-id="' + cell.id + '" class="absolute bottom-0 inset-x-0 z-10'
          + ' bg-black/50 text-white text-xs px-2 py-1 truncate pointer-events-none">'
          + _gridEsc(cell.caption) + '</p>'
        : '';

    // Pencil edit button (bottom-left, visible on hover)
    var editBtn = hasFile
        ? '<button onclick="event.stopPropagation();_gridEditCaption(' + cell.id + ')"'
          + ' draggable="false"'
          + ' class="absolute bottom-1 left-1 z-20 opacity-0 group-hover:opacity-100'
          + ' transition-opacity w-5 h-5 flex items-center justify-center'
          + ' bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded-full'
          + ' text-gray-600 dark:text-gray-300 shadow hover:bg-white'
          + ' dark:hover:bg-zinc-700 focus:outline-none'
          + ' focus-visible:ring-2 focus-visible:ring-[#0053e2]"'
          + ' aria-label="Edit caption">' + _SVG_PENCIL + '</button>'
        : '';

    return '<div class="relative group rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800'
         + ' cursor-grab active:cursor-grabbing ring-1 ring-gray-200 dark:ring-zinc-700'
         + ' hover:ring-[#0053e2] transition-all select-none ' + aspect + '"'
         + ' data-grid-cell-id="' + cell.id + '"'
         + ' draggable="true">'
         + inner
         + '<div class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100'
         + ' transition-opacity z-10">'
         + dlBtn + expandBtn + menuBtn
         + '</div>'
         + captionBar
         + editBtn
         + '</div>';
}

function _gridRenderCellInner(cell) {
    if (cell.cell_type === 'image' && cell.file_url) {
        // Click opens lightbox; draggable=false prevents ghost drag from img itself
        return '<img src="' + _gridEsc(cell.file_url) + '"'
             + ' class="w-full h-full object-cover cursor-pointer" loading="lazy"'
             + ' alt="' + _gridEsc(cell.caption || '') + '"'
             + ' draggable="false"'
             + ' onclick="gridLightboxOpen(' + cell.id + ')">';
    }
    if (cell.cell_type === 'video' && cell.file_url) {
        // data-hover-preview flags this for _gridBindHover
        return '<video src="' + _gridEsc(cell.file_url) + '"'
             + ' class="w-full h-full object-cover" muted playsinline preload="metadata"'
             + ' data-hover-preview'
             + ' onclick="this.paused?this.play():this.pause()" style="cursor:pointer"></video>';
    }
    return '<div class="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400 dark:text-zinc-600">'
         + '<span class="text-3xl" aria-hidden="true">🖼️</span>'
         + '<span class="text-xs">Empty</span>'
         + '</div>';
}

function _gridAspectClass(aspect) {
    if (aspect === '4:5')  return 'aspect-[4/5]';
    if (aspect === '16:9') return 'aspect-video';
    return 'aspect-square';
}

/* ── Drag auto-scroll ───────────────────────────────────────────────────────── */
// Strategy: setInterval ticks at ~60 fps from dragstart to dragend.
// dragover events only record the last cursor Y — they don’t drive scrolling.
// This way scrolling is continuous even when dragover fires at 250 ms intervals
// or stalls entirely (stationary mouse on Windows/Chrome).
//
// The rAF approach failed because _gridScrollDir was reset to 0 by every
// dragover event on a cell *outside* the scroll zone — killing the loop.

var _GRID_SCROLL_ZONE = 220;  // px from viewport top/bottom edge
var _GRID_SCROLL_MAX  = 60;   // px per tick at peak (cursor at the very edge)

function _gridOnDragScroll(e) {
    // Just record position; the interval tick does the actual scrolling.
    if (_gridDragId) _gridLastCursorY = e.clientY;
}

function _gridScrollStart() {
    if (_gridScrollTick) return;   // already running
    _gridScrollTick = setInterval(_gridScrollTick_fn, 16);
}

function _gridScrollStop() {
    clearInterval(_gridScrollTick);
    _gridScrollTick  = null;
    _gridLastCursorY = -1;
}

function _gridScrollTick_fn() {
    if (_gridLastCursorY < 0) return;
    var el = document.getElementById('main-content');
    if (!el) return;
    var fromBottom = window.innerHeight - _gridLastCursorY;
    var fromTop    = _gridLastCursorY;
    var dir = 0, speed = 0;
    if (fromBottom < _GRID_SCROLL_ZONE) {
        dir   =  1;
        speed = Math.max(2, Math.round(_GRID_SCROLL_MAX * (1 - fromBottom / _GRID_SCROLL_ZONE)));
    } else if (fromTop < _GRID_SCROLL_ZONE) {
        dir   = -1;
        speed = Math.max(2, Math.round(_GRID_SCROLL_MAX * (1 - fromTop / _GRID_SCROLL_ZONE)));
    }
    if (dir !== 0) el.scrollTop += dir * speed;
}

/* ── Drag-to-reorder ────────────────────────────────────────────────────────── */
// Shows a blue insertion line on the left/right edge of the hovered cell.
// On drop, removes the dragged cell from its current slot and inserts it
// before or after the target, then PATCHes the server with the new order.

function _gridClearDropIndicator() {
    if (_gridDragOverEl) {
        _gridDragOverEl.style.boxShadow = '';
        _gridDragOverEl.style.borderRadius = '';
        _gridDragOverEl = null;
    }
}

function _gridSetDropIndicator(el, before) {
    if (_gridDragOverEl && _gridDragOverEl !== el) _gridClearDropIndicator();
    _gridDragOverEl = el;
    _gridDropBefore = before;
    // Thick blue inset stripe on the insert edge; right side when inserting after.
    el.style.boxShadow = before
        ? 'inset 4px 0 0 0 #0053e2'
        : 'inset -4px 0 0 0 #0053e2';
}

function _gridBindDrag(el) {
    el.addEventListener('dragstart', function(e) {
        _gridDragId = parseInt(el.dataset.gridCellId, 10);
        e.dataTransfer.effectAllowed = 'move';
        // Defer opacity so the drag ghost captures the normal appearance.
        setTimeout(function() { el.classList.add('opacity-40'); }, 0);
        _gridScrollStart();
    });

    el.addEventListener('dragend', function() {
        el.classList.remove('opacity-40');
        _gridClearDropIndicator();
        _gridScrollStop();
        _gridDragId = null;
    });

    el.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!_gridDragId) return;
        var targetId = parseInt(el.dataset.gridCellId, 10);
        if (targetId === _gridDragId) return;  // hovering own cell — no indicator
        // Left half of cell = insert before; right half = insert after.
        var rect   = el.getBoundingClientRect();
        var before = (e.clientX - rect.left) < rect.width / 2;
        _gridSetDropIndicator(el, before);
    });

    el.addEventListener('dragleave', function(e) {
        // Only clear when truly leaving this cell (not entering a child element).
        if (el.contains(e.relatedTarget)) return;
        if (_gridDragOverEl === el) _gridClearDropIndicator();
    });

    el.addEventListener('drop', function(e) {
        e.preventDefault();
        var targetId = parseInt(el.dataset.gridCellId, 10);
        var before   = _gridDropBefore;
        _gridClearDropIndicator();
        if (_gridDragId && targetId && _gridDragId !== targetId) {
            _gridReorder(_gridDragId, targetId, before);
        }
    });
}

/* ── Video hover-preview ───────────────────────────────────────────────────── */

function _gridBindHover(el) {
    var vid = el.querySelector('[data-hover-preview]');
    if (!vid) return;   // image / empty cells — nothing to do

    el.addEventListener('mouseenter', function() {
        if (_gridDragId) return;   // don’t play during drag
        vid.currentTime = 0;
        vid.play().catch(function() {});  // catch autoplay policy rejections silently
    });
    el.addEventListener('mouseleave', function() {
        vid.pause();
        vid.currentTime = 0;
    });
}

/* ── Caption inline editing ────────────────────────────────────────────────── */

function _gridEditCaption(cellId) {
    var cell = _gridCells.find(function(c) { return c.id === cellId; });
    if (!cell) return;
    var cellEl = document.querySelector('[data-grid-cell-id="' + cellId + '"]');
    if (!cellEl) return;

    // Replace caption bar + pencil button with an input
    var captEl  = cellEl.querySelector('[data-caption-id]');
    var pencilEl = cellEl.querySelector('[aria-label="Edit caption"]');
    if (captEl)   captEl.classList.add('hidden');
    if (pencilEl) pencilEl.classList.add('hidden');

    var inp = document.createElement('input');
    inp.type  = 'text';
    inp.value = cell.caption || '';
    inp.maxLength = 120;
    inp.placeholder = 'Add a caption…';
    inp.setAttribute('draggable', 'false');
    inp.className = 'absolute bottom-0 inset-x-0 z-20 bg-black/70 text-white'
        + ' text-xs px-2 py-1.5 placeholder-white/40 focus:outline-none'
        + ' focus:ring-1 focus:ring-[#ffc220]';

    function _save() {
        var newCaption = inp.value.trim().slice(0, 120);
        inp.remove();
        // Update local state
        cell.caption = newCaption;
        // Re-render just this cell
        var freshHtml = _gridRenderCell(cell);
        var tmp = document.createElement('div');
        tmp.innerHTML = freshHtml;
        var newEl = tmp.firstElementChild;
        cellEl.replaceWith(newEl);
        _gridBindDrag(newEl);
        _gridBindHover(newEl);
        _gridApplyLayout();
        // Persist to server (fire-and-forget with error toast)
        fetch('/home/grid/' + _gridPid + '/cell/' + cellId + '/caption', {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({caption: newCaption}),
        }).catch(function() {
            console.error('[grid] caption save failed for cell', cellId);
        });
    }

    inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter')  { e.preventDefault(); _save(); }
        if (e.key === 'Escape') { inp.remove(); if (captEl) captEl.classList.remove('hidden'); if (pencilEl) pencilEl.classList.remove('hidden'); }
    });
    inp.addEventListener('blur', _save);
    inp.addEventListener('click',   function(e) { e.stopPropagation(); });
    inp.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    inp.addEventListener('dragstart', function(e) { e.stopPropagation(); e.preventDefault(); });

    cellEl.appendChild(inp);
    inp.focus();
    inp.select();
}

async function _gridReorder(dragId, targetId, insertBefore) {
    if (_gridBusy) return;
    _gridBusy = true;

    // Build new order array locally for instant visual feedback.
    var newCells = _gridCells.slice();  // shallow copy
    var dragIdx  = newCells.findIndex(function(c) { return c.id === dragId; });
    var dragged  = newCells.splice(dragIdx, 1)[0];
    var targetIdx = newCells.findIndex(function(c) { return c.id === targetId; });
    newCells.splice(insertBefore ? targetIdx : targetIdx + 1, 0, dragged);

    // Re-assign positions 0, 1, 2, … to match new array order.
    newCells.forEach(function(c, i) { c.position = i; });
    _gridCells = newCells;
    _gridRender();

    try {
        var r = await fetch('/home/grid/' + _gridPid + '/reorder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({order: _gridCells.map(function(c) { return c.id; })})
        });
        if (!r.ok) throw new Error('reorder ' + r.status);
    } catch(err) {
        console.error('[grid] reorder failed — reloading from server:', err);
        await _gridLoadCells();  // server state wins on failure
    } finally {
        _gridBusy = false;
    }
}

/* ── Column presets + size/gap sliders ────────────────────────────────── */

// 3/4/5 preset buttons: EXACT column count — click active preset again to toggle off

function gridSetAspect(a) {
    _gridAspectOverride = (_gridAspectOverride === a) ? '' : a;  // toggle off if already active
    _gridHighlightAspectBtn();
    _gridRender();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

function gridSetCols(n) {
    _gridFixedCols = (_gridFixedCols === n) ? null : n;  // toggle
    _gridApplyLayout();
    _gridHighlightColBtn();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

// Size slider: exits preset mode → auto-fill with the new px width.
// (Dragging the slider means the user wants flexible sizing, not locked columns.)
function gridSetSize(px) {
    // NOTE: parseInt('80') = 80, fine to use || fallback here since min is 80
    _gridMin = Math.max(80, Math.min(800, parseInt(px, 10) || 240));
    _gridFixedCols = null;   // slider always exits preset mode
    _gridApplyLayout();
    _gridHighlightColBtn();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

// Zoom slider (30–100%)
// CSS zoom scales the canvas so more rows are visible at once.
// At z%, the canvas is rendered at z% of its natural size, so the grid
// physically shrinks while keeping the same column structure.
function gridSetZoom(pct) {
    var n = parseInt(pct, 10);
    _gridZoom = isNaN(n) ? 100 : Math.max(30, Math.min(100, n));
    _gridApplyLayout();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

// Gap slider (0–20 px)
function gridSetGap(px) {
    // NOTE: parseInt('0') = 0 which is falsy — must NOT use `|| fallback` here
    var n = parseInt(px, 10);
    _gridGap = isNaN(n) ? 8 : Math.max(0, Math.min(20, n));
    _gridApplyLayout();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

function _gridApplyLayout() {
    var canvas = document.getElementById('grid-canvas');
    if (!canvas) return;

    // Never use CSS zoom or transform — both cause the grid engine to re-measure
    // column widths on the scaled canvas, which changes the column count.
    // Instead we drive everything through explicit pixel column widths.
    canvas.style.zoom  = '';
    canvas.style.width = '';

    var z = _gridZoom / 100;  // 0.30 – 1.00

    if (_gridFixedCols) {
        if (z < 1) {
            // Zoom < 100% with a column preset:
            //   Switch 1fr → explicit px so cell SIZE shrinks with zoom while
            //   COLUMN COUNT stays exactly _gridFixedCols.
            //
            //   parentW: read computed padding so it works across all screen sizes.
            //   Falls back to 800 on first render before layout is calculated.
            var parent  = canvas.parentElement;
            var cs      = parent ? getComputedStyle(parent) : null;
            var hPad    = cs ? (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) : 32;
            var parentW = parent ? Math.max(0, parent.clientWidth - hPad) : 0;
            if (parentW <= 0) parentW = 800;
            var totalGap = _gridGap * (_gridFixedCols - 1);
            var cellPx   = Math.max(40, Math.round((parentW - totalGap) / _gridFixedCols * z));
            canvas.style.gridTemplateColumns = 'repeat(' + _gridFixedCols + ', ' + cellPx + 'px)';
        } else {
            // 100% zoom: 1fr fills the container responsively (original behaviour)
            canvas.style.gridTemplateColumns = 'repeat(' + _gridFixedCols + ', 1fr)';
        }
    } else {
        // Auto-fill (size slider): scale min-width by zoom.
        // Column count naturally shifts with zoom in auto-fill — that’s fine.
        var minPx = Math.max(40, Math.round(_gridMin * z));
        canvas.style.gridTemplateColumns = 'repeat(auto-fill, ' + minPx + 'px)';
    }

    canvas.style.gap            = _gridGap + 'px';
    canvas.style.justifyContent = 'center';  // centres px-cols when narrower than container

    // gap=0: strip ring box-shadow + border-radius so cells truly touch.
    var zeroGap = (_gridGap === 0);
    Array.from(canvas.children).forEach(function(cell) {
        cell.style.boxShadow    = zeroGap ? 'none' : '';
        cell.style.borderRadius = zeroGap ? '0'    : '';
    });
}

function _gridHighlightColBtn() {
    [3, 4, 5].forEach(function(n) {
        var btn = document.getElementById('grid-col-btn-' + n);
        if (!btn) return;
        var active = (_gridFixedCols === n);
        btn.setAttribute('aria-pressed', String(active));
        btn.classList.toggle('bg-[#0053e2]',        active);
        btn.classList.toggle('text-white',           active);
        btn.classList.toggle('border-[#0053e2]',     active);
        btn.classList.toggle('border-gray-300',     !active);
        btn.classList.toggle('dark:border-zinc-600',!active);
    });
}

function _gridHighlightAspectBtn() {
    ['1:1', '4:5', '16:9'].forEach(function(a) {
        var btn = document.getElementById('grid-asp-btn-' + a.replace(':', '-'));
        if (!btn) return;
        var active = (_gridAspectOverride === a);
        btn.setAttribute('aria-pressed', String(active));
        btn.classList.toggle('bg-[#0053e2]',         active);
        btn.classList.toggle('text-white',            active);
        btn.classList.toggle('border-[#0053e2]',      active);
        btn.classList.toggle('border-gray-300',      !active);
        btn.classList.toggle('dark:border-zinc-600', !active);
    });
}

function _gridSaveConfig() {
    var fd = new FormData();
    fd.append('config_json', JSON.stringify({
        grid_min:        _gridMin,
        grid_gap:        _gridGap,
        grid_zoom:       _gridZoom,
        grid_fixed_cols: _gridFixedCols,   // null clears the preset
        grid_aspect:     _gridAspectOverride
    }));
    fetch('/home/pages/' + _gridPid + '/update-config', {method: 'POST', body: fd})
        .catch(function(e) { console.error('[grid] save config failed:', e); });
}

/* ── HTML escape helper ────────────────────────────────────────────────────── */
function _gridEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');
}
