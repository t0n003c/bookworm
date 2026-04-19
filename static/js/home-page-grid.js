/**
 * home-page-grid.js — Grid Homespace page engine.
 *
 * Public API (called from home-widgets.js _initSwappedPage):
 *   initGridPage(pageId)
 *
 * Public API (called from template onclick attributes):
 *   gridSetSize(px)
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
var _gridCols         = 4;      // 3 | 4 | 5 — grid column count
var _gridThumb        = 100;    // 30-100 — thumbnail scale % within each column
var _gridSaveTimer    = null;   // debounce handle for persisting config
var _gridCells        = [];     // [{id, position, cell_type, upload_id, aspect, caption, file_url, mime_type, ...}]
var _gridBusy         = false;  // optimistic-lock: one mutation at a time
var _gridEditCellId   = null;   // cell being edited in the caption modal
var _gridPendingDelId = null;   // cell pending deletion confirmation
var _gridPickerCell   = null;   // cell waiting for a media pick (null = new from toolbar)
var _gridPickerPageId = null;   // current uploads page id in the picker
var _gridPickerPage   = 1;
var _gridPickerTotal  = 0;
var _gridDragId       = null;   // id of the cell being dragged

/* ── Entry point ───────────────────────────────────────────────────────── */
function initGridPage(pageId) {
    _gridPid = pageId;

    // Read initial settings from data attrs (seeded by Jinja template)
    var root = document.getElementById('grid-page-root');
    if (!root) return;
    _gridCols  = parseInt(root.dataset.gridCols,  10) || 4;
    _gridThumb = parseInt(root.dataset.gridThumb, 10) || 100;
    _gridHighlightColBtn(_gridCols);
    _gridApplyCols();
    _gridApplyThumb();
    // Sync slider thumb to stored value
    var slider = document.getElementById('grid-size-slider');
    if (slider) slider.value = _gridThumb;

    // Auto-load the first uploads page into the picker selector
    var sel = document.getElementById('grid-media-page-sel');
    if (sel && sel.options.length > 0) {
        _gridPickerPageId = parseInt(sel.value, 10) || null;
    }

    _gridLoadCells();
}

/* ── Data load ─────────────────────────────────────────────────────────────── */
async function _gridLoadCells() {
    try {
        var r = await fetch('/home/grid/' + _gridPid + '/cells');
        if (!r.ok) throw new Error('load cells ' + r.status);
        _gridCells = await r.json();
        _gridRender();
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
}

function _gridRenderCell(cell) {
    var aspect = _gridAspectClass(cell.aspect || '1:1');
    var inner  = _gridRenderCellInner(cell);
    return '<div class="relative group rounded-xl overflow-hidden bg-gray-100 dark:bg-zinc-800'
         + ' cursor-grab active:cursor-grabbing ring-1 ring-gray-200 dark:ring-zinc-700'
         + ' hover:ring-[#0053e2] transition-all select-none justify-self-center ' + aspect + '"'
         + ' style="width:var(--grid-thumb,100%)"'
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

/* ── Drag-to-swap ───────────────────────────────────────────────────────────── */
function _gridBindDrag(el) {
    el.addEventListener('dragstart', function(e) {
        _gridDragId = parseInt(el.dataset.gridCellId, 10);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('opacity-50');
    });
    el.addEventListener('dragend', function() {
        _gridDragId = null;
        el.classList.remove('opacity-50');
        // Remove all drop-highlight classes
        document.querySelectorAll('[data-grid-cell-id]').forEach(function(c) {
            c.classList.remove('ring-[#ffc220]', 'ring-2');
        });
    });
    el.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('ring-[#ffc220]', 'ring-2');
    });
    el.addEventListener('dragleave', function(e) {
        // Only clear highlight when truly leaving this cell, not entering a child element.
        if (el.contains(e.relatedTarget)) return;
        el.classList.remove('ring-[#ffc220]', 'ring-2');
    });
    el.addEventListener('drop', function(e) {
        e.preventDefault();
        el.classList.remove('ring-[#ffc220]', 'ring-2');
        var targetId = parseInt(el.dataset.gridCellId, 10);
        if (_gridDragId && targetId && _gridDragId !== targetId) {
            _gridSwap(_gridDragId, targetId);
        }
    });
}

