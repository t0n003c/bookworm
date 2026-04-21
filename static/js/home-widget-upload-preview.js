/* home-widget-upload-preview.js — Upload Preview dashboard widget engine.
   Renders pinned files from any Uploads page directly inside a widget tile.

   Public API:
     _loadUploadPreview(el)         — init / re-render one widget tile
     _uplFilePreview(fileId)        — open file preview popup (img/video/pdf/txt/docx)
     _uplFileClosePreview()         — close file preview popup
     _uplPrevOpenPicker(widgetId)   — open the file-picker modal
     _uplPrevClosePicker()          — close the file-picker modal
     _uplPrevLoadFiles(pageId)      — browse a specific uploads page
     _uplPrevPrevPage()             — picker: go to prev file page
     _uplPrevNextPage()             — picker: go to next file page
     _uplPrevToggleFile(fileId)     — picker: toggle file selection
     _uplPrevMoveFile(fileId, dir)  — picker: shift file −1/+1 in order
     _uplPrevConfirm()              — picker: save selection to widget
*/

// ── Module state (var — consistent with project convention) ───────────────────
var _uplPrevWidgetId    = null;   // widget ID whose picker is open
var _uplPrevSelected    = [];     // ordered list of selected upload IDs (numbers)
var _uplPrevPickerPage  = 1;      // current page in the file picker
var _uplPrevPickerTotal = 0;      // total pages for current uploads-page
var _uplPrevPickerPid   = null;   // current uploads-page ID being browsed
var _uplPrevBusy        = false;  // guard against concurrent fetches
var _uplPrevPageFiles   = [];     // files currently shown in picker grid (for badge refresh)
var _uplVidHoverTimer   = null;   // timeout handle for video hover-preview auto-stop

// ── File type helpers ────────────────────────────────────────────────────────────
function _uplIsDocx(file) {
    var mime = file.mime_type || '';
    var name = (file.original_name || file.filename || '').toLowerCase();
    return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || name.endsWith('.docx');
}

var _UPL_PREVIEWABLE_EXTS = [
    'jpg','jpeg','png','gif','webp','bmp','svg',        // images
    'mp4','webm','ogg','ogv','mov','m4v',               // video
    'pdf',                                               // pdf
    'txt','md','csv','log','json','xml',                 // text
    'yaml','yml','ini','cfg','toml','rst',
    'docx'                                               // docx
];
function _uplIsPreviewable(file) {
    var mime = file.mime_type || '';
    var name = (file.original_name || file.filename || '').toLowerCase();
    var ext  = name.includes('.') ? name.split('.').pop() : '';
    return mime.startsWith('image/')
        || mime.startsWith('video/')
        || mime === 'application/pdf'
        || mime.startsWith('text/')
        || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || _UPL_PREVIEWABLE_EXTS.indexOf(ext) !== -1;
}

// Pick the right emoji for the modal header icon
function _uplPreviewHeaderIcon(type) {
    var icons = { image: '🖼️', video: '🎥', pdf: '📕', text: '📝', docx: '📄' };
    return icons[type] || '📄';
}

// ── Video hover-preview: play on mouseenter, stop + rewind on mouseleave ────────
// Called via inline onmouseenter/onmouseleave on the tile <button>.
function _uplVidHoverPlay(btn) {
    var vid = btn.querySelector('video');
    var overlay = btn.querySelector('.upl-vid-overlay');
    if (!vid) return;
    clearTimeout(_uplVidHoverTimer);
    vid.currentTime = 0;
    vid.play().catch(function() {});          // silent — autoplay may be blocked
    if (overlay) overlay.style.opacity = '0'; // hide 🎬 while playing
    _uplVidHoverTimer = setTimeout(function() {
        vid.pause();
        vid.currentTime = 0;
        if (overlay) overlay.style.opacity = '1';
    }, 3000);
}

