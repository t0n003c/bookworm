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

    // Prev / Next button visibility
    document.getElementById('lb-prev').classList.toggle('invisible', lb._cells.length < 2);
    document.getElementById('lb-next').classList.toggle('invisible', lb._cells.length < 2);
}

function _lbStopVideo(lb) {
    var vid = lb.querySelector('video');
    if (vid) { vid.pause(); vid.src = ''; }
}
