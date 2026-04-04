/* home-widgets.js — BookWorm personal pages — core navigation & widget CRUD.
   Rendering engines are split across:
     home-widgets-clock.js    — clock engine
     home-widgets-render.js   — weather, calendar, countdown, timer, todo, reminder
     home-widgets-settings.js — widget settings modal, size picker, page layout
*/
'use strict';

// ── Utilities ────────────────────────────────────────────────────────────────
const _post = (url, body = {}) =>
  fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// ── Navigation ───────────────────────────────────────────────────────────────
function _showHomeCanvas() {
  document.getElementById('home-content')?.classList.remove('hidden');
  document.getElementById('note-list')?.classList.add('hidden');
}

function homeExit() {
  document.getElementById('home-content')?.classList.add('hidden');
  document.getElementById('note-list')?.classList.remove('hidden');
}

function showHomePage(pageId) {
  _showHomeCanvas();
  fetch(`/home/pages/${pageId}`, { credentials: 'same-origin' })
    .then(r => r.text())
    .then(html => {
      const hc = document.getElementById('home-content');
      if (hc) { hc.innerHTML = html; initHomeWidgets(); }
    });
}
/** Alias used in sidebar template. */
const openHomePage = showHomePage;

// ── Home-Page sidebar CRUD ────────────────────────────────────────────────────
function openNewHomePage() {
  const modal  = document.getElementById('hp-modal');
  const title  = document.getElementById('hp-modal-title');
  const submit = document.getElementById('hp-modal-submit');
  const action = document.getElementById('hp-modal-action');
  const nameEl = document.getElementById('hp-name');
  const emojiI = document.getElementById('hp-emoji');
  const emojiB = document.getElementById('hp-emoji-btn');

  title.textContent      = 'New Page';
  submit.textContent     = 'Create';
  action.value           = '/home/pages/create';
  nameEl.value           = '';
  emojiI.value           = '🏠';
  emojiB.textContent     = '🏠';
  modal.classList.remove('hidden');
  setTimeout(() => nameEl.focus(), 60);
}

function openRenameHomePage(pageId, name, emoji) {
  const modal  = document.getElementById('hp-modal');
  const title  = document.getElementById('hp-modal-title');
  const submit = document.getElementById('hp-modal-submit');
  const action = document.getElementById('hp-modal-action');
  const nameEl = document.getElementById('hp-name');
  const emojiI = document.getElementById('hp-emoji');
  const emojiB = document.getElementById('hp-emoji-btn');

  title.textContent  = 'Rename Page';
  submit.textContent = 'Save';
  action.value       = `/home/pages/${pageId}/rename`;
  nameEl.value       = name;
  emojiI.value       = emoji || '🏠';
  emojiB.textContent = emoji || '🏠';
  modal.classList.remove('hidden');
  setTimeout(() => { nameEl.focus(); nameEl.select(); }, 60);
}

function closeHpModal() {
  document.getElementById('hp-modal').classList.add('hidden');
}

async function submitHpModal() {
  const name   = document.getElementById('hp-name').value.trim();
  if (!name) { document.getElementById('hp-name').focus(); return; }
  const emoji  = document.getElementById('hp-emoji').value || '🏠';
  const action = document.getElementById('hp-modal-action').value;

  closeHpModal();
  const res  = await _post(action, { name, emoji });
  const html = await res.text();
  const sb   = document.getElementById('sb-home-pages');
  if (sb) sb.innerHTML = html;
}

function deleteHomePage(pageId, name) {
  if (!confirm(`Delete page "${name}"? This removes all its widgets too.`)) return;
  _post(`/home/pages/${pageId}/delete`)
    .then(r => r.text())
    .then(html => {
      const sb = document.getElementById('sb-home-pages');
      if (sb) sb.innerHTML = html;
      const canvas = document.getElementById('home-canvas');
      if (canvas && +canvas.dataset.pageId === pageId) homeExit();
    });
}

// ── Widget management ─────────────────────────────────────────────────────────
async function deleteWidget(widgetId, pageId) {
  if (!confirm('Remove this widget?')) return;
  const res = await _post(`/home/widgets/${widgetId}/delete`, { page_id: pageId });
  const hc  = document.getElementById('home-content');
  if (hc) hc.innerHTML = await res.text();
  initHomeWidgets();
}

