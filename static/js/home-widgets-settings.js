/* home-widgets-settings.js — Widget settings modal, size picker, page layout */
'use strict';

// ── note-link multi-item editor state ─────────────────────────────────────────────────
var _nlWsCache = null;   // fetched workspace list; null = not yet loaded
var _nlItems   = [];     // working copy of the items array for the current editor

// ── Helpers ────────────────────────────────────────────────────────────────────
function _cardEl(widgetId) {
  return document.getElementById(`hw-card-${widgetId}`);
}

function _widgetGrid(widgetId) {
  return _cardEl(widgetId)?.closest('[data-col-count]') || null;
}

function _pageColCount(widgetId) {
  return parseInt(_widgetGrid(widgetId)?.dataset.colCount || '3', 10);
}

// ── Size Picker ───────────────────────────────────────────────────────────────
/**
 * Build a visual col×row size-picker section and inject it at the top of
 * the settings modal body.
 */
function _buildSizePicker(widgetId, body) {
  const card      = _cardEl(widgetId);
  // Legacy dividers stored '__ALL__' — treat that as full-width (= maxCols)
  const maxCols   = _pageColCount(widgetId);
  const rawCol    = card?.dataset.colSpan;
  const curCol    = (rawCol === '__ALL__' || !rawCol)
                    ? maxCols
                    : (parseInt(rawCol, 10) || 1);
  const curRow    = parseInt(card?.dataset.rowSpan || '1', 10);

  const section = document.createElement('div');
  section.innerHTML = `
    <p class="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold
              tracking-wide mb-1.5">Widget size</p>
    <div class="grid gap-1.5" id="sz-picker-${widgetId}"
         style="grid-template-columns: repeat(${maxCols}, 1fr)">
    </div>
    <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-1 text-center"
       id="sz-label-${widgetId}">
      ${curCol} col &times; ${curRow} row
    </p>`;
  body.prepend(section);

  const grid = document.getElementById(`sz-picker-${widgetId}`);
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= maxCols; c++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = `${c} col × ${r} row`;
      const isActive = c === curCol && r === curRow;
      btn.className = [
        'sz-btn border-2 rounded flex items-center justify-center',
        'transition cursor-pointer',
        isActive
          ? 'border-wblue bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-200 dark:border-zinc-700 hover:border-wblue/50',
      ].join(' ');
      btn.style.cssText = `height:${r * 18 + 4}px`;
      btn.dataset.col = c;
      btn.dataset.row = r;
      btn.addEventListener('click', () => _selectSize(widgetId, c, r));
      grid.appendChild(btn);
    }
  }
}

async function _selectSize(widgetId, col, row) {
  // Always update the visual picker immediately
  const grid = document.getElementById(`sz-picker-${widgetId}`);
  grid?.querySelectorAll('.sz-btn').forEach(b => {
    const active = +b.dataset.col === col && +b.dataset.row === row;
    b.classList.toggle('border-wblue',            active);
    b.classList.toggle('bg-blue-50',              active);
    b.classList.toggle('dark:bg-blue-900/20',     active);
    b.classList.toggle('border-gray-200',         !active);
    b.classList.toggle('dark:border-zinc-700',    !active);
  });
  const lbl = document.getElementById(`sz-label-${widgetId}`);
  if (lbl) lbl.textContent = `${col} col × ${row} row`;

  // ── Stack-child detection ──
  // If this widget lives inside a carousel slide, resize the PARENT STACK
  // (which owns the grid cell) instead of the individual child widget.
  // _resizeStack() is defined in home-widget-stack.js and handles both the
  // stack card DOM update and propagation to all sibling children.
  const card = _cardEl(widgetId);
  if (card?.closest('.stack-slide')) {
    const stackCard = card.closest('.hw-card[data-widget-type="stack"]');
    const stackId   = stackCard ? parseInt(stackCard.dataset.widgetId, 10) : null;
    if (stackId && typeof _resizeStack === 'function') {
      await _resizeStack(stackId, col, row);
    }
    return;   // skip normal single-widget resize path
  }

  // Normal (non-stacked) widget: update card DOM immediately for live feedback
  if (card) {
    const maxCols = _pageColCount(widgetId);
    card.style.gridColumn = (col >= maxCols) ? '1 / -1' : `span ${col}`;
    card.style.gridRow    = `span ${row}`;
    card.dataset.colSpan  = col;
    card.dataset.rowSpan  = row;
  }

  // Persist — merge into existing config
  const existing = _getCardConfig(widgetId);
  await _saveWidgetFullConfig(widgetId, { ...existing, col_span: col, row_span: row });
}

function _getCardConfig(widgetId) {
  try {
    return JSON.parse(_cardEl(widgetId)?.dataset.widgetConfig || '{}');
  } catch { return {}; }
}

// Classes that make up the default card shell (bg, border, shadow).
// Toggled on/off when card_bg config changes.
const _CARD_SHELL_CLS = [
  'bg-white', 'dark:bg-zinc-900', 'shadow-sm', 'border',
  'border-gray-200', 'dark:border-zinc-800', 'hover:shadow-md',
  'transition-shadow', 'duration-200',
];