function _uplVidHoverStop(btn) {
    var vid = btn.querySelector('video');
    var overlay = btn.querySelector('.upl-vid-overlay');
    clearTimeout(_uplVidHoverTimer);
    if (vid) { vid.pause(); vid.currentTime = 0; }
    if (overlay) overlay.style.opacity = '1';
}

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

    if (_uplIsPreviewable(file)) {
        var inner;

        // ── Video: poster frame + hover-preview + popup on click ────────────────
        if (file.mime_type && file.mime_type.startsWith('video/')) {
            return '<button type="button"'
                + ' onclick="_uplFilePreview(' + file.id + ')"'
                + ' onmouseenter="_uplVidHoverPlay(this)"'
                + ' onmouseleave="_uplVidHoverStop(this)"'
                + ' class="relative block w-full overflow-hidden rounded-lg'
                + ' bg-gray-100 dark:bg-zinc-800 aspect-square cursor-pointer"'
                + ' title="' + name + ' \u2014 hover to peek, click to watch">'
                + '<video src="' + url + '" preload="metadata" muted playsinline'
                + ' class="w-full h-full object-cover pointer-events-none"></video>'
                // overlay: shown at rest, hidden while hovering
                + '<div class="upl-vid-overlay absolute inset-0 flex flex-col items-center'
                + ' justify-center gap-1 bg-black/30 transition-opacity pointer-events-none"'
                + ' style="opacity:1">'
                + '<span class="text-3xl leading-none" aria-hidden="true">🎥</span>'
                + '<span class="text-white text-[9px] font-medium">Click to watch</span>'
                + '</div>'
                + '</button>';
        }

        // ── Image: thumbnail + hover gradient + popup on click ────────────────
        if (icon === null) {
            // Image: keep the thumbnail but add a hover overlay + popup on click
            inner = '<img src="' + url + '" alt="' + name + '" loading="lazy" decoding="async"'
                + ' class="w-full h-full object-cover pointer-events-none">'
                + '<div class="absolute inset-0 flex items-end justify-center pb-1.5'
                + ' opacity-0 hover:opacity-100 bg-gradient-to-t from-black/50 to-transparent'
                + ' transition-opacity pointer-events-none">'
                + '<span class="text-white text-[9px] font-medium">Click to enlarge</span>'
                + '</div>';
        } else {
            // Doc / PDF / text: icon + name + "Preview" label
            var displayIcon = _uplIsDocx(file) ? '📄'
                : (file.mime_type === 'application/pdf' || (file.original_name||"").toLowerCase().endsWith('.pdf')) ? '📕'
                : (icon || '📝');
            inner = '<div class="flex flex-col items-center justify-center gap-1 p-2 h-full">'
                + '<span class="text-3xl leading-none" aria-hidden="true">' + displayIcon + '</span>'
                + '<span class="text-[10px] text-center text-gray-600 dark:text-zinc-400'
                + ' leading-tight break-all">' + name + '</span>'
                + '<span class="text-[9px] text-[#0053e2] mt-0.5">Preview</span>'
                + '</div>';
        }
        return '<button type="button" onclick="_uplFilePreview(' + file.id + ')"'
            + ' class="relative block w-full overflow-hidden rounded-lg'
            + ' bg-gray-100 dark:bg-zinc-800 aspect-square'
            + ' hover:opacity-90 transition-opacity cursor-pointer"'
            + ' title="' + name + ' \u2014 click to preview">'
            + inner + '</button>';
    }

    // Non-previewable: link opens the file directly
    var inner2;
    if (file.mime_type && file.mime_type.startsWith('video/')) {
        inner2 = '<video src="' + url + '" preload="metadata" muted playsinline'
            + ' class="w-full h-full object-cover pointer-events-none"></video>'
            + '<div class="absolute inset-0 flex items-center justify-center'
            + ' bg-black/30 pointer-events-none">'
            + '<span class="text-3xl">' + icon + '</span></div>';
    } else {
        inner2 = '<div class="flex flex-col items-center justify-center gap-1 p-2 h-full">'
            + '<span class="text-3xl leading-none" aria-hidden="true">' + (icon||'📎') + '</span>'
            + '<span class="text-[10px] text-center text-gray-600 dark:text-zinc-400'
            + ' leading-tight break-all">' + name + '</span>'
            + '</div>';
    }
    return '<a href="' + url + '" target="_blank" rel="noopener noreferrer"'
        + ' class="relative block overflow-hidden rounded-lg bg-gray-100'
        + ' dark:bg-zinc-800 aspect-square hover:opacity-90 transition-opacity"'
        + ' title="' + name + '">'
        + inner2 + '</a>';
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

