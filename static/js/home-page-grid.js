/**
 * home-page-grid.js — Grid Homespace page engine.
 *
 * Public API (called from home-widgets.js _initSwappedPage):
 *   initGridPage(pageId)
 *
 * Public API (called from template onclick attributes):
 *   gridSetCols(n)       — preset: 3/4/5 columns (snaps size slider)
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
    // Zoom: 30–100%. Saved in config as grid_zoom (integer percent).
    var zv = parseInt(root.dataset.gridZoom, 10);
    _gridZoom = (zv >= 30 && zv <= 100) ? zv : 100;
    var zoomSlider = document.getElementById('grid-zoom-slider');
    if (zoomSlider) zoomSlider.value = _gridZoom;
    _gridApplyLayout();
    _gridHighlightColBtn();
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

    // Attach drag listeners after DOM injection
    canvas.querySelectorAll('[data-grid-cell-id]').forEach(function(el) {
        _gridBindDrag(el);
    });
    // Re-apply layout (inline gap=0 ring-strip depends on children existing)
    _gridApplyLayout();
}

function _gridRenderCell(cell) {
    var aspect = _gridAspectClass(cell.aspect || '1:1');
    var inner  = _gridRenderCellInner(cell);
    return '<div class="relative group rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800'
         + ' cursor-grab active:cursor-grabbing ring-1 ring-gray-200 dark:ring-zinc-700'
         + ' hover:ring-[#0053e2] transition-all select-none ' + aspect + '"'
         + ' data-grid-cell-id="' + cell.id + '"'
         + ' draggable="true">'
         + inner
         + '<div class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100'
         + ' transition-opacity z-10">'
         + '<button onclick="_gridOpenCellMenu(event,' + cell.id + ')"'
         + ' class="w-6 h-6 flex items-center justify-center bg-white/80 dark:bg-zinc-800/80'
         + ' backdrop-blur-sm rounded-full text-gray-600 dark:text-gray-300 shadow'
         + ' hover:bg-white dark:hover:bg-zinc-700 text-xs leading-none'
         + ' focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0053e2]"'
         + ' aria-label="Cell options">⋯</button>'
         + '</div>'
         + '</div>';
}

function _gridRenderCellInner(cell) {
    if (cell.cell_type === 'image' && cell.file_url) {
        var caption = cell.caption ? '<p class="absolute bottom-0 inset-x-0 bg-black/50 text-white'
            + ' text-xs px-2 py-1 truncate">' + _gridEsc(cell.caption) + '</p>' : '';
        return '<img src="' + _gridEsc(cell.file_url) + '"'
             + ' class="w-full h-full object-cover" loading="lazy" alt="' + _gridEsc(cell.caption || '') + '">'
             + caption;
    }
    if (cell.cell_type === 'video' && cell.file_url) {
        return '<video src="' + _gridEsc(cell.file_url) + '"'
             + ' class="w-full h-full object-cover" muted playsinline preload="metadata"'
             + ' onclick="this.paused?this.play():this.pause()" style="cursor:pointer"></video>';
    }
    // Empty cell
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
    });

    el.addEventListener('dragend', function() {
        el.classList.remove('opacity-40');
        _gridClearDropIndicator();
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
            //   parentW: p-4 wrapper has 16px padding each side (32px total);
            //   subtract so px cells match the actual visible space.
            //   Falls back to 800 on first render before layout is calculated.
            var parent  = canvas.parentElement;
            var parentW = parent ? Math.max(0, parent.clientWidth - 32) : 0;
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

function _gridSaveConfig() {
    var fd = new FormData();
    fd.append('config_json', JSON.stringify({
        grid_min:        _gridMin,
        grid_gap:        _gridGap,
        grid_zoom:       _gridZoom,
        grid_fixed_cols: _gridFixedCols   // null clears the preset
    }));
    fetch('/home/pages/' + _gridPid + '/update-config', {method: 'POST', body: fd})
        .catch(function(e) { console.error('[grid] save config failed:', e); });
}

/* ── Add media from toolbar (no pre-existing cell) ─────────────────────────── */
function gridAddMedia() {
    // Open the picker with no target cell — gridPickMedia() will POST a new cell
    gridOpenMediaPicker(null);
}