async function _saveWidgetFullConfig(widgetId, config) {
  await _post(`/home/widgets/${widgetId}/update-config`,
    { config_json: JSON.stringify(config) });

  // ── Update in-memory DOM so every subsequent read sees fresh values ──────────
  // Without this, _getCardConfig keeps returning the page-load snapshot and
  // reopening the modal always shows the pre-save state.
  const card = _cardEl(widgetId);
  if (card) {
    card.dataset.widgetConfig = JSON.stringify(config);

    // Widget label: create / update / remove the <p class="hw-widget-label"> strip
    const existingLabel = card.querySelector('.hw-widget-label');
    if (config.show_name && config.custom_name) {
      if (existingLabel) {
        existingLabel.textContent = config.custom_name;
      } else {
        const lbl = document.createElement('p');
        lbl.className = 'hw-widget-label text-[11px] font-bold uppercase tracking-widest ' +
                        'text-gray-400 dark:text-zinc-500 mb-1.5 leading-none select-none';
        lbl.textContent = config.custom_name;
        card.prepend(lbl);
      }
    } else if (existingLabel) {
      existingLabel.remove();
    }

    // Card background: toggle the outer widget shell (bg / border / shadow).
    // card_bg = '0' → transparent/bare shell; anything else → default framed.
    if (config.card_bg !== undefined) {
      if (String(config.card_bg) === '0') {
        card.classList.remove(..._CARD_SHELL_CLS);
      } else {
        card.classList.add(..._CARD_SHELL_CLS);
      }
    }

    // RSS feed: sync data-* attributes then re-render immediately so changes
    // to feeds, thumbs, grouping, etc. appear without a page reload.
    const rssEl = card.querySelector('.rss-widget');
    if (rssEl) {
      const sync = {
        feeds:           v => { rssEl.dataset.feeds          = JSON.stringify(v); },
        max_items:       v => { rssEl.dataset.max            = String(v || 5); },
        refresh_min:     v => { rssEl.dataset.refresh        = String(v); },
        show_thumbs:     v => { rssEl.dataset.showThumbs     = String(v); },
        group_by:        v => { rssEl.dataset.groupBy        = String(v); },
        track_read:      v => { rssEl.dataset.trackRead      = String(v); },
        compact_label:    v => { rssEl.dataset.compactLabel = String(v); },
      };
      // Snapshot URL list + max BEFORE the sync loop mutates the dataset.
      // We compare only feed URLs (not labels/colors/categories) because those
      // metadata fields don't need a network refetch — they only affect rendering.
      // Full JSON comparison was broken: rssSyncFeeds writes {color,url,label,…}
      // but Python tojson writes {url,label,color,…} → different strings even
      // when the data is identical → _loadRss was always called, skipping rerender.
      const _prevFeeds = JSON.parse(rssEl.dataset.feeds || '[]');
      const _prevUrls  = _prevFeeds.map(f => f.url).join('\0');
      const _prevMax   = rssEl.dataset.max || '5';

      Object.entries(sync).forEach(([k, fn]) => {
        if (config[k] !== undefined) fn(config[k]);
      });

      const _nextFeeds = Array.isArray(config.feeds) ? config.feeds : _prevFeeds;
      const _nextUrls  = _nextFeeds.map(f => f.url).join('\0');
      const _nextMax   = String(config.max_items || _prevMax);
      // Only do a network refetch when feed URLs or item count actually changed.
      // Everything else (bubbles, thumbs, grouping, track-read) is render-only.
      const needsReload = (_nextUrls !== _prevUrls) || (_nextMax !== _prevMax);
      if (needsReload) {
        if (typeof _loadRss === 'function') _loadRss(rssEl);
      } else {
        if (typeof _rssRerender === 'function') _rssRerender(rssEl);
      }
    }

    // Upload Preview: re-render tile when upload_ids OR caption changes.
    // Both dataset attrs must be kept in sync — _loadUploadPreview reads both.
    const uplEl = card.querySelector('[data-upload-ids]');
    if (uplEl && (config.upload_ids !== undefined || config.caption !== undefined)) {
      if (config.upload_ids !== undefined)
        uplEl.dataset.uploadIds = JSON.stringify(config.upload_ids);
      if (config.caption !== undefined)
        uplEl.dataset.caption = String(config.caption);
      if (typeof _loadUploadPreview === 'function') _loadUploadPreview(uplEl);
    }

    // Subscriptions Summary: reload widget when page_id changes.
    // Apply bg_color live without re-fetching data.
    const swEl = card.querySelector('.subs-summary-widget');
    if (swEl && config.page_id !== undefined) {
      swEl.dataset.pageId = String(config.page_id || 0);
      if (typeof _loadSubscriptionsSummary === 'function') _loadSubscriptionsSummary(swEl);
    }
    if (swEl && config.bg_color !== undefined) {
      swEl.style.background = (typeof _subsWgtGradient === 'function')
        ? _subsWgtGradient(config.bg_color)
        : config.bg_color;
    }
  }

  const pid = Number(sessionStorage.getItem('bw-hp'));
  if (pid && typeof invalidateHomePageCache === 'function') invalidateHomePageCache(pid);
}

