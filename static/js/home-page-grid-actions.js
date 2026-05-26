/* ── Grid Actions: media picker, upload, context menu, cell edit, delete ───────
   Depends on home-page-grid.js globals:
     _gridCells, _gridPid, _gridPickerPageId, _gridPickerCell,
     _gridPickerPage, _gridPickerTotal, _gridEditCellId, _gridPendingDelId,
     _gridLoadCells(), _gridEsc()
   ──────────────────────────────────────────────────────────────────────────── */

// Basket of uploadId → mimeType for multi-add mode.
// Cleared when the picker opens or closes.
var _gridPickerSelected = {};

/* ── Add media from toolbar (no pre-existing cell) ─────────────────────────── */
function gridAddMedia() {
    gridOpenMediaPicker(null);
}

/* ── Direct upload from picker ────────────────────────────────────────── */
// Core upload logic — accepts a plain FileList so both the file-input
// change handler and the drag-and-drop handler can call the same code.
async function _gridUploadFileList(files) {
    if (!files || !files.length) return;
    if (!_gridPickerPageId) {
        alert('Select an Uploads page first so we know where to save the file.');
        return;
    }
    var status = document.getElementById('grid-upload-status');
    if (status) { status.textContent = 'Uploading…'; status.classList.remove('hidden'); }

    var ok = 0; var failed = 0; var lastErr = '';
    for (var i = 0; i < files.length; i++) {
        var fd = new FormData();
        fd.append('file', files[i]);
        try {
            var r = await fetch('/home/uploads/' + _gridPickerPageId + '/upload',
                                {method: 'POST', body: fd});
            if (!r.ok) {
                try { var eb = await r.json(); lastErr = eb.detail || ('HTTP ' + r.status); }
                catch(_) { lastErr = 'HTTP ' + r.status; }
                failed++;
                continue;
            }
            var data = await r.json();
            await fetch('/home/uploads/' + _gridPickerPageId
                        + '/files/page/' + data.upload_id + '/tags',
                        {method: 'POST',
                         headers: {'Content-Type': 'application/json'},
                         body: JSON.stringify({tag: 'grid:' + _gridPid})});
            ok++;
        } catch(e) { console.error('[grid] upload error:', e); failed++; }
    }

    if (status) {
        if (failed && ok === 0) {
            status.textContent = '\u274c Upload failed: ' + (lastErr || 'unknown error');
            status.classList.remove('hidden');
            setTimeout(function() { status.classList.add('hidden'); }, 7000);
        } else if (failed) {
            status.textContent = ok + ' uploaded, ' + failed + ' failed (' + lastErr + ')';
            setTimeout(function() { status.classList.add('hidden'); }, 5000);
        } else {
            status.textContent = ok + ' file' + (ok === 1 ? '' : 's') + ' uploaded!';
            setTimeout(function() { status.classList.add('hidden'); }, 3500);
        }
    }
    await _gridMediaFetch();
}

/* Triggered by the file-input onChange. */
async function gridUploadFiles(input) {
    await _gridUploadFileList(input.files);
    input.value = '';
}

/* Triggered by a file(s) being dropped onto the upload zone. */
async function gridUploadDrop(event) {
    var dt    = event.dataTransfer;
    var files = dt && dt.files;
    if (files && files.length) {
        // Filter to images and videos only (mirrors the input accept attribute)
        var accepted = Array.from(files).filter(function(f) {
            return f.type.startsWith('image/') || f.type.startsWith('video/');
        });
        if (!accepted.length) return;
        // Fake a FileList-like iterable for _gridUploadFileList
        await _gridUploadFileList(accepted);
    }
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
    _gridPickerCell     = cellId;
    _gridPickerSelected = {};
    _gridPickerPage     = 1;
    // Title reflects mode
    var title = document.getElementById('grid-media-modal-title');
    if (title) title.textContent = cellId ? 'Replace media' : 'Add photos \u0026 videos';
    // Add-bar only appears in add-mode
    var bar = document.getElementById('grid-media-add-bar');
    if (bar) bar.classList.toggle('hidden', cellId !== null);
    _gridPickerUpdateBar();
    document.getElementById('grid-media-modal').classList.remove('hidden');
    if (_gridPickerPageId) {
        _gridMediaFetch();
    } else {
        document.getElementById('grid-media-files').innerHTML =
            '<p class="text-sm text-gray-400 p-4">No Uploads pages available.</p>';
    }
}