/** Persist widget config to the backend. */
async function _saveWidgetConfig(widgetId, config) {
  await _post(`/home/widgets/${widgetId}/update-config`,
    { config_json: JSON.stringify(config) });
}

// ── Add-Widget Modal ──────────────────────────────────────────────────────────
function openAddWidget(pageId) {
  document.getElementById('aw-page-id').value = pageId;
  document.getElementById('aw-selected-type').value = '';
  document.getElementById('aw-step2').classList.add('hidden');
  document.querySelectorAll('.aw-type-btn').forEach(b =>
    b.classList.remove('border-wblue', 'bg-wblue/5'));
  document.getElementById('add-widget-modal').classList.remove('hidden');
}
function closeAddWidget() {
  document.getElementById('add-widget-modal').classList.add('hidden');
}

const WIDGET_STYLES = {
  clock:      [['digital','🕐 Digital'],['minimal','◌ Minimal'],['analog','🔵 Analog']],
  weather:    [['full','☁️ Full Forecast'],['compact','🌡️ Compact'],['minimal','🌤️ Minimal']],
  calendar:   [['month','📅 Month View'],['mini','🗓️ Mini']],
  todo:       [['list','📋 Full List'],['compact','✅ Compact']],
  note_link:  [['card','🗒️ Card'],['minimal','📄 Minimal']],
  timer:      [['stopwatch','⏱️ Stopwatch'],['pomodoro','🍅 Pomodoro'],['interval','🔁 Interval']],
  countdown:  [['event','🎯 Event (D/H/M/S)'],['days','📆 Days Only']],
  reminder:   [['list','📋 List'],['agenda','📌 Agenda']],
  title:      [
    ['plain',      '✏️ Plain'],
    ['banner',     '🟦 Banner'],
    ['ruled',      '〰️ Ruled'],
    ['badge',      '🏷️ Badge'],
    ['gradient',   '🌈 Gradient'],
    ['neon',       '💡 Neon Glow'],
    ['typewriter', '⌨️ Typewriter'],
    ['marquee',    '📢 Marquee'],
    ['sticky',     '📝 Sticky Note'],
    ['rainbow',    '🌈 Rainbow'],
  ],
};