/* ── Direct upload from picker ────────────────────────────────────────────── */
async function gridUploadFiles(input) {
    var files = Array.from(input.files || []);
    if (!files.length) return;
    if (!_gridPickerPageId) {
        alert('Select an Uploads page first so we know where to save the file.');
        return;
    }
    var status = document.getElementById('grid-upload-status');
    if (status) { status.textContent = 'Uploading…'; status.classList.remove('hidden'); }

    var ok = 0; var failed = 0;
    for (var i = 0; i < files.length; i++) {
        var fd = new FormData();
        fd.append('file', files[i]);
        try {
            var r = await fetch('/home/uploads/' + _gridPickerPageId + '/upload',
                                {method: 'POST', body: fd});
            if (!r.ok) { failed++; continue; }
            var data = await r.json();
            var uploadId = data.upload_id;
            // Tag with grid page so Uploads page can show the connection
            await fetch('/home/uploads/' + _gridPickerPageId
                        + '/files/page/' + uploadId + '/tags',
                        {method: 'POST',
                         headers: {'Content-Type': 'application/json'},
                         body: JSON.stringify({tag: 'grid:' + _gridPid})});
            ok++;
        } catch(e) {
            console.error('[grid] upload error:', e);
            failed++;
        }
    }

    input.value = '';  // allow re-selecting the same file next time
    if (status) {
        status.textContent = failed
            ? ok + ' uploaded, ' + failed + ' failed.'
            : ok + ' file' + (ok === 1 ? '' : 's') + ' uploaded!';
        setTimeout(function() { status.classList.add('hidden'); }, 3500);
    }
    await _gridMediaFetch();  // refresh gallery to show newly uploaded files
}

/* ── Cell context menu ─────────────────────────────────────────────────────── */
function _gridOpenCellMenu(event, cellId) {
    event.stopPropagation();
    var existing = document.getElementById('grid-cell-ctx-menu');
    if (existing) existing.remove();

    var cell = _gridCells.find(function(c) { return c.id === cellId; });
    if (!cell) return;

    var menu = document.createElement('div');
    menu.id = 'grid-cell-ctx-menu';
    menu.className = 'absolute z-40 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border '
                   + 'border-gray-200 dark:border-zinc-700 py-1 text-sm min-w-[160px]';
    menu.innerHTML =
        '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700"'
        + ' onclick="_gridCtxPickMedia(' + cellId + ')">🔄 Replace media</button>'
        + '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700"'
        + ' onclick="gridOpenCellEdit(' + cellId + ')">✏️ Edit caption / aspect</button>'
        + '<hr class="my-1 border-gray-200 dark:border-zinc-700">'
        + '<button class="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-700'
        + ' text-[#ea1100]" onclick="gridDeleteCell(' + cellId + ')">Remove from grid</button>';

    var rect = event.target.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
    document.body.appendChild(menu);

    setTimeout(function() {
        document.addEventListener('click', function _close() {
            var m = document.getElementById('grid-cell-ctx-menu');
            if (m) m.remove();
            document.removeEventListener('click', _close);
        });
    }, 0);
}

function _gridCtxPickMedia(cellId) {
    var m = document.getElementById('grid-cell-ctx-menu');
    if (m) m.remove();
    gridOpenMediaPicker(cellId);
}



/* ── Cell edit modal ────────────────────────────────────────────────────────── */
function gridOpenCellEdit(cellId) {
    var m = document.getElementById('grid-cell-ctx-menu');
    if (m) m.remove();
    var cell = _gridCells.find(function(c) { return c.id === cellId; });
    if (!cell) return;
    _gridEditCellId = cellId;
    document.getElementById('grid-cell-edit-caption').value = cell.caption || '';
    document.querySelectorAll('input[name="grid-aspect"]').forEach(function(r) {
        r.checked = r.value === (cell.aspect || '1:1');
    });
    document.getElementById('grid-cell-edit-modal').classList.remove('hidden');
    document.getElementById('grid-cell-edit-caption').focus();
}

function gridCloseCellEdit() {
    _gridEditCellId = null;
    document.getElementById('grid-cell-edit-modal').classList.add('hidden');
}