function gridCloseMediaPicker() {
    _gridPickerCell     = null;
    _gridPickerSelected = {};
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
    var inGrid    = {};
    _gridCells.forEach(function(c) { if (c.upload_id) inGrid[c.upload_id] = true; });
    var isAddMode = (_gridPickerCell === null);

    el.innerHTML = '<div class="grid grid-cols-4 gap-2 p-3">'
        + media.map(function(f) {
            var furl    = '/uploads/' + _gridEsc(f.filename);
            var isImg   = f.mime_type.startsWith('image/');
            var isVid   = f.mime_type.startsWith('video/');
            var already = inGrid[f.id] || false;
            var isSel   = !!_gridPickerSelected[f.id];
            var label   = _gridEsc(f.original_name || f.filename);

            // Thumbnail: real video frame via #t=0.5 seek, or image
            var thumb = isImg
                ? '<img src="' + furl + '" class="w-full h-full object-cover"'
                  + ' loading="lazy" decoding="async" alt="">'
                : '<video src="' + furl + '#t=0.5" preload="metadata" muted playsinline'
                  + ' class="w-full h-full object-cover pointer-events-none"'
                  + ' aria-hidden="true"></video>'
                  + '<div class="absolute inset-0 flex items-center justify-center pointer-events-none">'
                  + '<div class="bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">'
                  + '<svg class="w-3.5 h-3.5 fill-white ml-0.5" viewBox="0 0 16 16">'
                  + '<path d="M4 3l10 5-10 5V3z"/></svg></div></div>';

            // “Already in grid” badge — small, corner-pinned, informational only
            var alreadyBadge = already
                ? '<div class="absolute top-1 right-1 bg-[#0053e2] text-white leading-tight'
                  + ' text-[9px] font-bold rounded-full px-1.5 py-0.5 pointer-events-none z-20">In grid</div>'
                : '';

            // Selection overlay — only in add-mode
            var selOverlay = (isAddMode && isSel)
                ? '<div data-sel-ov class="absolute inset-0 bg-[#0053e2]/25 flex items-center'
                  + ' justify-center pointer-events-none z-10">'
                  + '<div class="bg-[#0053e2] rounded-full w-6 h-6 flex items-center justify-center shadow">'
                  + '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"'
                  + ' stroke="white" stroke-width="3.5">'
                  + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>'
                  + '</svg></div></div>'
                : '';

            var clickFn = isAddMode
                ? '_gridPickerToggle(' + f.id + ',\'' + _gridEsc(f.mime_type) + '\')'
                : 'gridPickMedia(' + f.id + ',\'' + _gridEsc(f.mime_type) + '\')';

            var ringCls = (isAddMode && isSel) ? ' ring-2 ring-[#0053e2]' : '';

            return '<button'
                 + ' data-picker-id="' + f.id + '"'
                 + ' class="relative aspect-square rounded-lg overflow-hidden bg-gray-100'
                 + ' dark:bg-zinc-800 hover:ring-2 hover:ring-[#0053e2] focus:outline-none'
                 + ' focus:ring-2 focus:ring-[#0053e2] transition-all' + ringCls + '"'
                 + ' onclick="' + clickFn + '"'
                 + ' aria-label="' + (isAddMode ? 'Select ' : 'Use ') + label + '"'
                 + (isAddMode ? ' aria-pressed="' + isSel + '"' : '') + '>'
                 + thumb + selOverlay + alreadyBadge
                 + '</button>';
        }).join('')
        + '</div>';
}

