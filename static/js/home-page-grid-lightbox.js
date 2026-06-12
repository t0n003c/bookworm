/* ── Grid Lightbox ─────────────────────────────────────────────────────────────
   Full-screen media viewer for the Grid homespace page.
   Depends on: home-page-grid.js (_gridCells, _gridPid, _gridEsc)

   Public API (called from home-page-grid.js):
     gridLightboxOpen(cellId)   — open at the cell matching cellId
     gridLightboxClose()        — close
   ────────────────────────────────────────────────────────────────────────── */

var _lbIdx      = -1;    // current index inside _gridCells
var _lbOpen     = false;

/* ── Open / close ────────────────────────────────────────────────────────── */

function gridLightboxOpen(cellId) {
    var cells = _gridCells.filter(function(c) {
        return c.cell_type === 'image' || c.cell_type === 'video';
    });
    var idx = cells.findIndex(function(c) { return c.id === cellId; });
    if (idx < 0) return;

    // Store the filtered media list on the lightbox element for nav
    var lb = document.getElementById('grid-lightbox');
    if (!lb) return;
    lb._cells = cells;
    _lbIdx    = idx;
    _lbOpen   = true;

    lb.classList.remove('hidden');
    document.addEventListener('keydown', _lbKeyDown);
    _lbRender();
}

function gridLightboxClose() {
    var lb = document.getElementById('grid-lightbox');
    if (!lb) return;
    _lbStopVideo(lb);
    lb.classList.add('hidden');
    lb._cells = null;
    _lbIdx    = -1;
    _lbOpen   = false;
    document.removeEventListener('keydown', _lbKeyDown);
}

/* ── Navigation ──────────────────────────────────────────────────────────── */

function gridLightboxNav(dir) {          // dir: -1 = prev, +1 = next
    var lb = document.getElementById('grid-lightbox');
    if (!lb || !lb._cells) return;
    _lbIdx = (_lbIdx + dir + lb._cells.length) % lb._cells.length;
    _lbRender();
}

function _lbKeyDown(e) {
    if (e.key === 'Escape')     { gridLightboxClose();  return; }
    if (e.key === 'ArrowRight') { gridLightboxNav(1);   return; }
    if (e.key === 'ArrowLeft')  { gridLightboxNav(-1);  return; }
}

/* ── Render current cell ─────────────────────────────────────────────────── */

function _lbRender() {
    var lb = document.getElementById('grid-lightbox');
    if (!lb || !lb._cells) return;
    var cell = lb._cells[_lbIdx];
    if (!cell) return;

    _lbStopVideo(lb);

    var mediaEl = document.getElementById('lb-media');
    var captEl  = document.getElementById('lb-caption');
    var counterEl = document.getElementById('lb-counter');

    // Media
    if (cell.cell_type === 'video') {
        mediaEl.innerHTML = '<video src="' + _gridEsc(cell.file_url) + '"'
            + ' class="max-h-[80vh] max-w-full rounded-lg shadow-2xl"'
            + ' controls autoplay muted playsinline></video>';
    } else {
        mediaEl.innerHTML = '<img src="' + _gridEsc(cell.file_url) + '"'
            + ' class="max-h-[80vh] max-w-full rounded-lg shadow-2xl object-contain"'
            + ' alt="' + _gridEsc(cell.caption || '') + '">';
    }

    // Caption
    captEl.textContent  = cell.caption || '';
    captEl.classList.toggle('hidden', !cell.caption);

    // Counter  e.g. "3 / 12"
    counterEl.textContent = (_lbIdx + 1) + ' / ' + lb._cells.length;

    // ── Action buttons (download, edit, remove) — shown in place of per-cell hover controls on mobile
    var actEl = document.getElementById('lb-actions');
    if (actEl) {
        var dlHref = cell.file_url ? _gridEsc(cell.file_url) : '';
        var fname  = cell.original_name ? _gridEsc(cell.original_name) : '';
        var _BTN_LB = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium'
            + ' bg-white/10 hover:bg-white/20 text-white transition-colors focus:outline-none'
            + ' focus-visible:ring-2 focus-visible:ring-white';
        actEl.innerHTML =
            (dlHref
                ? '<a href="' + dlHref + '" download="' + fname + '" onclick="event.stopPropagation()"'
                  + ' class="' + _BTN_LB + '" aria-label="Download">'
                  + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
                  + '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0-3.5-3.5M12 16l3.5-3.5M4 20h16"/></svg>'
                  + 'Download</a>'
                : '')
            + '<button onclick="_lbEditCaption()" class="' + _BTN_LB + '" aria-label="Edit caption">'
            + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
            + '<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232 18.768 8.768M9 15l-4 1 1-4L15.232 5.232a2.121 2.121 0 0 1 3 3L9 15Z"/></svg>'
            + 'Edit</button>'
            + '<button onclick="_lbRemove()" class="' + _BTN_LB + ' text-red-300 hover:text-red-200" aria-label="Remove from grid">'
            + '<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">'
            + '<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
            + 'Remove</button>';
    }

    // Prev / Next button visibility
    document.getElementById('lb-prev').classList.toggle('invisible', lb._cells.length < 2);
    document.getElementById('lb-next').classList.toggle('invisible', lb._cells.length < 2);
}

function _lbStopVideo(lb) {
    var vid = lb.querySelector('video');
    if (vid) { vid.pause(); vid.src = ''; }
}

/* ── Lightbox-triggered cell actions ─────────────────────────────────────── */
// These let mobile users perform per-cell actions from the detail view
// since per-cell hover controls are hidden on touch devices.

function _lbCurrentCellId() {
    var lb = document.getElementById('grid-lightbox');
    if (!lb || !lb._cells) return null;
    var cell = lb._cells[_lbIdx];
    return cell ? cell.id : null;
}

function _lbEditCaption() {
    var id = _lbCurrentCellId();
    if (!id) return;
    gridLightboxClose();
    gridOpenCellEdit(id);
}

function _lbRemove() {
    var id = _lbCurrentCellId();
    if (!id) return;
    gridLightboxClose();
    gridDeleteCell(id);
}
