(function () {
  'use strict';

  var _items = null;
  var _loadPromise = null;
  var _manifestUrl = '/thiings/manifest';
  var _gridSeq = 0;
  var _lastImportStatus = '';

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function _slugFromValue(value) {
    var m = String(value || '').trim().match(/^thiing:([a-z0-9][a-z0-9-]{0,90})$/);
    return m ? m[1] : '';
  }

  function _withVersion(src) {
    var v = String(window.BW_STATIC_V || '').trim();
    if (!v || src.indexOf('?') !== -1) return src;
    return src + '?v=' + encodeURIComponent(v);
  }

  function _normalise(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (it) {
      var slug = String(it.slug || it.id || '').trim().toLowerCase();
      slug = slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return null;
      var src = String(it.src || ('/thiings/icons/' + slug + '.png')).trim();
      if (!src.startsWith('/thiings/icons/') && !src.startsWith('/static/img/thiings/')) return null;
      var name = String(it.name || slug.replace(/-/g, ' ')).trim();
      var tags = Array.isArray(it.tags) ? it.tags.join(' ') : String(it.tags || '');
      return {
        slug: slug,
        name: name,
        src: _withVersion(src),
        terms: (slug + ' ' + name + ' ' + tags).toLowerCase(),
      };
    }).filter(Boolean);
  }

  function load() {
    if (_items) return Promise.resolve(_items);
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch(_manifestUrl, { credentials: 'same-origin', cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        _items = _normalise(data);
        return _items;
      })
      .catch(function () {
        _items = [];
        return _items;
      });
    return _loadPromise;
  }

  function search(q, limit) {
    var needle = String(q || '').trim().toLowerCase();
    var max = limit || 80;
    return load().then(function (items) {
      var out = needle ? items.filter(function (it) { return it.terms.indexOf(needle) !== -1; }) : items;
      return out.slice(0, max);
    });
  }

  function isThiing(value) {
    return !!_slugFromValue(value);
  }

  function srcFor(value) {
    var slug = _slugFromValue(value);
    return slug ? _withVersion('/thiings/icons/' + slug + '.png') : '';
  }

  function html(value, className) {
    var slug = _slugFromValue(value);
    if (!slug) return _esc(value || '');
    var cls = 'bw-icon-img' + (className ? ' ' + className : '');
    return '<img src="' + _esc(srcFor(value)) + '" alt="' + _esc(slug.replace(/-/g, ' ')) + '"' +
      ' class="' + _esc(cls) + '" loading="lazy" decoding="async">';
  }

  function setButton(el, value) {
    if (!el) return;
    if (isThiing(value)) {
      el.innerHTML = html(value, 'bw-icon-img-btn');
    } else {
      el.textContent = value || '';
    }
  }

  function _uploadHtml(id) {
    return '<div class="col-span-full rounded-lg border border-dashed border-gray-200 dark:border-zinc-700 p-2 mb-1">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<span class="text-[11px] text-gray-500 dark:text-zinc-400">Add licensed Thiings icons</span>' +
        '<div class="flex items-center gap-2">' +
          '<button type="button" data-thi-bulk-toggle="' + id + '" class="text-xs font-semibold text-[#0053e2] hover:underline">ZIP import options</button>' +
          '<button type="button" data-thi-upload-toggle="' + id + '" class="text-xs font-semibold text-[#0053e2] hover:underline">Add one</button>' +
        '</div>' +
      '</div>' +
      '<form data-thi-bulk-form="' + id + '" class="hidden mt-2 flex flex-col gap-2">' +
        '<p class="rounded bg-blue-50 dark:bg-blue-900/20 px-2 py-1 text-[11px] text-blue-700 dark:text-blue-300">' +
          'Two separate options: upload a ZIP from this browser, or import a ZIP that is already copied onto the NAS/server.' +
        '</p>' +
        '<div class="rounded border border-gray-100 dark:border-zinc-800 p-2 space-y-2">' +
          '<p class="text-[11px] font-semibold text-gray-600 dark:text-zinc-300">Option A - upload ZIP from this browser</p>' +
        '<input name="file" type="file" accept=".zip,application/zip,application/x-zip-compressed" required ' +
          'class="w-full text-xs text-gray-500 dark:text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-[#0053e2] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<span data-thi-bulk-msg="' + id + '" class="text-[11px] text-gray-400 dark:text-zinc-500">Imports images and JSON metadata when present.</span>' +
          '<button type="submit" class="rounded bg-[#0053e2] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0048c8]">Upload and Import</button>' +
        '</div>' +
        '</div>' +
        '<div class="rounded border border-gray-100 dark:border-zinc-800 p-2">' +
          '<div class="flex items-center justify-between gap-2">' +
            '<span class="text-[11px] font-semibold text-gray-600 dark:text-zinc-300">Option B - import ZIP already on NAS/server</span>' +
            '<button type="button" data-thi-server-refresh="' + id + '" class="text-xs font-semibold text-[#0053e2] hover:underline">Refresh</button>' +
          '</div>' +
          '<div class="mt-2 flex flex-wrap items-center gap-2">' +
            '<select data-thi-server-select="' + id + '" class="min-w-0 flex-1 rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-gray-800 dark:text-zinc-100">' +
              '<option value="">Loading ZIPs...</option>' +
            '</select>' +
            '<button type="button" data-thi-server-import="' + id + '" class="rounded bg-[#0053e2] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0048c8]">Import Selected</button>' +
          '</div>' +
          '<p data-thi-server-msg="' + id + '" class="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">First copy the ZIP into the NAS container folder, then click Refresh.</p>' +
        '</div>' +
        '<p data-thi-last-status="' + id + '" class="hidden rounded bg-green-50 dark:bg-green-900/20 px-2 py-1 text-[11px] text-green-700 dark:text-green-300"></p>' +
      '</form>' +
      '<form data-thi-upload-form="' + id + '" class="hidden mt-2 flex flex-col gap-2">' +
        '<input name="name" type="text" placeholder="Icon name" maxlength="120" required ' +
          'class="w-full rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-gray-800 dark:text-zinc-100">' +
        '<input name="tags" type="text" placeholder="Tags, optional" maxlength="160" ' +
          'class="w-full rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-gray-800 dark:text-zinc-100">' +
        '<input name="file" type="file" accept="image/png,image/webp,image/jpeg,image/gif" required ' +
          'class="w-full text-xs text-gray-500 dark:text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-[#0053e2] file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white">' +
        '<div class="flex items-center justify-between gap-2">' +
          '<span data-thi-upload-msg="' + id + '" class="text-[11px] text-gray-400 dark:text-zinc-500"></span>' +
          '<button type="submit" class="rounded bg-[#0053e2] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0048c8]">Upload</button>' +
        '</div>' +
      '</form>' +
    '</div>';
  }

  function _wireUpload(el, id, query, onPick, opts) {
    var toggle = el.querySelector('[data-thi-upload-toggle="' + id + '"]');
    var bulkToggle = el.querySelector('[data-thi-bulk-toggle="' + id + '"]');
    var form = el.querySelector('[data-thi-upload-form="' + id + '"]');
    var bulkForm = el.querySelector('[data-thi-bulk-form="' + id + '"]');
    var msg = el.querySelector('[data-thi-upload-msg="' + id + '"]');
    var bulkMsg = el.querySelector('[data-thi-bulk-msg="' + id + '"]');
    var serverRefresh = el.querySelector('[data-thi-server-refresh="' + id + '"]');
    var serverSelect = el.querySelector('[data-thi-server-select="' + id + '"]');
    var serverImport = el.querySelector('[data-thi-server-import="' + id + '"]');
    var serverMsg = el.querySelector('[data-thi-server-msg="' + id + '"]');
    var lastStatus = el.querySelector('[data-thi-last-status="' + id + '"]');
    if (lastStatus && _lastImportStatus) {
      lastStatus.textContent = _lastImportStatus;
      lastStatus.classList.remove('hidden');
    }
    function fmtBytes(n) {
      n = Number(n || 0);
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
      return Math.round((n / (1024 * 1024)) * 10) / 10 + ' MB';
    }
    function loadServerZips() {
      if (!serverSelect) return;
      if (serverMsg) serverMsg.textContent = 'Checking server import folder...';
      fetch('/thiings/server-zips', { credentials: 'same-origin', cache: 'no-cache' })
        .then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, body: j }; });
        })
        .then(function (res) {
          var zips = (res.body && res.body.zips) || [];
          if (!res.ok || !res.body || !res.body.ok) {
            serverSelect.innerHTML = '<option value="">Could not load ZIPs</option>';
            if (serverMsg) serverMsg.textContent = (res.body && res.body.error) || 'Could not load server ZIPs.';
            return;
          }
          if (!zips.length) {
            serverSelect.innerHTML = '<option value="">No ZIPs found</option>';
            if (serverMsg) serverMsg.textContent = 'No ZIPs found. Copy the ZIP to: ' + (res.body.dir || '/data/thiings/imports');
            return;
          }
          serverSelect.innerHTML = zips.map(function (z) {
            return '<option value="' + _esc(z.name) + '">' + _esc(z.name) + ' (' + fmtBytes(z.size) + ')' +
              (z.readable === false ? ' - not readable' : '') + '</option>';
          }).join('');
          if (serverMsg) serverMsg.textContent = 'Found ' + zips.length + ' ZIP file(s).';
        })
        .catch(function () {
          serverSelect.innerHTML = '<option value="">Could not load ZIPs</option>';
          if (serverMsg) serverMsg.textContent = 'Could not load server ZIPs.';
        });
    }
    if (toggle && form) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        form.classList.toggle('hidden');
        if (bulkForm) bulkForm.classList.add('hidden');
      });
    }
    if (bulkToggle && bulkForm) {
      bulkToggle.addEventListener('click', function (e) {
        e.preventDefault();
        bulkForm.classList.toggle('hidden');
        if (form) form.classList.add('hidden');
        if (!bulkForm.classList.contains('hidden')) loadServerZips();
      });
    }
    if (serverRefresh) {
      serverRefresh.addEventListener('click', function (e) {
        e.preventDefault();
        loadServerZips();
      });
    }
    if (serverImport && serverSelect) {
      serverImport.addEventListener('click', function (e) {
        e.preventDefault();
        var name = serverSelect.value || '';
        if (!name) {
          if (serverMsg) serverMsg.textContent = 'Choose a ZIP from the server folder first.';
          return;
        }
        if (serverMsg) serverMsg.textContent = 'Importing ' + name + '...';
        serverImport.disabled = true;
        fetch('/thiings/server-import', {
          method: 'POST',
          body: new URLSearchParams({ filename: name }),
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          }
        }).then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
        }).then(function (res) {
          serverImport.disabled = false;
          if (!res.ok || !res.body || !res.body.ok) {
            if (serverMsg) serverMsg.textContent = (res.body && res.body.error) || ('Import failed. HTTP ' + res.status + '.');
            return;
          }
          _items = null;
          _loadPromise = null;
          _lastImportStatus = 'Imported ' + res.body.imported + ' icons from ' + name +
            (res.body.skipped ? ' - skipped ' + res.body.skipped : '') + '.';
          if (serverMsg) serverMsg.textContent = _lastImportStatus;
          setTimeout(function () { renderGrid(el, query, onPick, opts); }, 900);
        }).catch(function () {
          serverImport.disabled = false;
          if (serverMsg) serverMsg.textContent = 'Import failed.';
        });
      });
    }
    if (bulkForm) {
      bulkForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (bulkMsg) bulkMsg.textContent = 'Preparing ZIP...';
        var fd = new FormData(bulkForm);
        var fileInput = bulkForm.querySelector('input[type="file"]');
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (file && file.size > 500 * 1024 * 1024) {
          if (bulkMsg) bulkMsg.textContent = 'ZIP must be 500 MB or smaller.';
          return;
        }
        if (file && file.size > 95 * 1024 * 1024 && bulkMsg) {
          bulkMsg.textContent = 'Large ZIP selected. Uploading may fail behind a 100 MB proxy limit...';
        }
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/thiings/bulk-upload', true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.upload.onprogress = function (ev) {
          if (!bulkMsg || !ev.lengthComputable) return;
          var pct = Math.max(0, Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
          bulkMsg.textContent = 'Uploading ZIP... ' + pct + '%';
        };
        xhr.onload = function () {
          var body = null;
          try {
            body = JSON.parse(xhr.responseText || '{}');
          } catch (err) {
            body = null;
          }
          if (xhr.status === 413) {
            if (bulkMsg) bulkMsg.textContent = 'ZIP is too large for the server/proxy upload limit.';
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300 || !body || !body.ok) {
            if (bulkMsg) bulkMsg.textContent = (body && body.error) || ('Import failed. HTTP ' + xhr.status + '.');
            return;
          }
          _items = null;
          _loadPromise = null;
          _lastImportStatus = 'Imported ' + body.imported + ' icons from browser upload' +
            (body.skipped ? ' · skipped ' + body.skipped : '') + '.';
          if (bulkMsg) bulkMsg.textContent = _lastImportStatus;
          setTimeout(function () { renderGrid(el, query, onPick, opts); }, 900);
        };
        xhr.onerror = function () {
          if (bulkMsg) bulkMsg.textContent = 'Import failed.';
        };
        xhr.ontimeout = function () {
          if (bulkMsg) bulkMsg.textContent = 'Import timed out. Try a smaller ZIP or import on the local network.';
        };
        xhr.timeout = 20 * 60 * 1000;
        xhr.send(fd);
      });
    }
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (msg) msg.textContent = 'Uploading...';
      var fd = new FormData(form);
      fetch('/thiings/upload', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      }).then(function (res) {
        if (!res.ok || !res.body || !res.body.item) {
          if (msg) msg.textContent = (res.body && res.body.error) || 'Upload failed.';
          return;
        }
        _items = null;
        _loadPromise = null;
        if (typeof onPick === 'function') onPick('thiing:' + res.body.item.slug);
        renderGrid(el, query, onPick, opts);
      }).catch(function () {
        if (msg) msg.textContent = 'Upload failed.';
      });
    });
  }

  function renderGrid(el, query, onPick, opts) {
    if (!el) return Promise.resolve([]);
    var id = 'thi-' + (++_gridSeq);
    var emptyText = (opts && opts.emptyText) || 'No Thiings icons yet. Use Add to upload a licensed icon.';
    el.innerHTML = _uploadHtml(id) + '<p class="col-span-full text-xs text-center text-gray-400 dark:text-zinc-500 py-3">Loading Thiings...</p>';
    _wireUpload(el, id, query, onPick, opts);
    return search(query, (opts && opts.limit) || 80).then(function (items) {
      if (!items.length) {
        el.innerHTML = _uploadHtml(id) + '<p class="col-span-full text-xs text-center text-gray-400 dark:text-zinc-500 py-3">' + _esc(emptyText) + '</p>';
        _wireUpload(el, id, query, onPick, opts);
        return items;
      }
      el.innerHTML = _uploadHtml(id) + items.map(function (it) {
        return '<button type="button" data-thiing-value="thiing:' + _esc(it.slug) + '"' +
          ' title="' + _esc(it.name) + '" aria-label="' + _esc(it.name) + '"' +
          ' class="bw-thiing-choice rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition">' +
          '<img src="' + _esc(it.src) + '" alt="" loading="lazy" decoding="async">' +
          '</button>';
      }).join('');
      _wireUpload(el, id, query, onPick, opts);
      el.querySelectorAll('[data-thiing-value]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onPick === 'function') onPick(btn.dataset.thiingValue);
        });
      });
      return items;
    });
  }

  window.bwThiingsLoad = load;
  window.bwThiingsSearch = search;
  window.bwIconHtml = html;
  window.bwIconSetButton = setButton;
  window.bwIconIsThiing = isThiing;
  window.bwThiingsRenderGrid = renderGrid;
}());
