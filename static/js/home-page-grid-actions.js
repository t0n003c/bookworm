/* ── Grid Actions: media picker, upload, context menu, cell edit, delete ───────
   Depends on home-page-grid.js globals:
     _gridCells, _gridPid, _gridPickerPageId, _gridPickerCell,
     _gridPickerPage, _gridPickerTotal, _gridEditCellId, _gridPendingDelId,
     _gridLoadCells(), _gridEsc()
   ────────────────────────────────────────────────────────────────────────── */

/* ── Add media from toolbar (no pre-existing cell) ─────────────────────────── */
function gridAddMedia() {
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

    input.value = '';
    if (status) {
        status.textContent = failed
            ? ok + ' uploaded, ' + failed + ' failed.'
            : ok + ' file' + (ok === 1 ? '' : 's') + ' uploaded!';
        setTimeout(function() { status.classList.add('hidden'); }, 3500);
    }
    await _gridMediaFetch();
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
    var inGrid = {};
    _gridCells.forEach(function(c) { if (c.upload_id) inGrid[c.upload_id] = true; });

    el.innerHTML = '<div class="grid grid-cols-4 gap-2 p-3">'
        + media.map(function(f) {
            var furl    = '/uploads/' + _gridEsc(f.filename);
            var isImg   = f.mime_type.startsWith('image/');
            var already = inGrid[f.id] || false;
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
            var r = await fetch('/home/grid/' + _gridPid + '/cells/' + _gridPickerCell, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({upload_id: uploadId, cell_type: cellType})
            });
            if (!r.ok) throw new Error('patch ' + r.status);
        } else {
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