// Toggle a file in/out of the selection basket and update the button visually.
function _gridPickerToggle(uploadId, mimeType) {
    if (_gridPickerSelected[uploadId]) {
        delete _gridPickerSelected[uploadId];
    } else {
        _gridPickerSelected[uploadId] = mimeType;
    }
    var isSel = !!_gridPickerSelected[uploadId];
    var btn   = document.querySelector('[data-picker-id="' + uploadId + '"]');
    if (btn) {
        btn.setAttribute('aria-pressed', isSel);
        btn.classList.toggle('ring-2',         isSel);
        btn.classList.toggle('ring-[#0053e2]', isSel);
        var old = btn.querySelector('[data-sel-ov]');
        if (old) old.remove();
        if (isSel) {
            btn.insertAdjacentHTML('beforeend',
                '<div data-sel-ov class="absolute inset-0 bg-[#0053e2]/25 flex items-center'
                + ' justify-center pointer-events-none z-10">'
                + '<div class="bg-[#0053e2] rounded-full w-6 h-6 flex items-center justify-center shadow">'
                + '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"'
                + ' stroke="white" stroke-width="3.5">'
                + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>'
                + '</svg></div></div>');
        }
    }
    _gridPickerUpdateBar();
}

// Refresh the "X selected / Add to grid" bar count and button state.
function _gridPickerUpdateBar() {
    var n   = Object.keys(_gridPickerSelected).length;
    var btn = document.getElementById('grid-media-add-btn');
    var lbl = document.getElementById('grid-media-sel-count');
    if (lbl) lbl.textContent = n === 0 ? 'None selected' : n + '\u00a0selected';
    if (btn) btn.disabled = (n === 0);
}

// Add all selected items to the grid then close.
async function _gridPickerAddSelected() {
    var ids = Object.keys(_gridPickerSelected);
    if (!ids.length) return;
    var addBtn = document.getElementById('grid-media-add-btn');
    if (addBtn) addBtn.disabled = true;
    for (var i = 0; i < ids.length; i++) {
        var uid  = parseInt(ids[i], 10);
        var mime = _gridPickerSelected[uid];
        try {
            var r = await fetch('/home/grid/' + _gridPid + '/cells', {
                method:  'POST',
                headers: {'Content-Type': 'application/json'},
                body:    JSON.stringify({
                    cell_type: mime.startsWith('video/') ? 'video' : 'image',
                    upload_id: uid,
                    aspect:    '1:1',
                    caption:   ''
                })
            });
            if (!r.ok) throw new Error('create ' + r.status);
            if (_gridPickerPageId) {
                fetch('/home/uploads/' + _gridPickerPageId
                      + '/files/page/' + uid + '/tags',
                      { method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({tag: 'grid:' + _gridPid}) })
                    .catch(function(e) { console.warn('[grid] tag failed:', e); });
            }
        } catch(e) { console.error('[grid] add failed:', e); }
    }
    gridCloseMediaPicker();
    await _gridLoadCells();
}

// Called only in replace-mode (_gridPickerCell is set).
// Add-mode uses _gridPickerToggle + _gridPickerAddSelected instead.
async function gridPickMedia(uploadId, mimeType) {
    if (!_gridPickerCell) return;  // guard: shouldn't happen
    var cellType = mimeType.startsWith('video/') ? 'video' : 'image';
    try {
        var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPickerCell, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({upload_id: uploadId, cell_type: cellType})
        });
        if (!r.ok) throw new Error('patch ' + r.status);
        if (_gridPickerPageId) {
            fetch('/home/uploads/' + _gridPickerPageId
                  + '/files/page/' + uploadId + '/tags',
                  { method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({tag: 'grid:' + _gridPid}) })
                .catch(function(e) { console.warn('[grid] tag failed:', e); });
        }
        gridCloseMediaPicker();
        await _gridLoadCells();
    } catch(e) { console.error('[grid] pick media failed:', e); }
}