// ── Generic field builder ─────────────────────────────────────────────────────
function _buildFieldsForType(widgetId, wtype, wstyle, body) {
  const config = _getCardConfig(widgetId);
  const fields = (typeof WIDGET_CONFIG_FIELDS[wtype] === 'function')
    ? WIDGET_CONFIG_FIELDS[wtype](wstyle)
    : (WIDGET_CONFIG_FIELDS[wtype] || []);

  if (!fields.length) {
    const p = document.createElement('p');
    p.className = 'text-xs text-gray-400 dark:text-zinc-500 text-center py-1';
    p.textContent = 'No additional settings for this widget.';
    body.appendChild(p);
    return;
  }

  fields.forEach(f => {
    const wrap   = document.createElement('div');
    const lbl    = `<label class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1"
                         for="${f.id}">${f.label}</label>`;
    const curVal = config[f.name] ?? '';
    // Fields marked refresh:true need a full canvas reload after saving so
    // server-rendered widgets (like banners) reflect changes immediately.
    const saveFn = f.refresh
      ? `saveAndReloadWidget(${widgetId})`
      : `saveWidgetSettings(${widgetId})`;

    let input = '';
    if (f.type === 'select') {
      const opts = (f.options || []).map(([v, l]) =>
        `<option value="${v}"${String(curVal)===String(v)?' selected':''}>${l}</option>`
      ).join('');
      input = `<select id="${f.id}" data-cfg-key="${f.name}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="${saveFn}">${opts}</select>`;
    } else if (f.type === 'number') {
      input = `<input id="${f.id}" type="number" data-cfg-key="${f.name}"
                placeholder="${f.placeholder||''}" value="${curVal}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="${saveFn}">`;
    } else if (f.type === 'feeds-list') {
      // Migrate legacy single-url config to the new feeds array
      let existing = Array.isArray(config[f.name]) ? config[f.name] : [];
      if (!existing.length && config.url) {
        existing = [{ url: config.url, label: config.title || '', category: '', color: '' }];
      }
      // _rssFeedsEditorHtml lives in home-widget-rss.js; always available at runtime
      wrap.innerHTML = lbl + _rssFeedsEditorHtml(f.id, existing, f.name);
      body.appendChild(wrap);
      return;   // skip generic wrap.innerHTML = lbl + input path below
    } else if (f.type === 'color') {
      const colorVal  = curVal || f.default || '#0053e2';
      const resetDflt = f.default || '#0053e2';
      const hexId     = `${f.id}-hex`;
      const btnId     = `${f.id}-btn`;
      // Swatch: a relative container holds a coloured span (visual) and the
      // real <input type="color"> overlaid on top (opacity:0 but full-size so
      // the OS picker opens on click — zero-size inputs won't trigger it).
      input = `
        <div class="flex items-center gap-2">
          <span style="position:relative;display:inline-block;width:2rem;height:2rem;flex-shrink:0;">
            <span id="${btnId}"
                  style="position:absolute;inset:0;border-radius:6px;border:2px solid #e5e7eb;
                         background:${colorVal};box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);"></span>
            <input id="${f.id}" type="color" data-cfg-key="${f.name}"
                   value="${_escAttr(colorVal)}" title="Click to pick a color"
                   style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;padding:0;"
                   oninput="(function(v){document.getElementById('${btnId}').style.background=v;document.getElementById('${hexId}').textContent=v;})(this.value)"
                   onchange="${saveFn}">
          </span>
          <code id="${hexId}" class="text-xs font-mono text-gray-500 dark:text-zinc-400 select-all">${colorVal}</code>
          <button type="button" title="Reset to default"
                  class="ml-auto text-[10px] text-gray-400 hover:text-wblue dark:hover:text-blue-400 transition underline underline-offset-2"
                  onclick="(function(){var v='${resetDflt}';document.getElementById('${f.id}').value=v;document.getElementById('${btnId}').style.background=v;document.getElementById('${hexId}').textContent=v;${saveFn};})()">
            Reset
          </button>
        </div>`;
    } else if (f.type === 'select-crm-pages') {
      // Async-populated CRM page picker — same pattern as aw_refreshConfig
      const selId  = f.id;
      const selKey = f.name;
      const saved  = String(curVal);
      wrap.innerHTML = lbl + `<select id="${selId}" data-cfg-key="${selKey}"
        class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-2 focus:ring-wblue"
        onchange="${saveFn}">
        <option value="">Loading…</option>
      </select>`;
      body.appendChild(wrap);
      fetch('/home/pages', { credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.ok ? r.json() : { pages: [] })
        .then(data => {
          const sel = document.getElementById(selId);
          if (!sel) return;
          const pages = (data.pages || []).filter(p => p.page_type === 'crm');
          sel.innerHTML = '<option value="">— none —</option>'
            + pages.map(p =>
                `<option value="${p.id}"${String(p.id) === saved ? ' selected' : ''}>${p.name}</option>`
              ).join('');
        }).catch(() => {});
      return; // early-out — already appended
    } else if (f.type === 'select-subs-pages') {
      // Async-populated subscriptions page picker — mirrors select-crm-pages exactly
      const selId  = f.id;
      const selKey = f.name;
      const saved  = String(curVal);
      wrap.innerHTML = lbl + `<select id="${selId}" data-cfg-key="${selKey}"
        class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-2 focus:ring-wblue"
        onchange="${saveFn}">
        <option value="">Loading…</option>
      </select>`;
      body.appendChild(wrap);
      fetch('/home/pages', { credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.ok ? r.json() : { pages: [] })
        .then(data => {
          const sel = document.getElementById(selId);
          if (!sel) return;
          const pages = (data.pages || []).filter(p => p.page_type === 'subscriptions');
          sel.innerHTML = '<option value="">— pick a page —</option>'
            + pages.map(p =>
                `<option value="${p.id}"${String(p.id) === saved ? ' selected' : ''}>${p.name}</option>`
              ).join('');
        }).catch(() => {});
      return; // early-out — already appended
    } else if (f.type === 'select-trip-pages') {
      // Cascade picker 1: trip pages for Settle Up sync.
      const tpId   = f.id;
      const tpKey  = f.name;
      const tpSaved = String(curVal);
      wrap.innerHTML = lbl + `<select id="${tpId}" data-cfg-key="${tpKey}"
        class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-2 focus:ring-wblue"
        onchange="_suCascadePlans(this);${saveFn}">
        <option value="">— none (standalone) —</option>
      </select>`;
      body.appendChild(wrap);
      fetch('/home/settle-up/trip-pages', { credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.ok ? r.json() : { pages: [] })
        .then(data => {
          const sel = document.getElementById(tpId);
          if (!sel) return;
          sel.innerHTML = '<option value="">— none (standalone) —</option>'
            + (data.pages || []).map(p =>
                `<option value="${p.id}"${String(p.id) === tpSaved ? ' selected' : ''}>${p.emoji || '✈️'} ${p.name}</option>`
              ).join('');
          // If a page is already saved, repopulate plans
          if (tpSaved && sel.value) _suCascadePlans(sel);
        }).catch(() => {});
      return;
    } else if (f.type === 'select-trip-plans') {
      // Cascade picker 2: plans for the selected trip page.
      const plId   = f.id;
      const plKey  = f.name;
      const plSaved = String(curVal);
      wrap.innerHTML = lbl + `<select id="${plId}" data-cfg-key="${plKey}"
        class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-2 focus:ring-wblue"
        onchange="_suCascadePanels(this);${saveFn}">
        <option value="">— pick a plan —</option>
      </select>`;
      body.appendChild(wrap);
      // Plans are restored after trip-pages fires _suCascadePlans.
      // We store the saved value so _suCascadePlans can select it.
      const _plWrap = document.getElementById(plId);
      if (_plWrap) _plWrap.dataset.savedVal = plSaved;
      return;
    } else if (f.type === 'select-settle-panels') {
      // Cascade picker 3: settle-type panels in the selected plan.
      const panId   = f.id;
      const panKey  = f.name;
      const panSaved = String(curVal);
      wrap.innerHTML = lbl + `<select id="${panId}" data-cfg-key="${panKey}"
        class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
               bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
               focus:outline-none focus:ring-2 focus:ring-wblue"
        onchange="${saveFn}">
        <option value="">— pick a card —</option>
      </select>`;
      body.appendChild(wrap);
      const _panWrap = document.getElementById(panId);
      if (_panWrap) _panWrap.dataset.savedVal = panSaved;
      return;
    } else if (f.type === 'upload-picker') {
      // Shows current count + a button that opens the file-picker modal.
      // The hidden input carries upload_ids through saveWidgetSettings.
      const count     = Array.isArray(curVal) ? curVal.length : 0;
      const hiddenVal = JSON.stringify(Array.isArray(curVal) ? curVal : []);
      wrap.innerHTML  = lbl
        + '<div class="flex items-center gap-3 mt-1">'
        + '<span id="upl-prev-settings-count" class="text-sm text-gray-500 dark:text-zinc-400">'
        + count + ' file(s) pinned</span>'
        + '<button type="button" onclick="_uplPrevOpenPicker(' + widgetId + ')"'
        + ' class="px-3 py-1.5 text-xs bg-wblue text-white rounded-lg'
        + ' hover:bg-blue-700 transition">Pick Files…</button>'
        + '</div>'
        + '<input type="hidden" id="' + f.id + '"'
        + ' data-cfg-key="' + f.name + '" data-json="1"'
        + ' value=\'' + hiddenVal.replace(/'/g, "&#39;") + '\'>';
      body.appendChild(wrap);
      return;  // do not fall through to generic body.appendChild at end of loop
    } else if (f.type === 'link-list-editor') {
      // Multi-item editor for note_link widgets.
      // Normalises legacy single-note config (note_id) into the new items[] shape.
      var rawCfg   = _getCardConfig(widgetId);
      var legacyIt = rawCfg.note_id
        ? [{type:'note', id:rawCfg.note_id,
            title:rawCfg.note_title||'Note', snippet:rawCfg.note_snippet||''}]
        : [];
      _nlItems = Array.isArray(rawCfg.items) ? rawCfg.items.slice() : legacyIt;

      wrap.innerHTML = lbl
        + '<input type="hidden" id="' + f.id + '"'
        +   ' data-cfg-key="' + f.name + '" data-json="1" value="[]">'
        + '<div id="nl-editor-list" class="space-y-1 mb-2 max-h-40 overflow-y-auto"></div>'
        + '<div class="flex gap-2 mt-1">'
        +   '<select id="nl-note-picker"'
        +     ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-700'
        +             ' rounded-lg px-2 py-1.5'
        +             ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
        +             ' focus:outline-none focus:ring-2 focus:ring-wblue"'
        +     ' onchange="_nlPickNote(' + widgetId + ',this)">'
        +     '<option value="">＋ Add note…</option>'
        +   '</select>'
        +   '<select id="nl-ws-picker"'
        +     ' class="flex-1 text-xs border border-gray-200 dark:border-zinc-700'
        +             ' rounded-lg px-2 py-1.5'
        +             ' bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100'
        +             ' focus:outline-none focus:ring-2 focus:ring-wblue"'
        +     ' onchange="_nlPickWorkspace(' + widgetId + ',this)">'
        +     '<option value="">＋ Add workspace…</option>'
        +   '</select>'
        + '</div>';
      body.appendChild(wrap);
      _nlRefreshEditor(widgetId);
      _nlRefreshNotePicker();
      _nlLoadWorkspaces(widgetId);
      return; // early-out
    } else {
      input = `<input id="${f.id}" type="text" data-cfg-key="${f.name}"
                placeholder="${f.placeholder||""}" value="${_escAttr(curVal)}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="${saveFn}">`;
    }
    wrap.innerHTML = lbl + input;
    // Clickable suggestion chips — rendered for any field that supplies a
    // suggestions array (e.g. the emoji picker for the title widget).
    if (f.suggestions && f.suggestions.length) {
      const chips = document.createElement('div');
      chips.className = 'flex flex-wrap gap-1 mt-1.5';
      f.suggestions.forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = s;
        btn.title = `Use ${s}`;
        btn.className = [
          'text-base px-1 py-0.5 rounded cursor-pointer leading-none',
          'hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors',
        ].join(' ');
        btn.addEventListener('click', () => {
          const inp = document.getElementById(f.id);
          if (inp) inp.value = s;
          saveWidgetSettings(widgetId);
        });
        chips.appendChild(btn);
      });
      wrap.appendChild(chips);
    }
    body.appendChild(wrap);
  });
}

function _escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── Name / label fields (universal — all widget types) ─────────────────────
/**
 * Inject a small “Widget label” section at the top of the settings body.
 * Two fields, both auto-save on change via saveWidgetSettings:
 *   custom_name  — free-text display name
 *   show_name    — checkbox: whether to render that name on the card
 */
function _buildNameFields(widgetId, body) {
  const cfg        = _getCardConfig(widgetId);
  const curName    = cfg.custom_name || '';
  const showChecked= cfg.show_name   ? 'checked' : '';
  const saveFn     = `saveWidgetSettings(${widgetId})`;

  const sec = document.createElement('div');
  sec.className = 'mb-4 pb-3 border-b border-gray-100 dark:border-zinc-800';
  sec.innerHTML = `
    <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400
              dark:text-zinc-500 mb-2">Widget label</p>
    <input id="ws-name-${widgetId}" type="text"
           data-cfg-key="custom_name"
           placeholder="e.g. Tech News, Team Feeds…"
           value="${_escAttr(curName)}"
           class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg
                  px-2 py-1.5 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                  focus:outline-none focus:ring-2 focus:ring-wblue mb-2"
           onchange="${saveFn}">
    <label class="flex items-center gap-2 cursor-pointer select-none">
      <input id="ws-show-name-${widgetId}" type="checkbox"
             data-cfg-key="show_name"
             ${showChecked}
             class="w-3.5 h-3.5 rounded accent-wblue cursor-pointer"
             onchange="${saveFn}">
      <span class="text-xs text-gray-600 dark:text-zinc-300">Show label on widget</span>
    </label>`;
  body.appendChild(sec);
}

// ── Style Picker (inside settings modal) ─────────────────────────────────────
/**
 * Build a style-switcher row for the widget and append it to `body`.
 * Clicking a style radio calls changeWidgetStyle which re-renders the whole canvas.
 */
function _buildStylePicker(widgetId, wtype, wstyle, body) {
  const styles = (typeof WIDGET_STYLES !== 'undefined' && WIDGET_STYLES[wtype]) || [];
  if (styles.length < 2) return;   // only one style — nothing to switch between

  const div = document.createElement('div');
  div.className = 'mb-1';
  div.innerHTML = `
    <p class="text-[10px] text-gray-400 dark:text-zinc-500 uppercase font-semibold
              tracking-wide mb-1.5">Widget style</p>
    <div class="flex flex-wrap gap-2">
      ${styles.map(([val, lbl]) => {
        const active = val === wstyle;
        return `<label class="flex items-center gap-1.5 cursor-pointer select-none">
          <input type="radio" name="ws-style-${widgetId}" value="${val}"
                 ${active ? 'checked' : ''} class="accent-wblue"
                 onchange="changeWidgetStyle(${widgetId}, this.value)">
          <span class="text-xs text-gray-700 dark:text-zinc-300">${lbl}</span>
        </label>`;
      }).join('')}
    </div>`;
  body.appendChild(div);

  const divider = document.createElement('hr');
  divider.className = 'border-gray-100 dark:border-zinc-800 my-2';
  body.appendChild(divider);
}

/** Hit the server, swap the whole canvas, re-init widgets, then reopen settings. */
async function changeWidgetStyle(widgetId, newStyle) {
  const canvas = document.getElementById('home-canvas');
  const pageId = canvas?.dataset.pageId;
  if (!pageId) return;

  // Grab title/icon before we blow away the DOM
  const titleText = document.getElementById('ws-settings-name')?.textContent || 'Widget';
  const iconText  = document.getElementById('ws-settings-icon')?.textContent  || '⚙️';

  // Close modal first (returns clock children to hidden panel, clears modal state)
  closeWidgetSettings();

  const res  = await _post(`/home/widgets/${widgetId}/change-style`,
    { style: newStyle, page_id: pageId });
  const html = await res.text();
  const hc   = document.getElementById('home-content');
  if (hc) { hc.innerHTML = html; initHomeWidgets(); }

  // Reopen settings for the same widget with its new style
  openWidgetSettings(widgetId, titleText, iconText);
}

// ── openWidgetSettings — universal entry point ─────────────────────────────
function openWidgetSettings(widgetId, title, icon) {
  const modal = document.getElementById('ws-settings-modal');
  const body  = document.getElementById('ws-settings-body');
  if (!modal || !body) return;

  modal.dataset.widgetId = widgetId;
  body.innerHTML = '';

  const card  = _cardEl(widgetId);
  const wtype = card?.dataset.widgetType  || 'clock';
  const wstyle= card?.dataset.widgetStyle || 'default';

  // 1. Size picker — shown for all widget types including dividers & titles
  _buildSizePicker(widgetId, body);

  // 2. Widget label (name + show toggle) — universal
  _buildNameFields(widgetId, body);

  // 3. Style switcher (universal — skipped if widget has only one style)
  _buildStylePicker(widgetId, wtype, wstyle, body);

  // 4. Clock: move hidden config panel into modal body for live previews
  if (wtype === 'clock') {
    const panel = document.getElementById(`ws-cfg-${widgetId}`);
    if (panel) {
      // Wrap panel children so we can move them back on close
      const slot = document.createElement('div');
      slot.id = `ws-clock-slot-${widgetId}`;
      slot.append(...Array.from(panel.children));
      body.appendChild(slot);
    }
  } else {
    // 3. Other widget types: build fields dynamically
    _buildFieldsForType(widgetId, wtype, wstyle, body);
  }

  // Header
  const nameEl = document.getElementById('ws-settings-name');
  const iconEl = document.getElementById('ws-settings-icon');
  if (nameEl) nameEl.textContent = title || 'Widget';
  if (iconEl) iconEl.textContent = icon  || '⚙️';

  modal.classList.remove('hidden');
  modal.focus();
}

/** Move clock panel children back to their hidden slot, then close. */
function closeWidgetSettings() {
  const modal = document.getElementById('ws-settings-modal');
  if (!modal) return;
  const widgetId = modal.dataset.widgetId;
  const slot  = document.getElementById(`ws-clock-slot-${widgetId}`);
  const panel = document.getElementById(`ws-cfg-${widgetId}`);
  if (slot && panel) panel.append(...Array.from(slot.children));
  modal.classList.add('hidden');
  delete modal.dataset.widgetId;
}

/**
 * Save all settings (including feeds-list hidden input), then close.
 * Used by the "Done" button — ensures feeds-list changes are always persisted
 * because those fields have no individual onchange trigger.
 */
async function saveAndCloseWidgetSettings() {
  const modal    = document.getElementById('ws-settings-modal');
  const widgetId = modal?.dataset.widgetId;
  if (widgetId) {
    // Sync any feeds-list editors before saving (in case focus never left an input)
    document.querySelectorAll('[id$="-rows"]').forEach(rows => {
      const fieldId = rows.id.replace(/-rows$/, '');
      if (typeof rssSyncFeeds === 'function') rssSyncFeeds(fieldId);
    });
    await saveWidgetSettings(Number(widgetId));
  }
  closeWidgetSettings();
}

// ── saveClockSetting — live-preview + persist for clock widgets ────────────
async function saveClockSetting(widgetId, key, value) {
  const greetEl  = document.getElementById(`clock-greet-${widgetId}`);
  const dateEl   = document.getElementById(`clock-date-${widgetId}`);
  const clockEl  = document.getElementById(`clock-${widgetId}`);
  const canvasEl = document.getElementById(`analog-clock-${widgetId}`);
  const tzEl     = document.getElementById(`clock-tz-${widgetId}`);

  if (key === 'show_greeting' && greetEl)
    greetEl.classList.toggle('hidden', !value);
  if (key === 'show_date' && dateEl)
    dateEl.classList.toggle('hidden', !value);
  if (key === 'format' && clockEl) {
    clockEl.dataset.format = value;
    _startClock(clockEl);
  }
  if (key === 'timezone') {
    if (clockEl)  { clockEl.dataset.tz  = value; _startClock(clockEl); }
    if (canvasEl) { canvasEl.dataset.tz = value; _startAnalogClock(canvasEl); }
    if (tzEl)     { tzEl.textContent    = _tzLabel(value); }
  }

  // Collect all settings from wherever the inputs currently live
  const source = document.getElementById(`ws-clock-slot-${widgetId}`)
               || document.getElementById(`ws-cfg-${widgetId}`)
               || document.getElementById('ws-settings-body');
  const config = {};
  source?.querySelectorAll('[data-cfg-key]').forEach(el => {
    config[el.dataset.cfgKey] = el.type === 'checkbox' ? el.checked : el.value;
  });

  // Preserve col_span / row_span from existing card config
  const existing = _getCardConfig(widgetId);
  if (existing.col_span) config.col_span = existing.col_span;
  if (existing.row_span) config.row_span = existing.row_span;

  await _saveWidgetFullConfig(widgetId, config);
}

/** Save config then re-render via changeWidgetStyle (same style = force reload). */
async function saveAndReloadWidget(widgetId) {
  await saveWidgetSettings(widgetId);
  const wstyle = _cardEl(widgetId)?.dataset.widgetStyle || 'default';
  changeWidgetStyle(widgetId, wstyle);
}

/** Generic save for all non-clock widget settings (reads data-cfg-key inputs). */
// ── note-link multi-item editor helpers ───────────────────────────────────────────────────────

/** Re-render the visible item rows and sync the hidden JSON input. */
function _nlRefreshEditor(widgetId) {
  var list = document.getElementById('nl-editor-list');
  var inp  = document.getElementById('cf-links');
  if (!list || !inp) return;
  inp.value = JSON.stringify(_nlItems);
  if (!_nlItems.length) {
    list.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 italic py-1">No links yet. Use the pickers below to add notes or workspaces.</p>';
    return;
  }
  list.innerHTML = _nlItems.map(function(item, idx) {
    var icon  = item.type === 'workspace' ? (item.emoji || '🗂️') : '📄';
    var label = item.type === 'workspace'
      ? (item.name  || 'Workspace') + (item.ws_type === 'database' ? ' — DB' : '')
      : (item.title || 'Note');
    return '<div class="flex items-center gap-1.5 py-1 px-1.5 rounded'
      + ' bg-gray-50 dark:bg-zinc-800/60'
      + ' text-xs text-gray-700 dark:text-zinc-300">'
      + '<span class="flex-shrink-0" aria-hidden="true">' + _esc(icon) + '</span>'
      + '<span class="flex-1 min-w-0 truncate">' + _esc(label) + '</span>'
      + '<button type="button" onclick="_nlRemoveItem(' + widgetId + ',' + idx + ')"'
      +   ' class="flex-shrink-0 text-gray-300 dark:text-zinc-600'
      +           ' hover:text-[#ea1100] transition leading-none px-0.5"'
      +   ' aria-label="Remove">&times;</button>'
      + '</div>';
  }).join('');
}

/** Populate the note picker from the all-notes-data DOM script tag (no fetch). */
function _nlRefreshNotePicker() {
  var sel    = document.getElementById('nl-note-picker');
  if (!sel) return;
  var cached = document.getElementById('all-notes-data');
  var notes  = cached ? (function() { try { return JSON.parse(cached.textContent||'[]'); } catch(e){ return []; } }()) : [];
  sel.innerHTML = '<option value="">＋ Add note…</option>'
    + notes.map(function(n) {
        var t = _escAttr(n.title || 'Untitled');
        var s = _escAttr((n.content || '').replace(/<[^>]*>/g,'').slice(0, 120));
        return '<option value="' + n.id + '" data-title="' + t + '" data-snippet="' + s + '">' + t + '</option>';
      }).join('');
}

/** Fetch workspaces from /home/workspaces-for-picker (cached per JS session). */
function _nlLoadWorkspaces(widgetId) {
  if (_nlWsCache !== null) { _nlRefreshWsPicker(); return; }
  fetch('/home/workspaces-for-picker', {credentials:'same-origin'})
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(data) { _nlWsCache = data; _nlRefreshWsPicker(); })
    .catch(function(e) { console.warn('[bookworm] workspaces-for-picker failed:', e); });
}

/** Populate the workspace picker from the in-memory cache. */
function _nlRefreshWsPicker() {
  var sel = document.getElementById('nl-ws-picker');
  if (!sel || !_nlWsCache) return;
  sel.innerHTML = '<option value="">＋ Add workspace…</option>'
    + _nlWsCache.map(function(w) {
        var badge   = w.ws_type === 'database' ? ' (DB)' : '';
        var display = _escAttr((w.emoji ? w.emoji + ' ' : '') + w.name + badge);
        return '<option value="' + w.id + '"'
          + ' data-name="'   + _escAttr(w.name)    + '"'
          + ' data-emoji="'  + _escAttr(w.emoji || '') + '"'
          + ' data-wstype="' + _escAttr(w.ws_type || 'workspace') + '">'
          + display + '</option>';
      }).join('');
}

/** Add a note item; called from nl-note-picker onchange. */
function _nlPickNote(widgetId, sel) {
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  if (_nlItems.length >= 10) {
    alert('Max 10 links per widget.');
    sel.selectedIndex = 0;
    return;
  }
  _nlItems.push({type:'note', id:+opt.value,
    title:opt.dataset.title||opt.text, snippet:opt.dataset.snippet||''});
  sel.selectedIndex = 0;
  _nlRefreshEditor(widgetId);
}

/** Add a workspace item; called from nl-ws-picker onchange. */
function _nlPickWorkspace(widgetId, sel) {
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  if (_nlItems.length >= 10) {
    alert('Max 10 links per widget.');
    sel.selectedIndex = 0;
    return;
  }
  _nlItems.push({type:'workspace', id:+opt.value,
    name:opt.dataset.name||opt.text,
    emoji:opt.dataset.emoji||'',
    ws_type:opt.dataset.wstype||'workspace'});
  sel.selectedIndex = 0;
  _nlRefreshEditor(widgetId);
}

/** Remove an item by index and refresh the editor. */
function _nlRemoveItem(widgetId, idx) {
  _nlItems.splice(idx, 1);
  _nlRefreshEditor(widgetId);
}

async function saveWidgetSettings(widgetId) {
  const body = document.getElementById('ws-settings-body');
  const config = { ..._getCardConfig(widgetId) };
  body?.querySelectorAll('[data-cfg-key]').forEach(el => {
    if (el.dataset.json) {
      try { config[el.dataset.cfgKey] = JSON.parse(el.value || '[]'); }
      catch { config[el.dataset.cfgKey] = []; }
    } else {
      config[el.dataset.cfgKey] = el.type === 'checkbox' ? el.checked : el.value;
    }
  });
  await _saveWidgetFullConfig(widgetId, config);
}

// ── Page Layout Picker ────────────────────────────────────────────────────────
function openPageLayout(pageId) {
  const modal = document.getElementById('pg-layout-modal');
  if (!modal) return;
  modal.dataset.pageId = pageId;

  // Read current col count from the widget grid
  const grid = document.querySelector(`[data-page-id="${pageId}"] [data-col-count]`);
  const cur  = parseInt(grid?.dataset.colCount || '3', 10);

  document.querySelectorAll('.pg-col-btn').forEach(btn => {
    const n = +btn.dataset.cols;
    btn.classList.toggle('border-wblue',         n === cur);
    btn.classList.toggle('bg-blue-50',           n === cur);
    btn.classList.toggle('dark:bg-blue-900/20',  n === cur);
    btn.classList.toggle('border-gray-200',      n !== cur);
    btn.classList.toggle('dark:border-zinc-700', n !== cur);
  });

  modal.classList.remove('hidden');
}

function closePageLayout() {
  document.getElementById('pg-layout-modal')?.classList.add('hidden');
}

async function selectPageLayout(cols) {
  const modal  = document.getElementById('pg-layout-modal');
  const pageId = modal?.dataset.pageId;
  if (!pageId) return;

  // Update UI immediately
  const grid = document.querySelector(`[data-page-id="${pageId}"] [data-col-count]`);
  if (grid) {
    grid.dataset.colCount = cols;
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    // Update col max for any open size pickers
  }

  // Highlight selected button
  document.querySelectorAll('.pg-col-btn').forEach(btn => {
    const active = +btn.dataset.cols === cols;
    btn.classList.toggle('border-wblue',         active);
    btn.classList.toggle('bg-blue-50',           active);
    btn.classList.toggle('dark:bg-blue-900/20',  active);
    btn.classList.toggle('border-gray-200',      !active);
    btn.classList.toggle('dark:border-zinc-700', !active);
  });

  // Persist to backend
  await _post(`/home/pages/${pageId}/update-config`,
    { config_json: JSON.stringify({ col_count: cols }) });
  if (typeof invalidateHomePageCache === 'function') invalidateHomePageCache(pageId);
}