// ── File preview popup (widget tile click) ───────────────────────────────────
function _uplFilePreview(fileId) {
    var modal  = document.getElementById('upl-file-preview-modal');
    var titleEl = document.getElementById('upl-file-preview-title');
    var iconEl  = document.getElementById('upl-file-preview-icon');
    var body   = document.getElementById('upl-file-preview-body');
    var dlBtn  = document.getElementById('upl-file-preview-dl');
    if (!modal || !body) return;
    if (titleEl) titleEl.textContent = 'Loading…';
    body.innerHTML = '<p class="text-gray-400 animate-pulse">Loading…</p>';
    modal.classList.remove('hidden');
    modal.focus();  // capture keyboard for Escape

    fetch('/home/uploads/preview?id=' + fileId, { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) {
                body.innerHTML = '<p class="text-red-400 text-sm">Could not load preview.</p>';
                return;
            }
            var type = data.type || 'unsupported';
            if (titleEl) titleEl.textContent = data.title || 'Preview';
            if (iconEl)  iconEl.textContent  = _uplPreviewHeaderIcon(type);
            if (dlBtn)   dlBtn.href          = '/uploads/' + encodeURIComponent(data.filename || '');

            if (type === 'docx') {
                body.innerHTML = '<div class="leading-relaxed">' + data.html + '</div>';

            } else if (type === 'image') {
                body.innerHTML =
                    '<div class="flex items-center justify-center h-full py-2">'
                    + '<img src="' + _uplEsc(data.url) + '"'
                    + ' alt="' + _uplEsc(data.title || '') + '"'
                    + ' class="max-w-full max-h-[70vh] object-contain rounded shadow-md"'
                    + ' loading="lazy"></div>';

            } else if (type === 'video') {
                body.innerHTML =
                    '<div class="flex items-center justify-center py-2">'
                    + '<video src="' + _uplEsc(data.url) + '"'
                    + ' controls autoplay muted playsinline'
                    + ' class="max-w-full rounded shadow-md" style="max-height:65vh">'
                    + 'Your browser doesn\'t support the video tag.'
                    + '</video></div>';

            } else if (type === 'pdf') {
                body.innerHTML =
                    '<iframe src="' + _uplEsc(data.url) + '#toolbar=1"'
                    + ' class="w-full border-0 rounded" style="height:65vh"'
                    + ' title="' + _uplEsc(data.title || 'PDF') + '"></iframe>';

            } else if (type === 'text') {
                var escaped = (data.text || '').replace(/&/g,'&amp;')
                    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
                body.innerHTML =
                    '<pre class="text-xs font-mono whitespace-pre-wrap break-words'
                    + ' leading-relaxed text-gray-800 dark:text-zinc-200">' + escaped + '</pre>'
                    + (data.truncated
                        ? '<p class="text-xs text-amber-500 mt-3 italic">⚠️'
                          + ' Truncated at 50 000 chars — download for the full file.</p>'
                        : '');

            } else {
                body.innerHTML =
                    '<p class="text-gray-500 text-sm">'
                    + 'In-browser preview isn\'t available for this file type'
                    + (data.mime ? ' (' + _uplEsc(data.mime) + ')' : '') + '.<br>'
                    + 'Use the ↓ Download button below.</p>';
            }
        })
        .catch(function() {
            body.innerHTML = '<p class="text-red-400 text-sm">Error loading preview.</p>';
        });
}

function _uplFileClosePreview() {
    var modal = document.getElementById('upl-file-preview-modal');
    if (!modal) return;
    // Pause any playing video before hiding so audio doesn't bleed
    var vid = modal.querySelector('video');
    if (vid) { vid.pause(); }
    modal.classList.add('hidden');
}
// Backward-compat aliases (template attr references updated but kept for safety)
var _uplDocxPreview      = _uplFilePreview;
var _uplDocxClosePreview = _uplFileClosePreview;