async function _gridSwap(a, b) {
    if (_gridBusy) return;
    _gridBusy = true;

    // Optimistic local swap (instant visual feedback)
    var ai = _gridCells.findIndex(function(c) { return c.id === a; });
    var bi = _gridCells.findIndex(function(c) { return c.id === b; });
    if (ai >= 0 && bi >= 0) {
        var tmp = _gridCells[ai].position;
        _gridCells[ai].position = _gridCells[bi].position;
        _gridCells[bi].position = tmp;
        _gridCells.sort(function(x, y) { return x.position - y.position; });
        _gridRender();
    }

    try {
        var r = await fetch('/home/grid/' + _gridPid + '/swap', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({a: a, b: b})
        });
        if (!r.ok) throw new Error('swap ' + r.status);
    } catch(err) {
        console.error('[grid] swap failed — rolling back:', err);
        await _gridLoadCells();  // server state wins
    } finally {
        _gridBusy = false;
    }
}

/* ── Column picker ─────────────────────────────────────────────────────── */
async function gridSetCols(n) {
    _gridCols = n;
    _gridHighlightColBtn(n);
    _gridApplyCols();
    _gridSaveConfig();
}

function _gridApplyCols() {
    var canvas = document.getElementById('grid-canvas');
    if (!canvas) return;
    canvas.style.gridTemplateColumns = 'repeat(' + _gridCols + ', minmax(0, 1fr))';
}

function _gridHighlightColBtn(n) {
    [3, 4, 5].forEach(function(c) {
        var btn = document.getElementById('grid-col-btn-' + c);
        if (!btn) return;
        var active = c === n;
        btn.setAttribute('aria-pressed', String(active));
        btn.classList.toggle('bg-[#0053e2]',       active);
        btn.classList.toggle('text-white',          active);
        btn.classList.toggle('border-[#0053e2]',    active);
        btn.classList.toggle('border-gray-300',    !active);
        btn.classList.toggle('dark:border-zinc-600',!active);
    });
}

/* ── Thumbnail size slider ────────────────────────────────────────────── */
function gridSetSize(pct) {
    // Called live on slider oninput — apply immediately, debounce the DB save
    _gridThumb = parseInt(pct, 10) || 100;
    _gridApplyThumb();
    clearTimeout(_gridSaveTimer);
    _gridSaveTimer = setTimeout(_gridSaveConfig, 600);
}

function _gridApplyThumb() {
    var canvas = document.getElementById('grid-canvas');
    if (!canvas) return;
    canvas.style.setProperty('--grid-thumb', _gridThumb + '%');
}

function _gridSaveConfig() {
    var fd = new FormData();
    fd.append('config_json', JSON.stringify({grid_cols: _gridCols, grid_thumb: _gridThumb}));
    fetch('/home/pages/' + _gridPid + '/update-config', {method: 'POST', body: fd})
        .catch(function(e) { console.error('[grid] save config failed:', e); });
}

/* ── Add media from toolbar (no pre-existing cell) ─────────────────────────── */
function gridAddMedia() {
    // Open the picker with no target cell — gridPickMedia() will POST a new cell
    gridOpenMediaPicker(null);
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
    el.innerHTML = '<div class="grid grid-cols-4 gap-2 p-3">'
        + media.map(function(f) {
            var furl  = '/uploads/' + _gridEsc(f.filename);
            var isImg = f.mime_type.startsWith('image/');
            return '<button'
                 + ' class="aspect-square rounded-lg overflow-hidden bg-gray-100'
                 + ' dark:bg-zinc-800 hover:ring-2 hover:ring-[#0053e2] focus:outline-none'
                 + ' focus:ring-2 focus:ring-[#0053e2]"'
                 + ' onclick="gridPickMedia(' + f.id + ',\'' + _gridEsc(f.mime_type) + '\')"'
                 + ' aria-label="Select ' + _gridEsc(f.original_name || f.filename) + '">'
                 + (isImg
                    ? '<img src="' + furl + '" class="w-full h-full object-cover" loading="lazy" alt="">'
                    : '<div class="w-full h-full flex items-center justify-center text-3xl"'
                      + ' aria-hidden="true">🎬</div>')
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
            // Adding new media from toolbar — create cell + attach in one shot
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
