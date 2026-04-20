/* home-widget-upload-preview.js — Upload Preview dashboard widget engine.
   Renders pinned files from any Uploads page directly inside a widget tile.

   Public API:
     _loadUploadPreview(el)         — init / re-render one widget tile
     _uplPrevOpenPicker(widgetId)   — open the file-picker modal
     _uplPrevClosePicker()          — close the file-picker modal
     _uplPrevLoadFiles(pageId)      — browse a specific uploads page
     _uplPrevPrevPage()             — picker: go to prev file page
     _uplPrevNextPage()             — picker: go to next file page
     _uplPrevToggleFile(fileId)     — picker: toggle file selection
     _uplPrevConfirm()              — picker: save selection to widget
*/

// ── Module state (var — consistent with project convention) ───────────────────
var _uplPrevWidgetId    = null;   // widget ID whose picker is open
var _uplPrevSelected    = [];     // ordered list of selected upload IDs (numbers)
var _uplPrevPickerPage  = 1;      // current page in the file picker
var _uplPrevPickerTotal = 0;      // total pages for current uploads-page
var _uplPrevPickerPid   = null;   // current uploads-page ID being browsed
var _uplPrevBusy        = false;  // guard against concurrent fetches

// ── MIME → icon (returns null for images so we render a real <img>) ───────────
function _uplMimeIcon(mime) {
    if (!mime) return '📎';
    if (mime.startsWith('image/')) return null;           // real thumbnail
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime === 'application/pdf') return '📄';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv'))
        return '📊';
    if (mime.includes('word') || mime.includes('document') || mime.includes('text'))
        return '📝';
    if (mime.includes('zip') || mime.includes('compressed') || mime.includes('archive'))
        return '🗜️';
    return '📎';
}

// ── HTML escape (matches _esc in home-widgets.js) ─────────────────────────────
function _uplEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Truncate a filename for display ──────────────────────────────────────────
function _uplTrunc(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── Build one thumbnail cell ──────────────────────────────────────────────────
function _uplThumbHtml(file, style) {
    var icon = _uplMimeIcon(file.mime_type || '');
    var name = _uplEsc(_uplTrunc(file.original_name || file.filename, 26));
    var url  = '/uploads/' + _uplEsc(file.filename);

    var inner = '';
    if (icon === null) {
        // Real image preview
        inner = '<img src="' + url + '" alt="' + name + '"'
            + ' loading="lazy" decoding="async"'
            + ' class="w-full h-full object-cover">';
    } else if (file.mime_type && file.mime_type.startsWith('video/')) {
        // Video: native element for poster frame + play icon overlay
        inner = '<video src="' + url + '" preload="metadata" muted playsinline'
            + ' class="w-full h-full object-cover pointer-events-none"></video>'
            + '<div class="absolute inset-0 flex items-center justify-center'
            + ' bg-black/30 pointer-events-none">'
            + '<span class="text-3xl">' + icon + '</span></div>';
    } else {
        // Icon + name for docs/audio/etc.
        inner = '<div class="flex flex-col items-center justify-center gap-1 p-2 h-full">'
            + '<span class="text-3xl leading-none" aria-hidden="true">' + icon + '</span>'
            + '<span class="text-[10px] text-center text-gray-600 dark:text-zinc-400'
            + ' leading-tight break-all">' + name + '</span>'
            + '</div>';
    }

    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer"'
        + ' class="relative block overflow-hidden rounded-lg bg-gray-100'
        + ' dark:bg-zinc-800 aspect-square hover:opacity-90 transition-opacity"'
        + ' title="' + name + '">'
        + inner
        + '</a>';
}

// ── Render tile contents ──────────────────────────────────────────────────────
function _uplPrevRender(el, files, style, showCaption) {
    if (!files || !files.length) {
        el.innerHTML = '<div class="flex flex-col items-center justify-center h-full'
            + ' gap-2 text-gray-300 dark:text-zinc-600 select-none py-4">'
            + '<span class="text-4xl" aria-hidden="true">🖼️</span>'
            + '<span class="text-xs text-center px-2">No files pinned — open ⚙️ to pick some</span>'
            + '</div>';
        return;
    }

    if (style === 'carousel') {
        var items = files.map(function(f) {
            var name = _uplEsc(_uplTrunc(f.original_name || f.filename, 22));
            return '<div class="flex-shrink-0 w-28">'
                + _uplThumbHtml(f, style)
                + (showCaption
                    ? '<p class="text-[10px] text-gray-500 dark:text-zinc-400 truncate mt-0.5'
                      + ' text-center leading-tight">' + name + '</p>'
                    : '')
                + '</div>';
        }).join('');

        el.innerHTML = '<div class="flex gap-2 overflow-x-auto h-full items-start'
            + ' scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-zinc-600 pb-1">'
            + items + '</div>';
    } else {
        // Grid: 1 file → 1 col, 2 files → 2 cols, 3+ → 3 cols
        var cols = files.length === 1 ? 1 : files.length === 2 ? 2 : 3;
        var items = files.map(function(f) {
            var name = _uplEsc(_uplTrunc(f.original_name || f.filename, 22));
            return '<div>'
                + _uplThumbHtml(f, style)
                + (showCaption
                    ? '<p class="text-[10px] text-gray-500 dark:text-zinc-400 truncate mt-0.5'
                      + ' leading-tight">' + name + '</p>'
                    : '')
                + '</div>';
        }).join('');

        el.innerHTML = '<div class="grid gap-1 h-full content-start"'
            + ' style="grid-template-columns: repeat(' + cols + ', minmax(0,1fr));">'
            + items + '</div>';
    }
}

// ── Load / re-render one widget tile ─────────────────────────────────────────
function _loadUploadPreview(el) {
    if (!el) return;
    var ids        = [];
    var style      = el.dataset.style      || 'grid';
    var captionRaw = el.dataset.caption    || '0';
    var showCaption = captionRaw === '1';

    try { ids = JSON.parse(el.dataset.uploadIds || '[]'); } catch (_) {}

    if (!ids || !ids.length) {
        _uplPrevRender(el, [], style, showCaption);
        return;
    }

    fetch('/home/uploads/pinned-files?ids=' + ids.join(','), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : []; })
        .then(function(files) { _uplPrevRender(el, files, style, showCaption); })
        .catch(function() { _uplPrevRender(el, [], style, showCaption); });
}

