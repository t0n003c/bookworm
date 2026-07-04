(function () {
  'use strict';

  var _items = null;
  var _loadPromise = null;
  var _manifestUrl = '/static/data/thiings-icons.json';

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
      var src = String(it.src || ('/static/img/thiings/' + slug + '.png')).trim();
      if (!src.startsWith('/static/img/thiings/')) return null;
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
    return slug ? _withVersion('/static/img/thiings/' + slug + '.png') : '';
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

  function renderGrid(el, query, onPick, opts) {
    if (!el) return Promise.resolve([]);
    var emptyText = (opts && opts.emptyText) || 'Add licensed Thiings PNGs to static/img/thiings and list them in static/data/thiings-icons.json.';
    el.innerHTML = '<p class="col-span-full text-xs text-center text-gray-400 dark:text-zinc-500 py-3">Loading Thiings…</p>';
    return search(query, (opts && opts.limit) || 80).then(function (items) {
      if (!items.length) {
        el.innerHTML = '<p class="col-span-full text-xs text-center text-gray-400 dark:text-zinc-500 py-3">' + _esc(emptyText) + '</p>';
        return items;
      }
      el.innerHTML = items.map(function (it) {
        return '<button type="button" data-thiing-value="thiing:' + _esc(it.slug) + '"' +
          ' title="' + _esc(it.name) + '" aria-label="' + _esc(it.name) + '"' +
          ' class="bw-thiing-choice rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition">' +
          '<img src="' + _esc(it.src) + '" alt="" loading="lazy" decoding="async">' +
          '</button>';
      }).join('');
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