// ── Open the file-picker modal ────────────────────────────────────────────────────
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

    // Hide the settings modal so it doesn't block click events on the picker.
    // We restore it when the picker closes (or the user confirms).
    var settingsModal = document.getElementById('ws-settings-modal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
        settingsModal.dataset.uplPrevHidden = '1';
        settingsModal.classList.add('hidden');
    }

    var modal = document.getElementById('upl-prev-picker-modal');
    if (modal) modal.classList.remove('hidden');

    _uplPrevFetchPages();
}

// ── Close the file-picker modal ─────────────────────────────────────────────────
function _uplPrevClosePicker() {
    var modal = document.getElementById('upl-prev-picker-modal');
    if (modal) modal.classList.add('hidden');

    // Restore the settings modal if we hid it when opening the picker.
    var settingsModal = document.getElementById('ws-settings-modal');
    if (settingsModal && settingsModal.dataset.uplPrevHidden) {
        settingsModal.classList.remove('hidden');
        delete settingsModal.dataset.uplPrevHidden;
    }

    _uplPrevWidgetId   = null;
    _uplPrevSelected   = [];
    _uplPrevPickerPid  = null;
    _uplPrevPickerPage = 1;
    _uplPrevPickerTotal = 0;
    _uplPrevBusy       = false;
    _uplPrevPageFiles  = [];
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

// ── Numbered badge HTML for picker grid cells ─────────────────────────────────
function _uplBadgeHtml(fileId) {
    var pos = _uplPrevSelected.indexOf(fileId);
    if (pos === -1) return '';
    return '<div class="absolute top-1 right-1 min-w-[20px] h-5 px-1.5 rounded-full'
        + ' bg-[#0053e2] flex items-center justify-center shadow pointer-events-none">'
        + '<span class="text-white text-[10px] font-bold leading-none">' + (pos + 1) + '</span>'
        + '</div>';
}

// ── Refresh all badge overlays for cells on the current picker page ────────────
function _uplPrevRefreshBadges() {
    _uplPrevPageFiles.forEach(function(f) {
        var btn = document.querySelector('[data-upl-id="' + f.id + '"]');
        if (!btn) return;
        var pos     = _uplPrevSelected.indexOf(f.id);
        var selected = pos !== -1;
        btn.classList.toggle('ring-2',         selected);
        btn.classList.toggle('ring-[#0053e2]', selected);
        var existing = btn.querySelector('.absolute.top-1');
        if (existing) existing.remove();
        if (selected) {
            var badge = document.createElement('div');
            badge.className = 'absolute top-1 right-1 min-w-[20px] h-5 px-1.5 rounded-full'
                + ' bg-[#0053e2] flex items-center justify-center shadow pointer-events-none';
            badge.innerHTML = '<span class="text-white text-[10px] font-bold leading-none">'
                + (pos + 1) + '</span>';
            btn.appendChild(badge);
        }
    });
    _uplPrevUpdateCount();
}

// ── Refresh the order strip below the file grid ───────────────────────────────
function _uplPrevRefreshOrderStrip() {
    var strip = document.getElementById('upl-prev-order-strip');
    if (!strip) return;
    if (!_uplPrevSelected.length) {
        strip.innerHTML = '<p class="text-xs text-gray-400 italic">No files selected</p>';
        return;
    }
    // Build a name-lookup from the cached page files
    var nameMap = {};
    _uplPrevPageFiles.forEach(function(f) {
        nameMap[f.id] = f.original_name || f.filename;
    });
    var html = '<div class="flex gap-1.5 flex-wrap">';
    _uplPrevSelected.forEach(function(fid, i) {
        var label = nameMap[fid] ? _uplTrunc(nameMap[fid], 18) : '#' + fid;
        html += '<div class="flex items-center gap-0.5 bg-blue-50 dark:bg-[#0053e2]/10'
            + ' border border-[#0053e2]/25 rounded-lg px-2 py-0.5 text-xs">'
            + '<span class="text-[#0053e2] font-bold mr-0.5 tabular-nums">' + (i + 1) + '</span>'
            + '<span class="text-gray-700 dark:text-zinc-300 max-w-[90px] truncate">'
            + _uplEsc(label) + '</span>';
        if (i > 0) {
            html += '<button onclick="_uplPrevMoveFile(' + fid + ',-1)" title="Move earlier"'
                + ' class="ml-1 text-gray-400 hover:text-[#0053e2] leading-none text-sm">&lsaquo;</button>';
        }
        if (i < _uplPrevSelected.length - 1) {
            html += '<button onclick="_uplPrevMoveFile(' + fid + ',1)" title="Move later"'
                + ' class="text-gray-400 hover:text-[#0053e2] leading-none text-sm">&rsaquo;</button>';
        }
        html += '<button onclick="_uplPrevToggleFile(' + fid + ')" title="Remove"'
            + ' class="ml-0.5 text-gray-300 hover:text-red-400 leading-none">&#215;</button>'
            + '</div>';
    });
    html += '</div>';
    strip.innerHTML = html;
}

// ── Shift a file earlier (−1) or later (+1) in the selection order ───────────────
function _uplPrevMoveFile(fileId, dir) {
    var idx = _uplPrevSelected.indexOf(fileId);
    if (idx === -1) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= _uplPrevSelected.length) return;
    // Swap the two entries
    var tmp = _uplPrevSelected[idx];
    _uplPrevSelected[idx]    = _uplPrevSelected[newIdx];
    _uplPrevSelected[newIdx] = tmp;
    _uplPrevRefreshBadges();
    _uplPrevRefreshOrderStrip();
}

