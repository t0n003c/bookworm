/**
 * bw-table-tools.js
 * Shared table tools for contenteditable editors — a size picker (choose rows ×
 * columns when inserting) and a bottom-right resize handle (drag to add/remove
 * rows & columns, with a live size tooltip + grid overlay).
 *
 * Ported from the note-form table subsystem so the database card note editor
 * matches the main Note editor. Editor-agnostic: register editors with
 * bwTableTools.attach(ceElement); the handles self-create their own DOM in body.
 *
 * Public API (window.bwTableTools):
 *   attach(ce)                     — wire the resize handle for tables in ce
 *   openSizePicker(ce, savedRange) — modal to pick rows/cols, then insert
 *   insertTable(ce, savedRange, rows, cols, colHeader, rowHeader)
 */
(function () {
  'use strict';
  if (window.bwTableTools) return;

  var _isMobile = window.matchMedia('(pointer:coarse)').matches;
  var _editors  = [];     // registered contenteditable editors
  var _curTable = null;   // table currently showing handles
  var _curCE    = null;   // editor that owns _curTable

  /* ── shared handle DOM (built once, lives on document.body) ─────────────── */
  var rzHnd, sizeTip, rzOvl, _domReady = false;
  function _buildDom() {
    if (_domReady) return;
    _domReady = true;

    rzHnd = document.createElement('div');
    rzHnd.id = 'bw-tt-resize';
    rzHnd.title = 'Drag to resize';
    rzHnd.style.cssText = 'position:fixed;z-index:60;display:none;'
      + 'width:20px;height:20px;cursor:se-resize;user-select:none;touch-action:none;'
      + 'background:radial-gradient(circle at 100% 100%,#0053e2 0%,#0053e2 38%,transparent 40%);';

    sizeTip = document.createElement('div');
    sizeTip.id = 'bw-tt-size-tip';
    sizeTip.style.cssText = 'position:fixed;z-index:61;display:none;pointer-events:none;'
      + 'user-select:none;padding:2px 8px;border-radius:4px;font-size:12px;'
      + 'font-family:ui-monospace,monospace;font-weight:600;'
      + 'background:#27272a;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);';

    rzOvl = document.createElement('div');
    rzOvl.id = 'bw-tt-rz-overlay';
    rzOvl.style.cssText = 'position:fixed;z-index:59;display:none;pointer-events:none;'
      + 'border:2px dashed #0053e2;box-sizing:border-box;'
      + 'background-image:linear-gradient(rgba(0,83,226,.08) 1px,transparent 1px),'
      + 'linear-gradient(90deg,rgba(0,83,226,.08) 1px,transparent 1px);';

    document.body.appendChild(rzHnd);
    document.body.appendChild(sizeTip);
    document.body.appendChild(rzOvl);
    _wireResize();
  }

  /* ── helpers ────────────────────────────────────────────────────────────── */
  function _ownerCE(node) {
    for (var i = 0; i < _editors.length; i++) {
      if (_editors[i].contains(node)) return _editors[i];
    }
    return null;
  }
  function _tableUnder(node) {
    while (node && node.nodeType) {
      if (node.nodeName === 'TABLE') {
        var ce = _ownerCE(node);
        return ce ? { tbl: node, ce: ce } : null;
      }
      node = node.parentElement;
    }
    return null;
  }
  function _allRows(tbl) { return Array.prototype.slice.call((tbl || _curTable).querySelectorAll('tr')); }
  function _makeCell(tag) { var c = document.createElement(tag || 'td'); c.innerHTML = '<br>'; return c; }
  function _cellText(c) { return c.textContent.replace(/ /g, '').trim(); }
  function _dispatch() { if (_curCE) _curCE.dispatchEvent(new Event('input')); }
  function _parkCursor(cell) {
    if (!cell) return;
    var r = document.createRange(); r.setStart(cell, 0); r.collapse(true);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /** Minimum dimensions that preserve all non-empty cells. */
  function _minDims(tbl) {
    var minBodyR = 0, minC = 0;
    var tbody = tbl.querySelector('tbody') || tbl;
    Array.prototype.slice.call(tbody.querySelectorAll('tr')).forEach(function (tr, ri) {
      Array.prototype.slice.call(tr.children).forEach(function (cell, ci) {
        if (_cellText(cell)) { minBodyR = Math.max(minBodyR, ri + 1); minC = Math.max(minC, ci + 1); }
      });
    });
    var thead = tbl.querySelector('thead');
    if (thead) {
      Array.prototype.slice.call(thead.querySelectorAll('tr')).forEach(function (tr) {
        Array.prototype.slice.call(tr.children).forEach(function (cell, ci) {
          if (_cellText(cell)) minC = Math.max(minC, ci + 1);
        });
      });
    }
    return { bodyRows: minBodyR, cols: minC };
  }

  /* ── handle positioning ─────────────────────────────────────────────────── */
  function _placeHandles(tbl) {
    if (!tbl || !_curCE) return;
    _buildDom();
    var r   = tbl.getBoundingClientRect();
    var ceR = _curCE.getBoundingClientRect();

    if (_isMobile) {
      var rw = 22, rh = 22;
      rzHnd.style.width = rw + 'px'; rzHnd.style.height = rh + 'px';
      rzHnd.style.background = 'none';
      rzHnd.style.border = '2px solid #0053e2';
      rzHnd.style.borderRadius = '4px';
      rzHnd.style.opacity = '0.85';
      rzHnd.innerHTML =
        '<svg viewBox="0 0 10 10" width="10" height="10"'
        + ' style="position:absolute;bottom:2px;right:2px;display:block">'
        + '<circle cx="8" cy="8" r="1.4" fill="#0053e2"/>'
        + '<circle cx="5" cy="8" r="1.4" fill="#0053e2"/>'
        + '<circle cx="8" cy="5" r="1.4" fill="#0053e2"/></svg>';
      var lastRow  = tbl.querySelector('tr:last-child');
      var lastCell = lastRow ? lastRow.querySelector('td:last-child,th:last-child') : null;
      if (lastCell) {
        var cr = lastCell.getBoundingClientRect();
        rzHnd.style.left = (cr.right - rw - 3) + 'px';
        rzHnd.style.top  = (cr.bottom - rh - 3) + 'px';
      } else {
        rzHnd.style.left = (Math.min(r.right, window.innerWidth - rw - 4) - rw) + 'px';
        rzHnd.style.top  = (Math.min(r.bottom, window.innerHeight - rh - 4) - rh) + 'px';
      }
    } else {
      var dw = 20, dh = 20;
      rzHnd.style.width = dw + 'px'; rzHnd.style.height = dh + 'px';
      rzHnd.style.background = 'radial-gradient(circle at 100% 100%,#0053e2 0%,#0053e2 38%,transparent 40%)';
      rzHnd.style.border = 'none'; rzHnd.style.borderRadius = '0';
      rzHnd.style.opacity = ''; rzHnd.innerHTML = '';
      var vw = window.innerWidth, vh = window.innerHeight;
      var rx = Math.max(ceR.left + dw, Math.min(r.right,  ceR.right,  vw - 4));
      var ry = Math.max(ceR.top  + dh, Math.min(r.bottom, ceR.bottom, vh - 4));
      rzHnd.style.left = (rx - dw / 2) + 'px';
      rzHnd.style.top  = (ry - dh / 2) + 'px';
    }
    rzHnd.style.display = 'block';
  }

  function _hideHandles() {
    if (rzHnd) rzHnd.style.display = 'none';
    _curTable = null;
    _curCE = null;
  }

  /* ── auto-remove a table once it's empty and the cursor has left it ─────── */
  var _lastTable = null, _lastCE = null;
  function _tableIsEmpty(tbl) {
    var cells = tbl.querySelectorAll('td,th');
    if (!cells.length) return true;
    return Array.prototype.every.call(cells, function (c) { return !_cellText(c); });
  }
  function _purgeIfEmpty(tbl, ce) {
    if (!tbl || !ce || !ce.contains(tbl) || !_tableIsEmpty(tbl)) return;
    if (tbl === _curTable) _hideHandles();
    var wrap = tbl.parentElement;
    var anchor = (wrap && wrap.classList.contains('bw-tbl-scroll')) ? wrap : tbl;
    anchor.remove();
    ce.dispatchEvent(new Event('input'));
  }

  /* ── track which table is "current" (cursor or hover) ───────────────────── */
  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;            // keep current handles if just losing selection
    var anchor = sel.getRangeAt(0).commonAncestorContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentElement;
    var found  = _tableUnder(anchor);
    var newTbl = found ? found.tbl : null;
    // Cursor moved out of a table → drop it if it has no content.
    if (_lastTable && _lastTable !== newTbl && !_rzActive) {
      _purgeIfEmpty(_lastTable, _lastCE);
    }
    _lastTable = newTbl;
    _lastCE    = found ? found.ce : null;
    if (!found) { if (!_rzActive) _hideHandles(); return; }
    _curTable = found.tbl; _curCE = found.ce;
    _placeHandles(_curTable);
  });
  document.addEventListener('mouseover', function (e) {
    if (_rzActive || !_editors.length) return;
    var found = _tableUnder(e.target);
    if (found) { _curTable = found.tbl; _curCE = found.ce; _placeHandles(_curTable); }
  });
  window.addEventListener('scroll', function () { if (_curTable) _placeHandles(_curTable); }, true);
  window.addEventListener('resize', function () { if (_curTable) _placeHandles(_curTable); });

  /* ── resize handle drag (mouse + touch) ─────────────────────────────────── */
  var _rzActive = false, _rzStartX = 0, _rzStartY = 0;
  var _rzBodyRows0 = 0, _rzCols0 = 0;
  var _rzCellW = 80, _rzCellH = 32;
  var _rzTgtCols, _rzTgtBodyRows;

  function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function _rzBegin(cx, cy) {
    if (!_curTable) return;
    _rzActive = true; _rzStartX = cx; _rzStartY = cy;
    var tbody = _curTable.querySelector('tbody') || _curTable;
    _rzBodyRows0 = _allRows(tbody).length;
    var firstRow = _curTable.querySelector('tr');
    _rzCols0 = firstRow ? firstRow.children.length : 1;
    var r = _curTable.getBoundingClientRect();
    var totalRows = _allRows(_curTable).length;
    if (_rzCols0)  _rzCellW = Math.max(30, r.width / _rzCols0);
    if (totalRows) _rzCellH = Math.max(18, r.height / totalRows);
    if (_isMobile) _rzCellW = Math.max(18, _rzCellW * 0.45);
  }

  function _rzTrack(cx, cy) {
    if (!_rzActive || !_curTable) return;
    var min = _minDims(_curTable);
    var tgtCols = _clamp(Math.round(_rzCols0 + (cx - _rzStartX) / _rzCellW), Math.max(1, min.cols), 20);
    var tgtBodyRows = _clamp(Math.round(_rzBodyRows0 + (cy - _rzStartY) / _rzCellH), Math.max(1, min.bodyRows), 50);
    _rzTgtCols = tgtCols; _rzTgtBodyRows = tgtBodyRows;

    var theadRows = _curTable.querySelector('thead') ? 1 : 0;
    var totalRows = tgtBodyRows + theadRows;
    sizeTip.textContent = totalRows + ' × ' + tgtCols + ' (rows × cols)';
    sizeTip.style.display = 'block';
    var tipX, tipY;
    if (_isMobile) {
      tipX = Math.max(4, Math.min(cx - 60, window.innerWidth - 164));
      tipY = Math.max(4, cy - 44);
    } else {
      tipX = Math.min(cx + 16, window.innerWidth - 160);
      tipY = Math.min(cy + 16, window.innerHeight - 36);
    }
    sizeTip.style.left = tipX + 'px'; sizeTip.style.top = tipY + 'px';

    var r   = _curTable.getBoundingClientRect();
    var ceR = _curCE.getBoundingClientRect();
    var projW = Math.min(tgtCols * _rzCellW, ceR.right - r.left);
    var projH = totalRows * _rzCellH;
    rzOvl.style.left = r.left + 'px'; rzOvl.style.top = r.top + 'px';
    rzOvl.style.width = Math.max(20, projW) + 'px';
    rzOvl.style.height = Math.max(18, projH) + 'px';
    rzOvl.style.backgroundSize = 'calc(100% / ' + tgtCols + ') calc(100% / ' + totalRows + ')';
    rzOvl.style.display = 'block';
  }

  function _applyResize(tbl, tgtBodyRows, tgtCols) {
    // Columns — apply to ALL rows (incl. thead), preserving th vs td.
    _allRows(tbl).forEach(function (tr) {
      var cur = tr.children.length;
      var existingTag = tr.lastElementChild ? tr.lastElementChild.nodeName : 'TD';
      for (var i = cur; i < tgtCols; i++) tr.appendChild(_makeCell(existingTag));
      for (var j = tr.children.length - 1; j >= tgtCols; j--) tr.children[j].remove();
    });
    // Rows — add/remove only in tbody.
    var tbody = tbl.querySelector('tbody') || tbl;
    var bodyRows = _allRows(tbody);
    for (var r = bodyRows.length; r < tgtBodyRows; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < tgtCols; c++) tr.appendChild(_makeCell('td'));
      tbody.appendChild(tr);
    }
    var updated = _allRows(tbody);
    for (var ri = updated.length - 1; ri >= tgtBodyRows; ri--) updated[ri].remove();
  }

  function _rzCommit() {
    sizeTip.style.display = 'none';
    rzOvl.style.display = 'none';
    if (!_rzActive) return;
    _rzActive = false;
    if (!_curTable) return;
    _applyResize(
      _curTable,
      _rzTgtBodyRows !== undefined ? _rzTgtBodyRows : _rzBodyRows0,
      _rzTgtCols !== undefined ? _rzTgtCols : _rzCols0
    );
    _rzTgtCols = _rzTgtBodyRows = undefined;
    _placeHandles(_curTable);
    _dispatch();
  }

  function _onRzMove(e) { _rzTrack(e.clientX, e.clientY); }
  function _onRzUp() {
    document.removeEventListener('mousemove', _onRzMove);
    document.removeEventListener('mouseup', _onRzUp);
    _rzCommit();
  }
  function _onRzTouchMove(e) {
    if (e.touches.length) { e.preventDefault(); _rzTrack(e.touches[0].clientX, e.touches[0].clientY); }
  }
  function _onRzTouchEnd() {
    document.removeEventListener('touchmove', _onRzTouchMove);
    document.removeEventListener('touchend', _onRzTouchEnd);
    document.removeEventListener('touchcancel', _onRzTouchEnd);
    _rzCommit();
  }

  function _wireResize() {
    rzHnd.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !_curTable) return;
      e.preventDefault(); e.stopPropagation();
      _rzBegin(e.clientX, e.clientY);
      document.addEventListener('mousemove', _onRzMove);
      document.addEventListener('mouseup', _onRzUp);
    });
    rzHnd.addEventListener('touchstart', function (e) {
      if (!_curTable || !e.touches.length) return;
      e.preventDefault(); e.stopPropagation();
      _rzBegin(e.touches[0].clientX, e.touches[0].clientY);
      document.addEventListener('touchmove', _onRzTouchMove, { passive: false });
      document.addEventListener('touchend', _onRzTouchEnd);
      document.addEventListener('touchcancel', _onRzTouchEnd);
    }, { passive: false });
  }

  /* ── table insertion ────────────────────────────────────────────────────── */
  function insertTable(ce, savedRange, rows, cols, colHeader, rowHeader) {
    rows = Math.max(1, rows | 0); cols = Math.max(1, cols | 0);
    var table = document.createElement('table');
    var tbody = document.createElement('tbody');
    var firstDataCell = null;

    if (colHeader) {
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      for (var c = 0; c < cols; c++) {
        var th = document.createElement('th');
        th.innerHTML = (rowHeader && c === 0) ? '' : ('Col ' + (c + (rowHeader ? 0 : 1)));
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);
    }
    for (var r = 0; r < rows; r++) {
      var tr = document.createElement('tr');
      for (var cc = 0; cc < cols; cc++) {
        var isRowHdr = rowHeader && cc === 0;
        var cell = document.createElement(isRowHdr ? 'th' : 'td');
        cell.innerHTML = isRowHdr ? ('<strong>Row ' + (r + 1) + '</strong>') : '<br>';
        if (!firstDataCell && !isRowHdr) firstDataCell = cell;
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    if (!firstDataCell) firstDataCell = tbody.querySelector('td') || tbody.querySelector('th');

    var after = document.createElement('p');
    after.innerHTML = '<br>';
    var wrap = document.createElement('div');
    wrap.className = 'bw-tbl-scroll';
    wrap.appendChild(table);

    // Restore the saved cursor, then locate the enclosing block.
    if (savedRange) {
      try {
        var sel0 = window.getSelection();
        sel0.removeAllRanges(); sel0.addRange(savedRange);
      } catch (e) {}
    }
    var sel = window.getSelection();
    var anchor = (sel && sel.rangeCount) ? sel.getRangeAt(0).commonAncestorContainer : null;
    if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentElement;
    var block = anchor;
    while (block && block.parentElement !== ce) block = block.parentElement;

    if (block && ce.contains(block)) {
      block.after(wrap, after);
      if (!block.textContent.trim()) block.remove();
    } else {
      ce.appendChild(wrap); ce.appendChild(after);
    }

    if (firstDataCell) _parkCursor(firstDataCell);
    ce.focus();
    ce.dispatchEvent(new Event('input'));
  }

  /* ── size picker modal ──────────────────────────────────────────────────── */
  function openSizePicker(ce, savedRange) {
    var existing = document.getElementById('bw-tt-picker');
    if (existing) existing.remove();
    var dark = document.documentElement.classList.contains('dark');
    var bg  = dark ? '#18181b' : '#ffffff';
    var bdr = dark ? '#3f3f46' : '#e5e7eb';
    var txt = dark ? '#e4e4e7' : '#27272a';
    var sub = dark ? '#a1a1aa' : '#6b7280';

    var overlay = document.createElement('div');
    overlay.id = 'bw-tt-picker';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Insert table');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;'
      + 'align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';

    var card = document.createElement('div');
    card.style.cssText = 'background:' + bg + ';border:1px solid ' + bdr + ';'
      + 'border-radius:14px;padding:20px;width:min(22rem,92vw);'
      + 'box-shadow:0 20px 60px rgba(0,0,0,0.28);color:' + txt + ';'
      + 'font-family:inherit;box-sizing:border-box;';
    card.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    function field(id, label, val, min, max) {
      return '<div style="flex:1;">'
        + '<label for="' + id + '" style="display:block;font-size:12px;font-weight:600;'
        + 'color:' + sub + ';margin-bottom:4px;">' + label + '</label>'
        + '<input id="' + id + '" type="number" min="' + min + '" max="' + max + '" value="' + val + '"'
        + ' style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;'
        + 'border:1px solid ' + bdr + ';background:' + (dark ? '#27272a' : '#fff') + ';color:' + txt + ';'
        + 'font-size:14px;outline:none;"></div>';
    }
    function check(id, label, checked) {
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;color:' + txt + ';">'
        + '<input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + ' style="width:15px;height:15px;cursor:pointer;">'
        + label + '</label>';
    }

    card.innerHTML =
      '<h3 style="font-weight:700;font-size:15px;margin:0 0 14px;">Insert Table</h3>'
      + '<div style="display:flex;gap:12px;margin-bottom:14px;">'
      + field('bw-tt-rows', 'Rows (data)', 3, 1, 50)
      + field('bw-tt-cols', 'Columns', 3, 1, 20)
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">'
      + check('bw-tt-col-header', 'Header row', true)
      + check('bw-tt-row-header', 'Header column', false)
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
      + '<button type="button" id="bw-tt-cancel" style="padding:7px 14px;border-radius:8px;'
      + 'border:1px solid ' + bdr + ';background:transparent;color:' + txt + ';font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'
      + '<button type="button" id="bw-tt-insert" style="padding:7px 16px;border-radius:8px;border:none;'
      + 'background:#0053e2;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Insert</button>'
      + '</div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    function doInsert() {
      var rows = parseInt(document.getElementById('bw-tt-rows').value, 10) || 3;
      var cols = parseInt(document.getElementById('bw-tt-cols').value, 10) || 3;
      var colH = document.getElementById('bw-tt-col-header').checked;
      var rowH = document.getElementById('bw-tt-row-header').checked;
      close();
      insertTable(ce, savedRange, rows, cols, colH, rowH);
    }
    overlay.addEventListener('mousedown', close);
    card.querySelector('#bw-tt-cancel').addEventListener('click', close);
    card.querySelector('#bw-tt-insert').addEventListener('click', doInsert);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doInsert(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    var rowsInp = card.querySelector('#bw-tt-rows');
    if (rowsInp) setTimeout(function () { rowsInp.focus(); rowsInp.select(); }, 30);
  }

  /* ── public API ─────────────────────────────────────────────────────────── */
  function attach(ce) {
    _buildDom();
    if (!ce) return;
    // Panels rebuild their note element on each open, so prune editors that are
    // no longer in the document and dedupe before registering this one.
    _editors = _editors.filter(function (e) { return e === ce || document.body.contains(e); });
    if (_editors.indexOf(ce) === -1) _editors.push(ce);
  }

  window.bwTableTools = {
    attach: attach,
    openSizePicker: openSizePicker,
    insertTable: insertTable,
  };
})();