const WIDGET_CONFIG_FIELDS = {
  clock: (s) => [
    { id: 'cf-fmt', label: 'Time format', type: 'select', name: 'format',
      options: [['12h','12-hour (AM/PM)'],['24h','24-hour']] },
    { id: 'cf-tz', label: 'Timezone', type: 'select', name: 'timezone',
      options: [
        ['local',                  '🌐 Local (auto-detect)'],
        ['America/New_York',       '🗽  Eastern — ET'],
        ['America/Chicago',        '🌽 Central — CT'],
        ['America/Denver',         '⛰️  Mountain — MT'],
        ['America/Los_Angeles',    '🌉 Pacific — PT'],
        ['America/Anchorage',      '🦴 Alaska — AKT'],
        ['Pacific/Honolulu',       '🌺 Hawaii — HT'],
        ['America/Puerto_Rico',    '🇵🇷 Puerto Rico — AST'],
        ['America/Sao_Paulo',      '🇧🇷 Brasília — BRT'],
        ['Europe/London',          '🇬🇧 London — GMT/BST'],
        ['Europe/Paris',           '🇫🇷 Paris — CET'],
        ['Europe/Moscow',          '🇷🇺 Moscow — MSK'],
        ['Asia/Dubai',             '🇦🇪 Dubai — GST'],
        ['Asia/Kolkata',           '🇮🇳 India — IST'],
        ['Asia/Dhaka',             '🇧🇩 Dhaka — BST'],
        ['Asia/Bangkok',           '🇹🇭 Bangkok — ICT'],
        ['Asia/Ho_Chi_Minh',       '🇻🇳 Vietnam — ICT'],
        ['Asia/Shanghai',          '🇨🇳 China — CST'],
        ['Asia/Tokyo',             '🇯🇵 Japan — JST'],
        ['Australia/Sydney',       '🦸 Sydney — AEDT'],
        ['Pacific/Auckland',       '🇳🇿 Auckland — NZST'],
        ['UTC',                    '🌍 UTC'],
      ]
    },
  ],
  weather: () => [
    { id: 'cf-loc',  label: 'Location (city, state)', type: 'text',
      placeholder: 'Dallas, TX', name: 'location' },
    { id: 'cf-unit', label: 'Temperature unit', type: 'select',
      options: [['F','°F Fahrenheit'],['C','°C Celsius']], name: 'unit' },
  ],
  calendar: () => [],
  todo:     () => [],
  note_link: () => [
    { id: 'cf-note', label: 'Note', type: 'select-notes', name: 'note_id' },
  ],
  timer: (s) => s === 'pomodoro' ? [
    { id: 'cf-pw', label: 'Work minutes',  type: 'number', placeholder: '25', name: 'pomo_work' },
    { id: 'cf-pb', label: 'Break minutes', type: 'number', placeholder: '5',  name: 'pomo_break' },
  ] : s === 'interval' ? [
    { id: 'cf-iv', label: 'Interval minutes', type: 'number', placeholder: '5', name: 'interval' },
  ] : [],
  countdown: () => [
    { id: 'cf-label', label: 'Event name',  type: 'text', placeholder: 'Launch Day!', name: 'label' },
    { id: 'cf-date',  label: 'Target date', type: 'date', name: 'target_date' },
  ],
  reminder: () => [],
  title:    () => [
    { id: 'cf-txt',   label: 'Title text',  type: 'text',   placeholder: 'My Section', name: 'text' },
    { id: 'cf-sub',   label: 'Subtitle',    type: 'text',   placeholder: 'optional',   name: 'subtitle' },
    { id: 'cf-emoji', label: 'Emoji prefix',type: 'text',   placeholder: '📂',          name: 'emoji' },
    { id: 'cf-align', label: 'Alignment',   type: 'select', name: 'align',
      options: [['center','Center'],['left','Left'],['right','Right']] },
  ],

function selectWidgetType(wtype) {
  document.getElementById('aw-selected-type').value = wtype;
  document.querySelectorAll('.aw-type-btn').forEach(b => {
    const active = b.dataset.wtype === wtype;
    b.classList.toggle('border-wblue', active);
    b.classList.toggle('bg-wblue/5',  active);
  });

  const styles   = WIDGET_STYLES[wtype] || [];
  const styleDiv = document.getElementById('aw-style-options');
  styleDiv.innerHTML = `<p class="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-2">Style</p>
    <div class="flex flex-wrap gap-2 mb-1">
      ${styles.map(([val, lbl], i) =>
        `<label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="aw-style" value="${val}" ${i===0?'checked':''}
                 class="accent-wblue" onchange="aw_refreshConfig('${wtype}', this.value)">
          <span class="text-sm text-gray-700 dark:text-zinc-300">${lbl}</span>
        </label>`
      ).join('')}
    </div>`;

  aw_refreshConfig(wtype, styles[0]?.[0] ?? 'default');
  document.getElementById('aw-step2').classList.remove('hidden');
}

function aw_refreshConfig(wtype, style) {
  const allNotes = JSON.parse(document.getElementById('all-notes-data')?.textContent || '[]');
  const fields   = (WIDGET_CONFIG_FIELDS[wtype] || (() => []))(style);
  const cfDiv    = document.getElementById('aw-config-fields');
  cfDiv.innerHTML = fields.map(f => {
    if (f.type === 'select-notes') {
      const opts = allNotes.map(n =>
        `<option value="${n.id}" data-title="${_esc(n.title)}"
                 data-snippet="${_esc((n.content||'').slice(0,100))}">${_esc(n.title)}</option>`
      ).join('');
      return `<div><label class="block text-xs font-semibold text-gray-500 mb-1">${f.label}</label>
        <select id="${f.id}" data-name="${f.name}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-2 focus:ring-wblue">
          <option value="">— pick a note —</option>${opts}
        </select></div>`;
    }
    if (f.type === 'select') {
      const opts = (f.options||[]).map(([v,l]) =>
        `<option value="${v}">${l}</option>`).join('');
      return `<div><label class="block text-xs font-semibold text-gray-500 mb-1">${f.label}</label>
        <select id="${f.id}" data-name="${f.name}"
          class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                 focus:outline-none focus:ring-2 focus:ring-wblue">${opts}</select></div>`;
    }
    return `<div><label class="block text-xs font-semibold text-gray-500 mb-1">${f.label}</label>
      <input id="${f.id}" data-name="${f.name}" type="${f.type}"
             placeholder="${f.placeholder||''}"
             class="w-full text-sm border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2
                    bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-2 focus:ring-wblue"></div>`;
  }).join('');
}

function aw_back() {
  document.getElementById('aw-step2').classList.add('hidden');
  document.getElementById('aw-selected-type').value = '';
  document.querySelectorAll('.aw-type-btn').forEach(b =>
    b.classList.remove('border-wblue','bg-wblue/5'));
}

async function aw_submit() {
  const pageId  = document.getElementById('aw-page-id').value;
  const wtype   = document.getElementById('aw-selected-type').value;
  if (!wtype) { alert('Pick a widget type first!'); return; }
  const styleEl = document.querySelector('input[name="aw-style"]:checked');
  const style   = styleEl ? styleEl.value : 'default';

  const config = {};
  document.querySelectorAll('#aw-config-fields [data-name]').forEach(el => {
    if (el.tagName === 'SELECT' && el.id === 'cf-note') {
      const opt = el.options[el.selectedIndex];
      if (opt && opt.value) {
        config.note_id      = +opt.value;
        config.note_title   = opt.dataset.title   || opt.text;
        config.note_snippet = opt.dataset.snippet || '';
      }
    } else {
      config[el.dataset.name] = el.value;
    }
  });

  const res = await _post(`/home/pages/${pageId}/widgets/add`, {
    widget_type: wtype, style, config_json: JSON.stringify(config),
  });
  closeAddWidget();
  const hc = document.getElementById('home-content');
  if (hc) hc.innerHTML = await res.text();
  initHomeWidgets();
}

// ── Drag & Drop reorder ───────────────────────────────────────────────────────
let _dragSrc = null;

function _initDnD(grid, pageId) {
  grid.addEventListener('dragstart', e => {
    _dragSrc = e.target.closest('.hw-card');
    if (_dragSrc) { setTimeout(() => _dragSrc.classList.add('opacity-40'), 0); }
  });
  grid.addEventListener('dragend', () => {
    _dragSrc?.classList.remove('opacity-40');
    _dragSrc = null;
  });
  grid.addEventListener('dragover', e => { e.preventDefault(); });
  grid.addEventListener('drop', async e => {
    e.preventDefault();
    if (!_dragSrc) return;
    const target = e.target.closest('.hw-card');
    if (!target || target === _dragSrc) return;
    const cards = [...grid.querySelectorAll('.hw-card')];
    const si = cards.indexOf(_dragSrc), ti = cards.indexOf(target);
    if (si < ti) target.after(_dragSrc); else target.before(_dragSrc);
    const order = [...grid.querySelectorAll('.hw-card')]
      .map(c => c.dataset.widgetId).join(',');
    await _post(`/home/pages/${pageId}/widgets/reorder`, { order });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initHomeWidgets() {
  // Title — typewriter animation
  document.querySelectorAll('.bw-typewriter').forEach(el => {
    const full = el.dataset.text || '';
    let i = 0;
    el.textContent = '';
    const tick = setInterval(() => {
      if (i >= full.length) { clearInterval(tick); return; }
      el.textContent += full[i++];
    }, 60);
  });

  // Clock — match ONLY clock-{digits}, never clock-greet-*, clock-tz-*, etc.
  document.querySelectorAll('[id^="clock-"]')
    .forEach(el => { if (/^clock-\d+$/.test(el.id)) _startClock(el); });

  // Analog clock
  document.querySelectorAll('canvas[id^="analog-clock-"]').forEach(_startAnalogClock);

  // Weather
  document.querySelectorAll('.weather-widget').forEach(_loadWeather);

  // Calendar
  document.querySelectorAll('.calendar-widget').forEach(_renderCalendar);

  // Countdown
  document.querySelectorAll('[id^="countdown-"]').forEach(_startCountdown);

  // Drag-and-drop per page grid
  const canvas = document.getElementById('home-canvas');
  if (canvas) {
    const pageId = canvas.dataset.pageId;
    const grid   = canvas.querySelector('[id^="widget-grid-"]');
    if (grid) _initDnD(grid, pageId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('home-canvas')) initHomeWidgets();
});