// ── Render the 4-column thumbnail grid inside the picker ─────────────────────────
function _uplPrevRenderPickerGrid(files) {
    var box = document.getElementById('upl-prev-files');
    if (!box) return;
    _uplPrevPageFiles = files;  // cache for badge refresh without re-fetch
    if (!files.length) {
        box.innerHTML = '<p class="text-sm text-gray-400 p-4">No files on this page.</p>';
        _uplPrevRefreshOrderStrip();
        return;
    }

    var html = '<div class="grid grid-cols-4 gap-2 p-2">';
    files.forEach(function(f) {
        var icon    = _uplMimeIcon(f.mime_type || '');
        var name    = _uplEsc(_uplTrunc(f.original_name || f.filename, 20));
        var url     = '/uploads/' + _uplEsc(f.filename);
        var pos     = _uplPrevSelected.indexOf(f.id);
        var checked = pos !== -1;
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

        html += '<button type="button" onclick="_uplPrevToggleFile(' + f.id + ')"'
            + ' class="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800'
            + ' aspect-square cursor-pointer hover:opacity-80 transition-opacity'
            + ring + '" title="' + name + '" data-upl-id="' + f.id + '">'
            + thumb + _uplBadgeHtml(f.id) + '</button>';
    });
    html += '</div>';
    box.innerHTML = html;
    _uplPrevRefreshOrderStrip();
}

// ── Toggle a file in / out of the selection ───────────────────────────────────────
function _uplPrevToggleFile(fileId) {
    var idx = _uplPrevSelected.indexOf(fileId);
    if (idx === -1) {
        _uplPrevSelected.push(fileId);
    } else {
        _uplPrevSelected.splice(idx, 1);
    }
    // Refresh all badges on the current page (numbers shift when any item is removed)
    _uplPrevRefreshBadges();
    // Refresh the order strip below the grid
    _uplPrevRefreshOrderStrip();
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

// ── Confirm: merge selection into widget config and re-render tile ────────────────
async function _uplPrevConfirm() {
    if (_uplPrevWidgetId === null) return;
    var widgetId = _uplPrevWidgetId;
    var ids      = _uplPrevSelected.slice();

    _uplPrevClosePicker();  // hides picker + restores settings modal

    // Update the count badge in the settings modal so it reflects the new selection
    var countBadge = document.getElementById('upl-prev-settings-count');
    if (countBadge) countBadge.textContent = ids.length + ' file(s) pinned';

    // ── KEY FIX: keep the hidden upload_ids input in sync ────────────────────
    // The settings modal renders <input id="cf-upl-ids" value='[]'> at open time.
    // saveWidgetSettings() reads that value and would overwrite upload_ids with []
    // if we don't update it here before the user ever hits Apply.
    var hiddenInput = document.getElementById('cf-upl-ids');
    if (hiddenInput) hiddenInput.value = JSON.stringify(ids);

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