async function gridSaveCellEdit() {
    if (!_gridEditCellId) return;
    var caption = document.getElementById('grid-cell-edit-caption').value.trim();
    var aspect  = '1:1';
    document.querySelectorAll('input[name="grid-aspect"]').forEach(function(r) {
        if (r.checked) aspect = r.value;
    });
    try {
        var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridEditCellId, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({caption: caption, aspect: aspect})
        });
        gridCloseCellEdit();
        if (r.ok) await _gridLoadCells();
    } catch(e) { console.error('[grid] save edit:', e); }
}

/* ── Cell delete modal ──────────────────────────────────────────────────────── */
function gridDeleteCell(cellId) {
    var m = document.getElementById('grid-cell-ctx-menu');
    if (m) m.remove();
    _gridPendingDelId = cellId;
    document.getElementById('grid-cell-del-modal').classList.remove('hidden');
}

function _gridCancelDelete() {
    _gridPendingDelId = null;
    document.getElementById('grid-cell-del-modal').classList.add('hidden');
}

async function _gridConfirmDelete() {
    if (!_gridPendingDelId) return;
    var btn = document.getElementById('grid-cell-del-confirm-btn');
    if (btn) btn.disabled = true;
    try {
        await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPendingDelId,
                    {method: 'DELETE'});
        _gridCancelDelete();
        await _gridLoadCells();
    } catch(e) { console.error('[grid] delete failed:', e); }
    finally { if (btn) btn.disabled = false; }
}

/* ── Media picker ───────────────────────────────────────────────────────────── */
function gridOpenMediaPicker(cellId) {
    _gridPickerCell = cellId;
    _gridPickerPage = 1;
    document.getElementById('grid-media-modal').classList.remove('hidden');
    // If a page is already selected in the <select>, load it immediately
    if (_gridPickerPageId) {
        _gridMediaFetch();
    } else {
        document.getElementById('grid-media-files').innerHTML =
            '<p class="text-sm text-gray-400 p-4">No Uploads pages available.</p>';
    }
}

function gridCloseMediaPicker() {
    _gridPickerCell = null;
    document.getElementById('grid-media-modal').classList.add('hidden');
    document.getElementById('grid-media-files').innerHTML = '';
}

function gridMediaLoadPage(uploadsPageId) {
    _gridPickerPageId = parseInt(uploadsPageId, 10);
    _gridPickerPage   = 1;
    _gridMediaFetch();
}

function gridMediaPrevPage() {
    if (_gridPickerPage <= 1) return;
    _gridPickerPage--;
    _gridMediaFetch();
}

function gridMediaNextPage() {
    var maxPage = Math.ceil(_gridPickerTotal / 50) || 1;
    if (_gridPickerPage >= maxPage) return;
    _gridPickerPage++;
    _gridMediaFetch();
}

async function _gridMediaFetch() {
    if (!_gridPickerPageId) return;
    // Verified: GET /home/uploads/{page_id}/files?scoped=1 returns files scoped
    // to that specific uploads page.
    // Each file: {id, filename, original_name, mime_type, size}. File URL = '/uploads/' + filename.
    var url = '/home/uploads/' + _gridPickerPageId + '/files?scoped=1&page=' + _gridPickerPage;
    var el  = document.getElementById('grid-media-files');
    el.innerHTML = '<p class="text-sm text-gray-400 p-4">Loading…</p>';
    try {
        var r = await fetch(url);
        if (!r.ok) throw new Error('files ' + r.status);
        var data = await r.json();
        _gridPickerTotal = data.total || 0;
        _gridRenderMediaFiles(data.files || []);
        var maxPage = Math.max(1, data.pages || Math.ceil(_gridPickerTotal / 50));
        var lbl = document.getElementById('grid-media-page-label');
        if (lbl) lbl.textContent = 'Page ' + _gridPickerPage + ' of ' + maxPage;
    } catch(e) {
        el.innerHTML = '<p class="text-sm text-red-400 p-4">Failed to load files.</p>';
        console.error('[grid] media fetch:', e);
    }
}