// ── Open the file-picker modal ────────────────────────────────────────────────
function _uplPrevOpenPicker(widgetId) {
    _uplPrevWidgetId = widgetId;
    _uplPrevBusy     = false;
    _uplPrevPickerPage = 1;

    // Pre-select files already pinned to this widget
    var card = document.getElementById('hw-card-' + widgetId);
    var cfg  = {};
    try { cfg = JSON.parse(card ? card.dataset.widgetConfig : '{}'); } catch (_) {}
    _uplPrevSelected = Array.isArray(cfg.upload_ids) ? cfg.upload_ids.slice() : [];

    _uplPrevUpdateCount();

    var modal = document.getElementById('upl-prev-picker-modal');
    if (modal) modal.classList.remove('hidden');

    _uplPrevFetchPages();
}

// ── Close the file-picker modal ───────────────────────────────────────────────
function _uplPrevClosePicker() {
    var modal = document.getElementById('upl-prev-picker-modal');
    if (modal) modal.classList.add('hidden');
    _uplPrevWidgetId   = null;
    _uplPrevSelected   = [];
    _uplPrevPickerPid  = null;
    _uplPrevPickerPage = 1;
    _uplPrevPickerTotal = 0;
    _uplPrevBusy       = false;
}

// ── Fetch available uploads pages for the page-selector dropdown ───────────────
function _uplPrevFetchPages() {
    var sel = document.getElementById('upl-prev-page-sel');
    if (sel) sel.innerHTML = '<option>Loading…</option>';

    fetch('/home/pages', { credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function(r) { return r.ok ? r.json() : { pages: [] }; })
        .then(function(data) {
            var pages = (data.pages || []).filter(function(p) {
                return p.page_type === 'uploads';
            });
            if (!sel) return;
            if (!pages.length) {
                sel.innerHTML = '<option value="">— No Uploads pages found —</option>';
                document.getElementById('upl-prev-files').innerHTML =
                    '<p class="text-sm text-gray-400 p-4">Create an Uploads page first.</p>';
                return;
            }
            sel.innerHTML = pages.map(function(p) {
                return '<option value="' + p.id + '">' + _uplEsc(p.name) + '</option>';
            }).join('');
            _uplPrevLoadFiles(pages[0].id);
        })
        .catch(function() {
            if (sel) sel.innerHTML = '<option>Error loading pages</option>';
        });
}

// ── Switch to browsing a different uploads page ───────────────────────────────
function _uplPrevLoadFiles(pageId) {
    _uplPrevPickerPid  = parseInt(pageId, 10) || null;
    _uplPrevPickerPage = 1;
    _uplPrevFetch();
}

// ── Fetch one page of files and render the picker grid ───────────────────────
function _uplPrevFetch() {
    if (_uplPrevBusy || !_uplPrevPickerPid) return;
    _uplPrevBusy = true;

    var box = document.getElementById('upl-prev-files');
    if (box) box.innerHTML = '<p class="text-sm text-gray-400 p-4">Loading…</p>';

    fetch('/home/uploads/' + _uplPrevPickerPid + '/files?scoped=1&page=' + _uplPrevPickerPage,
        { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : { files: [], pages: 1 }; })
        .then(function(data) {
            _uplPrevBusy        = false;
            _uplPrevPickerTotal = data.pages || 1;
            _uplPrevUpdatePageLabel();
            _uplPrevRenderPickerGrid(data.files || []);
        })
        .catch(function() {
            _uplPrevBusy = false;
            if (box) box.innerHTML = '<p class="text-sm text-red-400 p-4">Error loading files.</p>';
        });
}

// ── Render the 4-column thumbnail grid inside the picker ─────────────────────
function _uplPrevRenderPickerGrid(files) {
    var box = document.getElementById('upl-prev-files');
    if (!box) return;
    if (!files.length) {
        box.innerHTML = '<p class="text-sm text-gray-400 p-4">No files on this page.</p>';
        return;
    }

    var html = '<div class="grid grid-cols-4 gap-2 p-1">';
    files.forEach(function(f) {
        var icon    = _uplMimeIcon(f.mime_type || '');
        var name    = _uplEsc(_uplTrunc(f.original_name || f.filename, 20));
        var url     = '/uploads/' + _uplEsc(f.filename);
        var checked = _uplPrevSelected.indexOf(f.id) !== -1;
        var ring    = checked ? ' ring-2 ring-[#0053e2]' : '';

        var thumb = '';
        if (icon === null) {
            thumb = '<img src="' + url + '" alt="' + name + '" loading="lazy"'
                + ' class="w-full h-full object-cover pointer-events-none">';
        } else if (f.mime_type && f.mime_type.startsWith('video/')) {
            thumb = '<video src="' + url + '" preload="metadata" muted'
                + ' class="w-full h-full object-cover pointer-events-none"></video>'
                + '<span class="absolute inset-0 flex items-center justify-center text-xl'
                + ' bg-black/30 pointer-events-none">' + icon + '</span>';
        } else {
            thumb = '<div class="flex flex-col items-center justify-center gap-1 p-1 h-full">'
                + '<span class="text-2xl">' + icon + '</span>'
                + '<span class="text-[9px] text-center text-gray-500 break-all leading-tight">'
                + name + '</span></div>';
        }

        var checkmark = checked
            ? '<div class="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#0053e2]'
              + ' flex items-center justify-center shadow">'
              + '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"'
              + ' stroke="currentColor" stroke-width="3">'
              + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>'
              + '</svg></div>'
            : '';

        html += '<button type="button" onclick="_uplPrevToggleFile(' + f.id + ')"'
            + ' class="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800'
            + ' aspect-square cursor-pointer hover:opacity-80 transition-opacity'
            + ring + '" title="' + name + '" data-upl-id="' + f.id + '">'
            + thumb + checkmark + '</button>';
    });
    html += '</div>';
    box.innerHTML = html;
}

// ── Toggle a file in / out of the selection ───────────────────────────────────
function _uplPrevToggleFile(fileId) {
    var idx = _uplPrevSelected.indexOf(fileId);
    if (idx === -1) {
        _uplPrevSelected.push(fileId);
    } else {
        _uplPrevSelected.splice(idx, 1);
    }
    // Update the checkmark overlay on the clicked cell without re-fetching
    var btn = document.querySelector('[data-upl-id="' + fileId + '"]');
    if (btn) {
        var checked = idx === -1;  // idx was -1 means we just added it
        btn.classList.toggle('ring-2',          checked);
        btn.classList.toggle('ring-[#0053e2]',  checked);
        var existing = btn.querySelector('div.absolute.top-1');
        if (existing) existing.remove();
        if (checked) {
            var ck = document.createElement('div');
            ck.className = 'absolute top-1 right-1 w-5 h-5 rounded-full bg-[#0053e2]'
                + ' flex items-center justify-center shadow';
            ck.innerHTML = '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24"'
                + ' stroke="currentColor" stroke-width="3">'
                + '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>'
                + '</svg>';
            btn.appendChild(ck);
        }
    }
    _uplPrevUpdateCount();
}

// ── Pagination controls ───────────────────────────────────────────────────────
function _uplPrevPrevPage() {
    if (_uplPrevPickerPage <= 1) return;
    _uplPrevPickerPage--;
    _uplPrevFetch();
}
function _uplPrevNextPage() {
    if (_uplPrevPickerPage >= _uplPrevPickerTotal) return;
    _uplPrevPickerPage++;
    _uplPrevFetch();
}
function _uplPrevUpdatePageLabel() {
    var lbl = document.getElementById('upl-prev-page-label');
    if (lbl) lbl.textContent = 'Page ' + _uplPrevPickerPage + ' / ' + _uplPrevPickerTotal;
}
function _uplPrevUpdateCount() {
    var cnt = document.getElementById('upl-prev-count');
    if (cnt) cnt.textContent = _uplPrevSelected.length;
}

// ── Confirm: merge selection into widget config and re-render tile ────────────
async function _uplPrevConfirm() {
    if (_uplPrevWidgetId === null) return;
    var widgetId = _uplPrevWidgetId;
    var ids      = _uplPrevSelected.slice();

    _uplPrevClosePicker();

    // Update the preview div dataset immediately for instant render
    var card = document.getElementById('hw-card-' + widgetId);
    var el   = card ? card.querySelector('[data-upload-ids]') : null;
    if (el) {
        el.dataset.uploadIds = JSON.stringify(ids);
        _loadUploadPreview(el);
    }

    // Persist via the standard config-save path (also handles cache-bust)
    if (typeof _getCardConfig === 'function' && typeof _saveWidgetFullConfig === 'function') {
        var cfg = _getCardConfig(widgetId);
        cfg.upload_ids = ids;
        await _saveWidgetFullConfig(widgetId, cfg);
    }
}
