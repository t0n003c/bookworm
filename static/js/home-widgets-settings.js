/* home-widgets-settings.js — Widget settings modal, size picker, page layout */
'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  const curCol    = parseInt(card?.dataset.colSpan || '1', 10);
  const curRow    = parseInt(card?.dataset.rowSpan || '1', 10);
  const maxCols   = Math.min(_pageColCount(widgetId), 4);

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
  for (let r = 1; r <= 3; r++) {
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
  // Update visual selection
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

  // Update card DOM immediately for live feedback
  const card = _cardEl(widgetId);
  if (card) {
    card.style.gridColumn = `span ${col}`;
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

async function _saveWidgetFullConfig(widgetId, config) {
  await _post(`/home/widgets/${widgetId}/update-config`,
    { config_json: JSON.stringify(config) });
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
    const wrap = document.createElement('div');
    const lbl  = `<label class="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1"
                         for="${f.id}">${f.label}</label>`;
    const curVal = config[f.name] ?? '';

    let input = '';
    if (f.type === 'select') {
      const opts = (f.options || []).map(([v, l]) =>
        `<option value="${v}"${String(curVal)===String(v)?' selected':''}>${l}</option>`
      ).join('');
      input = `<select id="${f.id}" data-cfg-key="${f.name}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="saveWidgetSettings(${widgetId})">${opts}</select>`;
    } else if (f.type === 'number') {
      input = `<input id="${f.id}" type="number" data-cfg-key="${f.name}"
                placeholder="${f.placeholder||''}" value="${curVal}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="saveWidgetSettings(${widgetId})">`;
    } else {
      input = `<input id="${f.id}" type="text" data-cfg-key="${f.name}"
                placeholder="${f.placeholder||''}" value="${_escAttr(curVal)}"
                class="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2 py-1.5
                       bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                       focus:outline-none focus:ring-2 focus:ring-wblue"
                onchange="saveWidgetSettings(${widgetId})">`;
    }
    wrap.innerHTML = lbl + input;
    body.appendChild(wrap);
  });
}

function _escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
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

  // 1. Size picker (universal — all widget types)
  _buildSizePicker(widgetId, body);

  // 2. Style switcher (universal — skipped if widget has only one style)
  _buildStylePicker(widgetId, wtype, wstyle, body);

  // 3. Clock: move hidden config panel into modal body for live previews
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

/** Generic save for all non-clock widget settings (reads data-cfg-key inputs). */
async function saveWidgetSettings(widgetId) {
  const body = document.getElementById('ws-settings-body');
  const config = { ..._getCardConfig(widgetId) };
  body?.querySelectorAll('[data-cfg-key]').forEach(el => {
    config[el.dataset.cfgKey] = el.type === 'checkbox' ? el.checked : el.value;
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
}