function _gridRenderMediaFiles(files) {
    var el = document.getElementById('grid-media-files');
    var media = files.filter(function(f) {
        return f.mime_type &&
               (f.mime_type.startsWith('image/') || f.mime_type.startsWith('video/'));
    });
    if (!media.length) {
        el.innerHTML = '<p class="text-sm text-gray-400 p-4">No photos or videos on this page.</p>';
        return;
    }
    // Build a Set of upload_ids already placed in this grid
    var inGrid = {};
    _gridCells.forEach(function(c) { if (c.upload_id) inGrid[c.upload_id] = true; });

    el.innerHTML = '<div class="grid grid-cols-4 gap-2 p-3">'
        + media.map(function(f) {
            var furl    = '/uploads/' + _gridEsc(f.filename);
            var isImg   = f.mime_type.startsWith('image/');
            var already = inGrid[f.id] || false;
            // Already-in-grid overlay: checkmark + blue tint, button still clickable for replace
            var overlay = already
                ? '<div class="absolute inset-0 bg-[#0053e2]/30 flex items-center justify-center'
                  + ' pointer-events-none" aria-hidden="true">'
                  + '<span class="bg-[#0053e2] text-white text-xs font-bold rounded-full'
                  + ' w-6 h-6 flex items-center justify-center">&#10003;</span></div>'
                : '';
            var label = _gridEsc(f.original_name || f.filename)
                      + (already ? ' (already in grid)' : '');
            return '<button'
                 + ' class="relative aspect-square rounded-lg overflow-hidden bg-gray-100'
                 + ' dark:bg-zinc-800 hover:ring-2 hover:ring-[#0053e2] focus:outline-none'
                 + ' focus:ring-2 focus:ring-[#0053e2] transition-all"'
                 + ' onclick="gridPickMedia(' + f.id + ',\'' + _gridEsc(f.mime_type) + '\')"'
                 + ' aria-label="Select ' + label + '">'
                 + (isImg
                    ? '<img src="' + furl + '" class="w-full h-full object-cover" loading="lazy" alt="">'
                    : '<div class="w-full h-full flex items-center justify-center text-3xl"'
                      + ' aria-hidden="true">&#127916;</div>')
                 + overlay
                 + '</button>';
          }).join('')
        + '</div>';
}

async function gridPickMedia(uploadId, mimeType) {
    var cellType = mimeType.startsWith('video/') ? 'video' : 'image';
    try {
        if (_gridPickerCell) {
            // Replacing media on an existing cell
            var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPickerCell, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({upload_id: uploadId, cell_type: cellType})
            });
            if (!r.ok) throw new Error('patch ' + r.status);
        } else {
            // Adding new media — block duplicate upload_ids
            var alreadyIn = _gridCells.some(function(c) { return c.upload_id === uploadId; });
            if (alreadyIn) {
                var warnEl = document.getElementById('grid-media-files');
                var old = warnEl.querySelector('.grid-dupe-warn');
                if (old) old.remove();
                warnEl.insertAdjacentHTML('afterbegin',
                    '<p class="grid-dupe-warn text-xs text-amber-600 dark:text-amber-400'
                    + ' px-3 pt-3 pb-1 select-none">'
                    + '&#9888;&#xFE0F; That photo is already in the grid. '
                    + 'Pick a different one, or click an existing grid cell to replace it.</p>');
                return;
            }
            var r = await fetch('/home/grid/' + _gridPid + '/cells', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    cell_type: cellType,
                    upload_id: uploadId,
                    aspect: '1:1',
                    caption: ''
                })
            });
            if (!r.ok) throw new Error('create ' + r.status);
        }
        // Tag the picked file so Uploads page shows the grid connection
        // INSERT OR IGNORE — safe to call multiple times
        if (_gridPickerPageId) {
            fetch('/home/uploads/' + _gridPickerPageId
                  + '/files/page/' + uploadId + '/tags',
                  {method: 'POST',
                   headers: {'Content-Type': 'application/json'},
                   body: JSON.stringify({tag: 'grid:' + _gridPid})
                  }).catch(function(e) { console.warn('[grid] tag failed:', e); });
        }
        gridCloseMediaPicker();
        await _gridLoadCells();
    } catch(e) { console.error('[grid] pick media failed:', e); }
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
