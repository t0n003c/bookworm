/* home-widgets-render.js — Weather, Calendar, Countdown, Timer, Todo, Reminder */
'use strict';

// ── Weather ───────────────────────────────────────────────────────────────────
const _wmoDesc = {0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',
  45:'Foggy',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
  80:'Showers',81:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm+hail'};
const _wmoIcon = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌧️',55:'🌧️',61:'🌦️',63:'🌧️',65:'🌧️',71:'🌨️',73:'❄️',75:'❄️',
  80:'🌦️',81:'🌧️',95:'⛈️',96:'⛈️'};

async function _loadWeather(el) {
  const loc   = el.dataset.loc  || 'Dallas, TX';
  const unit  = el.dataset.unit || 'F';
  const style = el.dataset.style || 'full';

  // Show spinner while loading
  el.innerHTML = '<div class="flex items-center gap-2 text-gray-400 text-xs">'
    + '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-wblue"></div>'
    + '<span>Loading weather…</span></div>';

  try {
    // ── Step 1: Geocode the location name → lat/lon ──────────────────────
    // Calling open-meteo directly from the browser; the corporate proxy +
    // Windows auth handles tunnelling transparently (unlike server-side Python).
    const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?'
      + new URLSearchParams({ name: loc, count: '1', language: 'en', format: 'json' });
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
    const geo = await geoRes.json();
    if (!geo.results?.length) {
      el.textContent = '⚠️ Location not found';
      return;
    }

    const r        = geo.results[0];
    const lat      = r.latitude;
    const lon      = r.longitude;
    const name     = r.name     || loc;
    const admin1   = r.admin1  || '';
    const tempUnit = unit.toUpperCase() === 'F' ? 'fahrenheit' : 'celsius';

    // ── Step 2: Fetch current + 4-day forecast ───────────────────────────
    const wxUrl = `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m`
      + `&daily=temperature_2m_max,temperature_2m_min,weathercode`
      + `&temperature_unit=${tempUnit}&wind_speed_unit=mph`
      + `&forecast_days=4&timezone=auto`;
    const wxRes = await fetch(wxUrl);
    if (!wxRes.ok) throw new Error(`Weather API HTTP ${wxRes.status}`);
    const wx = await wxRes.json();

    const data = { name, admin1, unit: unit.toUpperCase(), current: wx.current ?? {}, daily: wx.daily ?? {} };
    const { current: cur, daily: days } = data;
    const temp = Math.round(cur.temperature_2m);
    const code = cur.weathercode;
    const icon = _wmoIcon[code] || '\uD83C\uDF21\uFE0F';
    const desc = _wmoDesc[code] || 'Unknown';

    if (style === 'minimal') {
      el.innerHTML = `<div class="flex items-center gap-3">
        <span class="text-4xl">${icon}</span>
        <div>
          <p class="text-2xl font-bold tabular-nums">${temp}°${unit}</p>
          <p class="text-xs text-gray-400">${name}</p>
        </div></div>`;
      return;
    }
    const dayRows = (days?.time || []).slice(1, 4).map((d, i) => {
      const dc = days.weathercode[i + 1];
      return `<div class="flex items-center justify-between text-xs">
        <span class="text-gray-500 w-8">${new Date(d + 'T12:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
        <span>${_wmoIcon[dc] || '\uD83C\uDF21\uFE0F'}</span>
        <span class="tabular-nums">${Math.round(days.temperature_2m_max[i + 1])}°</span>
        <span class="text-gray-400 tabular-nums">${Math.round(days.temperature_2m_min[i + 1])}°</span>
      </div>`;
    }).join('');

    if (style === 'compact') {
      el.innerHTML = `<div class="flex items-center gap-3 mb-2">
        <span class="text-3xl">${icon}</span>
        <div>
          <p class="text-xl font-bold tabular-nums">${temp}°${unit}
            <span class="text-sm font-normal text-gray-500">${desc}</span></p>
          <p class="text-xs text-gray-400">${name}, ${admin1}</p>
        </div></div>${dayRows}`;
      return;
    }
    // full
    el.innerHTML = `<div class="flex items-center gap-4 mb-3">
      <span class="text-5xl">${icon}</span>
      <div>
        <p class="text-3xl font-bold tabular-nums">${temp}°${unit}</p>
        <p class="text-sm text-gray-500">${desc}</p>
        <p class="text-xs text-gray-400">${name}, ${admin1}</p>
      </div>
      <div class="ml-auto text-right text-xs text-gray-400 space-y-0.5">
        <p>\uD83D\uDCA8 ${Math.round(cur.windspeed_10m)} mph</p>
        <p>\uD83D\uDCA7 ${cur.relativehumidity_2m}%</p>
      </div>
    </div>
    <div class="border-t border-gray-100 dark:border-zinc-800 pt-2 space-y-1.5">${dayRows}</div>`;
  } catch (err) {
    console.error('[weather]', err);
    el.innerHTML = `<div class="text-xs text-gray-400 space-y-1">
      <p>⚠️ Could not load weather</p>
      <p class="text-gray-300 dark:text-zinc-600">${_esc(String(err.message))}</p>
      <button onclick="_loadWeather(this.closest('.weather-widget'))"
              class="mt-1 text-wblue underline text-xs">Retry</button>
    </div>`;
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Render (or re-render) a calendar widget.
 * Stores month-offset in el.dataset.monthOffset so nav arrows can call back.
 */
function _renderCalendar(el) {
  const style  = el.dataset.style || 'month';
  const offset = parseInt(el.dataset.monthOffset || '0', 10);
  const now    = new Date();
  const base   = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y      = base.getFullYear();
  const m      = base.getMonth();
  const today  = (offset === 0) ? now.getDate() : -1;
  const first  = new Date(y, m, 1).getDay();    // weekday index of 1st
  const total  = new Date(y, m + 1, 0).getDate(); // days in month

  const monthName = base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Mini: compact grid, no nav, no day headers ───────────────────────────
  if (style === 'mini') {
    let cells = '<div class="grid grid-cols-7 gap-px">';
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= total; d++) {
      const isToday  = d === today;
      const isPast   = (offset === 0) && d < today;
      const isoDay   = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const evts     = (window._bwEventStore || {})[isoDay] || [];
      const dotColor = evts[0]?.color || '#0053e2';
      const dotTip   = evts.map(e => e.text).join(', ');
      cells += `<div class="relative w-5 h-6 flex flex-col items-center justify-start pt-0.5
        ${isToday ? 'rounded-full bg-wblue text-white font-bold'
          : isPast ? 'text-gray-300 dark:text-zinc-600'
          : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
        } cursor-pointer select-none text-[10px]"${dotTip ? ` title="${_esc(dotTip)}"` : ''}
        onclick="calDayClick('${isoDay}')" role="button" tabindex="0"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();calDayClick('${isoDay}');}">`;
      cells += `${d}${evts.length ? `<span aria-hidden="true" style="background:${dotColor}" class="block w-1 h-1 rounded-full mt-0.5"></span>` : ''}`;
      cells += `</div>`;
    }
    cells += '</div>';
    el.innerHTML = `
      <p class="text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">${monthName}</p>
      ${cells}`;
    return;
  }

  // ── Month: full view with day headers + navigation ────────────────────────
  let header = '<div class="grid grid-cols-7 gap-0.5 mb-0.5">';
  DAY_LABELS.forEach((d, i) => {
    const isWeekend = i === 0 || i === 6;
    header += `<div class="text-[10px] text-center uppercase font-semibold pb-1 select-none
      ${isWeekend ? 'text-wred/70' : 'text-gray-400 dark:text-zinc-500'}">${d}</div>`;
  });
  header += '</div>';

  let grid = '<div class="grid grid-cols-7 gap-0.5">';
  for (let i = 0; i < first; i++) {
    grid += '<div class="h-7"></div>';
  }
  for (let d = 1; d <= total; d++) {
    const dayOfWeek = (first + d - 1) % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday   = d === today;
    const isPast    = (offset === 0) && d < today;
    const isoDay    = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evts      = (window._bwEventStore || {})[isoDay] || [];
    let cls = 'relative h-8 flex flex-col items-center justify-start pt-1 text-xs rounded-lg select-none cursor-pointer ';
    if (isToday) {
      cls += 'bg-wblue text-white font-bold shadow-sm';
    } else if (isPast) {
      cls += 'text-gray-300 dark:text-zinc-600';
    } else if (isWeekend) {
      cls += 'text-wred/80 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium';
    } else {
      cls += 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800';
    }
    const dotTip = evts.map(e => e.text).join(', ');
    const dots = evts.slice(0, 3).map(e =>
      `<span aria-hidden="true" style="background:${e.color}" class="block w-1.5 h-1.5 rounded-full"></span>`
    ).join('');
    grid += `<div class="${cls}"${dotTip ? ` title="${_esc(dotTip)}"` : ''}
      onclick="calDayClick('${isoDay}')" role="button" tabindex="0"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();calDayClick('${isoDay}');}"
    >
      ${d}
      ${evts.length ? `<span class="flex gap-px mt-0.5">${dots}</span>` : ''}
    </div>`;
  }
  grid += '</div>';

  const navBtn = (dir, label) =>
    `<button onclick="calNav(this,${dir})"
       class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-zinc-800
              text-gray-500 hover:text-wblue transition text-xs" aria-label="${label}">
       ${dir < 0 ? '‹' : '›'}
     </button>`;

  el.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      ${navBtn(-1,'Previous month')}
      <span class="text-xs font-semibold text-gray-700 dark:text-zinc-200 select-none">${monthName}</span>
      ${navBtn(1,'Next month')}
    </div>
    ${header}${grid}`;
}

/** Called by the prev/next buttons on a calendar widget. */
function calNav(btn, dir) {
  const el = btn.closest('[data-style]');
  if (!el) return;
  el.dataset.monthOffset = String((parseInt(el.dataset.monthOffset || '0', 10)) + dir);
  _renderCalendar(el);
}

// ── Countdown ─────────────────────────────────────────────────────────────────
const _cdIntervals = {};

function _startCountdown(el) {
  const id     = el.id.replace('countdown-', '');
  const target = new Date(el.dataset.target + 'T00:00:00');
  const style  = el.dataset.style || 'event';
  const tick = () => {
    const diff = target - new Date();
    if (diff <= 0) {
      clearInterval(_cdIntervals[id]);
      el.querySelector(`#cd-display-${id}`)?.replaceWith(
        Object.assign(document.createElement('span'),
          { textContent: '🎉 Today!', className: 'text-xl font-bold text-wgreen' }));
      return;
    }
    const D = Math.floor(diff / 86400000);
    const H = Math.floor((diff % 86400000) / 3600000);
    const M = Math.floor((diff % 3600000)  / 60000);
    const S = Math.floor((diff % 60000)    / 1000);
    if (style === 'days') {
      const span = document.getElementById(`cd-display-${id}`);
      if (span) span.textContent = D;
    } else {
      [['D',D],['H',H],['M',M],['S',S]].forEach(([u,v]) => {
        document.querySelectorAll(`.cd-unit-${u}-${id}`)
          .forEach(s => s.textContent = String(v).padStart(2,'0'));
      });
    }
  };
  tick();
  if (_cdIntervals[id]) clearInterval(_cdIntervals[id]);
  _cdIntervals[id] = setInterval(tick, 1000);
}

// ── Timer ─────────────────────────────────────────────────────────────────────
const _timers = {};

function timerToggle(wid) {
  let t = _timers[wid];
  if (!t) {
    const el     = document.getElementById(`timer-${wid}`);
    const style  = el?.dataset.style || 'stopwatch';
    const pw     = +(el?.dataset.pomoWork  || 25);
    const pb     = +(el?.dataset.pomoBreak || 5);
    const iv     = +(el?.dataset.interval  || 5);
    t = _timers[wid] = {
      style, pw, pb, total: style === 'pomodoro' ? pw*60 : style === 'interval' ? iv*60 : 0,
      elapsed: 0, running: false, phase: 'work', interval: null,
    };
  }
  if (t.running) {
    clearInterval(t.interval); t.running = false;
    document.getElementById(`timer-btn-${wid}`).textContent = 'Resume';
  } else {
    t.running = true;
    document.getElementById(`timer-btn-${wid}`).textContent = 'Pause';
    t.interval = setInterval(() => {
      t.elapsed++;
      const pad = n => String(n).padStart(2,'0');
      let display;
      if (t.style === 'pomodoro') {
        const remaining = (t.phase==='work' ? t.pw : t.pb)*60 - t.elapsed;
        if (remaining <= 0) {
          t.elapsed = 0;
          t.phase = t.phase === 'work' ? 'break' : 'work';
          const phaseEl = document.getElementById(`timer-phase-${wid}`);
          if (phaseEl) phaseEl.textContent = t.phase === 'work' ? 'Work' : 'Break';
        }
        const rem2 = Math.max(0, (t.phase==='work' ? t.pw : t.pb)*60 - t.elapsed);
        display = `${pad(Math.floor(rem2/60))}:${pad(rem2%60)}`;
      } else if (t.style === 'interval') {
        const rem = Math.max(0, t.total - t.elapsed);
        if (rem === 0) { t.elapsed = 0; }
        display = `${pad(Math.floor(rem/60))}:${pad(rem%60)}`;
      } else {
        display = `${pad(Math.floor(t.elapsed/60))}:${pad(t.elapsed%60)}`;
      }
      const dispEl = document.getElementById(`timer-display-${wid}`);
      if (dispEl) dispEl.textContent = display;
    }, 1000);
  }
}

function timerReset(wid) {
  const t = _timers[wid];
  if (t) { clearInterval(t.interval); t.elapsed = 0; t.running = false; t.phase = 'work'; }
  const dispEl  = document.getElementById(`timer-display-${wid}`);
  const phaseEl = document.getElementById(`timer-phase-${wid}`);
  const btnEl   = document.getElementById(`timer-btn-${wid}`);
  const el      = document.getElementById(`timer-${wid}`);
  const style   = el?.dataset.style || 'stopwatch';
  const pw      = +(el?.dataset.pomoWork || 25);
  if (dispEl)  dispEl.textContent  = style === 'pomodoro' ? `${pw}:00` : '00:00';
  if (phaseEl) phaseEl.textContent = 'Work';
  if (btnEl)   btnEl.textContent   = 'Start';
}

// ── To-Do ─────────────────────────────────────────────────────────────────────────────────
const _todoData = {};

function _getTodoItems(wid) {
  if (!_todoData[wid]) {
    _todoData[wid] = Array.from(
      document.querySelectorAll(`#todo-list-${wid} li`)
    ).map(li => ({
      text: li.querySelector('label')?.textContent?.trim() || '',
      done: li.querySelector('input')?.checked || false,
    }));
  }
  return _todoData[wid];
}

// ── Todo progress bar helper ─────────────────────────────────────────────────
function _todoUpdateProgress(wid) {
  const ul    = document.getElementById(`todo-list-${wid}`);
  if (!ul) return;
  const all   = _getTodoItems(wid);
  const total = all.length;
  const done  = all.filter(i => i.done).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  const grad  = pct < 40
    ? 'linear-gradient(90deg,#ea1100,#f97316)'
    : pct < 80 ? 'linear-gradient(90deg,#f97316,#ffc220)'
    : 'linear-gradient(90deg,#22c55e,#2a8703)';
  const bar   = document.getElementById(`todo-bar-${wid}`);
  const stat  = document.getElementById(`todo-stat-${wid}`);
  if (bar)  { bar.style.width = pct + '%'; bar.style.background = grad; }
  if (stat) {
    stat.textContent = `${done}/${total}`;
    stat.className = `text-[11px] font-semibold tabular-nums flex-shrink-0 `
      + (pct === 100 ? 'text-wgreen' : pct >= 50 ? 'text-yellow-600' : 'text-gray-400');
  }
}

// ── Todo compact progress strip ────────────────────────────────────────────────
function _todoUpdateCompact(wid) {
  const ul    = document.getElementById(`todo-list-${wid}`);
  if (!ul) return;
  const all   = _getTodoItems(wid);
  const total = all.length;
  const done  = all.filter(i => i.done).length;
  const pct   = total ? Math.round(done / total * 100) : 0;
  // find the parent card and update the bar + label inside it
  const card  = ul.closest('.hw-card');
  if (!card) return;
  const bar   = card.querySelector('[data-bw-cbar]');
  const lbl   = card.querySelector('[data-bw-clbl]');
  const pctEl = card.querySelector('[data-bw-cpct]');
  const grad  = pct < 40
    ? 'linear-gradient(90deg,#ea1100,#f97316)'
    : pct < 80 ? 'linear-gradient(90deg,#f97316,#ffc220)'
    : 'linear-gradient(90deg,#22c55e,#2a8703)';
  if (bar)  { bar.style.width = pct + '%'; bar.style.background = grad; }
  if (lbl)  lbl.textContent = `${done}/${total} done`;
  if (pctEl) pctEl.textContent = pct + '%';
}

async function todoToggle(wid, idx, done) {
  const items = _getTodoItems(wid);
  if (items[idx]) items[idx].done = done;
  await _saveWidgetConfig(wid, { items });

  // DOM update — keep in sync without a full re-render
  const ul      = document.getElementById(`todo-list-${wid}`);
  const compact = ul?.dataset.style === 'compact';
  const li      = ul?.querySelectorAll('li')[idx];
  if (!li) return;
  const label = li.querySelector('label');
  if (compact) {
    li.classList.toggle('hidden', done);
    _todoUpdateCompact(wid);
  } else {
    label?.classList.toggle('line-through', done);
    label?.classList.toggle('text-gray-400', done);
    label?.classList.toggle('dark:text-zinc-500', done);
    _todoUpdateProgress(wid);
  }
}

async function todoAdd(wid, input) {
  const text = input?.value?.trim();
  if (!text) return;
  const items = _getTodoItems(wid);
  items.push({ text, done: false });
  await _saveWidgetConfig(wid, { items });
  input.value = '';
  const ul      = document.getElementById(`todo-list-${wid}`);
  const compact = ul?.dataset.style === 'compact';
  if (ul) {
    // Remove empty-state placeholder li if present
    ul.querySelectorAll('li').forEach(l => {
      if (!l.querySelector('input')) l.remove();
    });
    const idx = items.length - 1;
    const li  = document.createElement('li');
    if (compact) {
      li.className = 'flex items-center gap-1.5 rounded pl-1 border-l-2 border-wblue/40';
      li.innerHTML = `<input type="checkbox" id="todo-${wid}-${idx}"
        class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 w-3.5 h-3.5 cursor-pointer"
        onchange="todoToggle(${wid}, ${idx}, this.checked)">
        <label for="todo-${wid}-${idx}"
               class="text-xs text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug">${_esc(text)}</label>`;
      ul.appendChild(li);
      _todoUpdateCompact(wid);
    } else {
      li.className = 'flex items-center gap-2 group/tdi rounded-lg px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition';
      li.innerHTML = `<input type="checkbox" id="todo-${wid}-${idx}"
        class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 cursor-pointer"
        onchange="todoToggle(${wid}, ${idx}, this.checked)">
        <label for="todo-${wid}-${idx}"
               class="text-sm text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug">${_esc(text)}</label>
        <button onclick="todoDelete(${wid}, ${idx})" title="Remove task"
                class="opacity-0 group-hover/tdi:opacity-100 flex-shrink-0 p-0.5 rounded
                       text-gray-300 hover:text-wred transition" aria-label="Delete task">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>`;
      ul.appendChild(li);
      _todoUpdateProgress(wid);
    }
  }
}

async function todoDelete(wid, idx) {
  const items = _getTodoItems(wid);
  items.splice(idx, 1);
  await _saveWidgetConfig(wid, { items });
  delete _todoData[wid]; // reset cache; re-read from fresh DOM state after re-render
  const ul      = document.getElementById(`todo-list-${wid}`);
  const compact = ul?.dataset.style === 'compact';
  if (!ul) return;
  // Full re-render of the list for correct idx bindings
  if (items.length === 0) {
    const placeholder = compact
      ? '<li class="text-xs text-gray-400 italic text-center py-1">Nothing pending 🎉</li>'
      : '<li class="flex flex-col items-center justify-center py-4 text-center">'
        + '<span class="text-3xl mb-1">✨</span>'
        + '<span class="text-xs text-gray-400">No tasks yet — add one below!</span></li>';
    ul.innerHTML = placeholder;
  } else {
    ul.innerHTML = items.map((item, i) => {
      if (compact) {
        return `<li class="flex items-center gap-1.5 rounded pl-1 border-l-2 ${item.done ? 'hidden border-wgreen' : 'border-wblue/40'}">`
          + `<input type="checkbox" id="todo-${wid}-${i}"
                 class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 w-3.5 h-3.5 cursor-pointer"
                 ${item.done ? 'checked' : ''}
                 onchange="todoToggle(${wid}, ${i}, this.checked)">`
          + `<label for="todo-${wid}-${i}"
                   class="text-xs text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug">${_esc(item.text)}</label></li>`;
      }
      return `<li class="flex items-center gap-2 group/tdi rounded-lg px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition">`
        + `<input type="checkbox" id="todo-${wid}-${i}"
               class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 cursor-pointer"
               ${item.done ? 'checked' : ''}
               onchange="todoToggle(${wid}, ${i}, this.checked)">`
        + `<label for="todo-${wid}-${i}"
                 class="text-sm text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug
                        ${item.done ? 'line-through text-gray-400 dark:text-zinc-500' : ''}">${_esc(item.text)}</label>`
        + `<button onclick="todoDelete(${wid}, ${i})" title="Remove task"
                class="opacity-0 group-hover/tdi:opacity-100 flex-shrink-0 p-0.5 rounded
                       text-gray-300 hover:text-wred transition" aria-label="Delete task">`
        + `<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">`
        + `<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button></li>`;
    }).join('');
  }
  _todoData[wid] = [...items]; // update cache
  compact ? _todoUpdateCompact(wid) : _todoUpdateProgress(wid);
}

// ── Reminder ────────────────────────────────────────────────────────────────────────────
const _reminderData = {};

/** Format 'HH:MM' → { h12, mn, ap } e.g. { h12:'9', mn:'30', ap:'AM' } */
function _fmt12h(hhmm) {
  const hr = parseInt((hhmm || '00').slice(0, 2), 10);
  const mn = (hhmm || '00:00').slice(3, 5) || '00';
  return { h12: String((hr % 12) || 12), mn, ap: hr < 12 ? 'AM' : 'PM' };
}

/** Format ISO date string → 'Today', 'Tomorrow', 'Yesterday', or 'Jan 6' */
function _fmtDate(iso) {
  if (!iso) return '';
  try {
    const d     = new Date(iso + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const delta = Math.round((d - today) / 86400000);
    if (delta === 0)  return 'Today';
    if (delta === 1)  return 'Tomorrow';
    if (delta === -1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function _getReminderItems(wid) {
  if (!_reminderData[wid]) {
    _reminderData[wid] = Array.from(
      // skip separator <li> elements (they have no data-time)
      document.querySelectorAll(`#reminder-list-${wid} li[data-time]`)
    ).map(li => ({
      time:            li.dataset.time            || '',
      date:            li.dataset.date            || '',
      text:            li.dataset.text            || li.querySelector('.text-xs, span:last-of-type')?.textContent?.trim() || '',
      repeat_unit:     li.dataset.repeatUnit      || 'none',
      repeat_interval: parseInt(li.dataset.repeatInterval || '1', 10),
    }));
  }
  return _reminderData[wid];
}

function _sortReminders(items) {
  return [...items].sort((a, b) => {
    const da = (a.date || '') + 'T' + (a.time || '');
    const db = (b.date || '') + 'T' + (b.time || '');
    return da.localeCompare(db);
  });
}

async function reminderAdd(wid, input) {
  const text = input?.value?.trim();
  const time = document.getElementById(`rem-time-${wid}`)?.value || '00:00';
  const date = document.getElementById(`rem-date-${wid}`)?.value || '';
  if (!text) return;
  const repeatVal = document.getElementById(`rem-repeat-${wid}`)?.value || 'none';
  let repeat_unit = 'none', repeat_interval = 1;
  if (repeatVal === 'custom') {
    repeat_unit     = document.getElementById(`rem-repeat-unit-${wid}`)?.value || 'day';
    repeat_interval = parseInt(document.getElementById(`rem-repeat-n-${wid}`)?.value, 10) || 1;
  } else if (repeatVal !== 'none') {
    const [ru, riv] = repeatVal.split(':');
    repeat_unit = ru; repeat_interval = parseInt(riv, 10) || 1;
  }
  const items = _getReminderItems(wid);
  items.push({ time, date, text, repeat_unit, repeat_interval });
  const sorted = _sortReminders(items);
  await _saveWidgetConfig(wid, { items: sorted });
  input.value = '';
  const ul    = document.getElementById(`reminder-list-${wid}`);
  const style = ul?.dataset.style || 'list';
  if (!ul) return;
  delete _reminderData[wid];
  ul.innerHTML = _renderReminderItems(wid, sorted, style);
}

async function reminderDelete(wid, idx) {
  const items = _getReminderItems(wid);
  items.splice(idx, 1);
  const sorted = _sortReminders(items);
  await _saveWidgetConfig(wid, { items: sorted });
  delete _reminderData[wid];
  const ul    = document.getElementById(`reminder-list-${wid}`);
  const style = ul?.dataset.style || 'list';
  if (!ul) return;
  ul.innerHTML = _renderReminderItems(wid, sorted, style);
}

/** Render all items into a `<ul>` innerHTML string (handles date separators). */
function _renderReminderItems(wid, items, style) {
  if (!items.length) {
    const icon = style === 'agenda' ? '🗓️' : '⏰';
    const msg  = style === 'agenda' ? 'Nothing on the agenda yet' : 'Nothing scheduled yet';
    return `<li class="flex flex-col items-center py-6 text-center">`
         + `<span class="text-3xl mb-1.5">${icon}</span>`
         + `<span class="text-xs text-gray-400">${msg}</span></li>`;
  }
  let html = '';
  let lastDate = '__never__';
  items.forEach((item, i) => {
    if (style === 'agenda' && item.date !== lastDate) {
      lastDate = item.date;
      html += _reminderDateHeader(item.date);
    }
    html += style === 'agenda'
      ? _reminderAgendaLi(wid, item, i)
      : _reminderListLi(wid, item, i);
  });
  return html;
}

function _reminderTimePalette(time) {
  const hr = parseInt((time || '00').slice(0, 2), 10);
  if (hr < 12)  return { accent:'#f59e0b', abg:'#fef3c7', atxt:'#b45309', pillst:'background:#fef3c7;color:#b45309' };
  if (hr < 17)  return { accent:'#0053e2', abg:'#dbeafe', atxt:'#0053e2', pillst:'background:#dbeafe;color:#0053e2' };
  if (hr < 21)  return { accent:'#7c3aed', abg:'#ede9fe', atxt:'#6d28d9', pillst:'background:#ede9fe;color:#6d28d9' };
  return         { accent:'#6b7280', abg:'#f3f4f6', atxt:'#4b5563', pillst:'background:#f3f4f6;color:#4b5563' };
}

function _reminderDateHeader(iso) {
  const label = _fmtDate(iso) || 'No date';
  return `<li class="flex items-center gap-2 pt-2 pb-0.5" aria-hidden="true">`
       + `<span class="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-zinc-500 whitespace-nowrap">${_esc(label)}</span>`
       + `<div class="flex-1 h-px bg-gray-100 dark:bg-zinc-800"></div></li>`;
}

function _remRepeatBadge(item) {
  const u = item.repeat_unit || 'none';
  return (u === 'none') ? '' : `<span class="text-[9px] text-blue-400 dark:text-blue-400 flex-shrink-0" title="Repeating">↻</span>`;
}

function _reminderListLi(wid, item, i) {
  const p    = _reminderTimePalette(item.time);
  const dlbl = _fmtDate(item.date);
  const dateBadge = dlbl
    ? `<span class="text-[10px] text-gray-400 dark:text-zinc-500 flex-shrink-0 whitespace-nowrap">${_esc(dlbl)}</span>`
    : '';
  return `<li class="flex items-center gap-2 py-1.5 group/rem"
    data-time="${_esc(item.time)}" data-date="${_esc(item.date)}" data-text="${_esc(item.text)}"
    data-repeat-unit="${_esc(item.repeat_unit||'none')}" data-repeat-interval="${item.repeat_interval||1}">
    <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style="${p.pillst}">${_esc(item.time)}</span>
    ${dateBadge}
    <span class="text-xs text-gray-700 dark:text-zinc-300 flex-1 leading-snug min-w-0 truncate">${_esc(item.text)}</span>
    ${_remRepeatBadge(item)}
    <button onclick="reminderDelete(${wid}, ${i})"
            class="opacity-0 group-hover/rem:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition flex-shrink-0"
            aria-label="Delete">
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button></li>`;
}

function _reminderAgendaLi(wid, item, i) {
  const p  = _reminderTimePalette(item.time);
  const f  = _fmt12h(item.time);
  return `<li class="flex items-stretch gap-0 group/rem mb-1 rounded-lg overflow-hidden
    border border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-sm transition"
    data-time="${_esc(item.time)}" data-date="${_esc(item.date)}" data-text="${_esc(item.text)}"
    data-repeat-unit="${_esc(item.repeat_unit||'none')}" data-repeat-interval="${item.repeat_interval||1}">
    <div class="flex flex-col items-center justify-center px-2 py-2 flex-shrink-0 min-w-[3rem]"
         style="background:${p.abg}; border-right:2px solid ${p.accent};">
      <span class="text-sm font-bold tabular-nums leading-none" style="color:${p.accent}">${_esc(f.h12)}:${_esc(f.mn)}</span>
      <span class="text-[9px] font-semibold tracking-wide mt-0.5" style="color:${p.accent}">${_esc(f.ap)}</span>
    </div>
    <div class="flex-1 flex items-center gap-2 px-2.5 py-2 min-w-0">
      <span class="text-xs text-gray-800 dark:text-zinc-100 flex-1 leading-snug">${_esc(item.text)}</span>
      ${_remRepeatBadge(item)}
      <button onclick="reminderDelete(${wid}, ${i})"
              class="opacity-0 group-hover/rem:opacity-100 flex-shrink-0 p-0.5 text-gray-400 hover:text-red-500 transition"
              aria-label="Delete">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  </li>`;
}

// ── Reminder Notifications ───────────────────────────────────────────────────
const _notifFired = {}; // key: `${wid}-${date}-${time}` → true

// ── Missed-reminder log (localStorage-backed, auto-expires at midnight) ────────
// Key includes today's ISO date so old entries vanish automatically the next day.
var _REM_LS_KEY = 'bw-missed-' + new Date().toISOString().slice(0, 10); // YYYY-MM-DD
// Prune any leftover keys from previous days to keep localStorage tidy.
(function _remPruneOldDays() {
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.startsWith('bw-missed-') && k !== _REM_LS_KEY) localStorage.removeItem(k);
    });
  } catch (e) {}
}());
// Restore today's queue from storage (or start fresh).
var _missedQueue = (function () {
  try {
    var raw = localStorage.getItem(_REM_LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}());
// Sync the badge once the DOM is ready (script is defer so DOM is already parsed).
_remBellUpdateBadge();

/** Persist the current queue to localStorage. */
function _remSave() {
  try { localStorage.setItem(_REM_LS_KEY, JSON.stringify(_missedQueue)); } catch (e) {}
}

/** Push a missed reminder into the log, save it, and update the top-bar bell badge. */
function _remLogMissed(text, time) {
  _missedQueue.push({ text, time, ts: Date.now() });
  _remSave();
  _remBellUpdateBadge();
}

/** Refresh the badge count on the top-bar bell. */
function _remBellUpdateBadge() {
  const badge = document.getElementById('rem-bell-badge');
  if (!badge) return;
  const n = _missedQueue.length;
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.classList.toggle('hidden', n === 0);
}

/** Public: called by the bell button in the nav. */
window.toggleRemBell = function () {
  const panel = document.getElementById('rem-bell-panel');
  if (!panel) return;
  const opening = panel.classList.toggle('hidden');
  // When opening populate the list
  if (!panel.classList.contains('hidden')) _remBellRender();
  // Click-away
  if (!panel.classList.contains('hidden')) {
    setTimeout(() => {
      document.addEventListener('click', function _away(e) {
        if (!document.getElementById('rem-bell-container')?.contains(e.target)) {
          panel.classList.add('hidden');
          document.removeEventListener('click', _away);
        }
      });
    }, 50);
  }
};

/** Render missed-reminder items into the bell panel. */
function _remBellRender() {
  const list = document.getElementById('rem-bell-list');
  if (!list) return;
  if (_missedQueue.length === 0) {
    list.innerHTML = '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No missed reminders 🎉</p>';
    return;
  }
  list.innerHTML = _missedQueue.slice().reverse().map(r => {
    const t = new Date(r.ts);
    const label = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-zinc-800 last:border-0 group">
      <span class="text-wblue mt-0.5 flex-shrink-0">🔔</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs text-gray-700 dark:text-zinc-200 leading-snug">${_esc(r.text).replace(/\n/g, '<br>')}</p>
        <p class="text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">${_esc(label)}</p>
      </div>
      <button onclick="event.stopPropagation();remBellDismiss(${r.ts})" title="Dismiss"
        class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition
               w-5 h-5 rounded flex items-center justify-center text-xs
               text-gray-300 dark:text-zinc-600
               hover:text-red-500 dark:hover:text-red-400
               hover:bg-red-50 dark:hover:bg-red-900/20">✕</button>
    </div>`;
  }).join('');
}

/** Public: dismiss a single reminder by its timestamp key. */
window.remBellDismiss = function (ts) {
  const idx = _missedQueue.findIndex(r => r.ts === ts);
  if (idx !== -1) _missedQueue.splice(idx, 1);
  _remSave();
  _remBellUpdateBadge();
  _remBellRender();
};

/** Public: clear all missed reminders and close the panel. */
window.remBellClear = function () {
  _missedQueue.length = 0;
  try { localStorage.removeItem(_REM_LS_KEY); } catch (e) {}
  _remBellUpdateBadge();
  _remBellRender();
};

/** Show a BookWorm-styled reminder toast in the lower-right corner. */
function _showReminderToast(text, durationMs = 8000) {
  const wrap = document.getElementById('rem-fun-popup-wrap');
  if (!wrap) return;

  const card = document.createElement('div');
  card.className = 'pointer-events-auto w-72 overflow-hidden rounded-xl shadow-lg'
    + ' bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700'
    + ' animate-[bw-slideup_.3s_cubic-bezier(.17,.67,.38,1.3)_both]';
  card.style.cssText = 'border-left: 3px solid #0053e2;';

  card.innerHTML = `
    <div class="flex items-start gap-3 px-4 pt-3 pb-2">
      <span class="flex-shrink-0 mt-0.5 text-xl" aria-hidden="true">🔔</span>
      <div class="flex-1 min-w-0">
        <p class="text-[11px] font-bold text-wblue uppercase tracking-wider mb-0.5">Reminder</p>
        <p class="text-sm text-gray-800 dark:text-zinc-100 leading-snug">${_esc(text).replace(/\n/g, '<br>')}</p>
      </div>
      <button data-rem-close aria-label="Dismiss"
              class="flex-shrink-0 -mt-0.5 -mr-1 p-1 rounded
                     text-gray-300 hover:text-gray-600 dark:hover:text-zinc-300 transition">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="h-0.5 bg-gray-100 dark:bg-zinc-800 mx-4 mb-2 rounded-full overflow-hidden">
      <div data-rem-bar class="h-full bg-wblue rounded-full" style="width:100%"></div>
    </div>`;

  // Wire dismiss button without inline onclick (CSP-safe)
  const dismiss = () => {
    card.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateX(1rem)';
    setTimeout(() => card.remove(), 350);
  };
  card.querySelector('[data-rem-close]').addEventListener('click', dismiss);
  wrap.appendChild(card);

  // Animate the progress bar shrinking over durationMs
  const bar = card.querySelector('[data-rem-bar]');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${durationMs}ms linear`;
    bar.style.width = '0%';
  }));

  // Auto-dismiss
  const tid = setTimeout(dismiss, durationMs);
  card.querySelector('[data-rem-close]').addEventListener('click', () => clearTimeout(tid));
}

/** True when today is a valid firing date for this (potentially repeating) reminder. */
function _isReminderOccurrence(item) {
  const unit = item.repeat_unit || 'none';
  if (unit === 'none') return true;      // one-shot: fires daily at that time (existing behaviour)
  if (!item.date)      return true;      // no origin → treat as daily
  const now    = new Date(); now.setHours(0, 0, 0, 0);
  const origin = new Date(item.date + 'T00:00:00'); origin.setHours(0, 0, 0, 0);
  if (now < origin) return false;        // before start date
  const iv = item.repeat_interval || 1;
  if (unit === 'day') {
    return Math.round((now - origin) / 86400000) % iv === 0;
  }
  if (unit === 'week') {
    return Math.round((now - origin) / 86400000) % (iv * 7) === 0;
  }
  if (unit === 'month') {
    const months = (now.getFullYear() - origin.getFullYear()) * 12
                 + (now.getMonth() - origin.getMonth());
    return now.getDate() === origin.getDate() && months % iv === 0;
  }
  if (unit === 'year') {
    return now.getMonth()  === origin.getMonth()
        && now.getDate()   === origin.getDate()
        && (now.getFullYear() - origin.getFullYear()) % iv === 0;
  }
  return false;
}

function _checkReminderNotifications() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  document.querySelectorAll('[id^="reminder-list-"]').forEach(ul => {
    const wid   = ul.id.replace('reminder-list-', '');
    const items = _getReminderItems(wid);
    items.forEach(item => {
      const key = `${wid}-${today}-${item.time}`;
      if (item.time === hhmm && !_notifFired[key] && _isReminderOccurrence(item)) {
        _notifFired[key] = true;
        // BookWorm-styled in-page toast
        _showReminderToast(item.text);
        // Track in missed-reminder log so the bell badge reflects it
        _remLogMissed(item.text, item.time);
        // also try browser notification if permission already granted
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
          new Notification('🔔 Reminder', { body: item.text, icon: '/static/favicon.ico' });
      }
    });
  });
}

function reminderEnableNotifications(widgetId) {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      document.querySelectorAll('.rem-notif-btn').forEach(b => b.remove());
      setInterval(_checkReminderNotifications, 30_000);
      _checkReminderNotifications();
    }
  });
}

function _initReminderNotifications() {
  if (!('Notification' in window)) return;
  document.querySelectorAll('[id^="reminder-list-"]').forEach(ul => {
    const wid = ul.id.replace('reminder-list-', '');
    const hdr = document.getElementById(`wh-actions-${wid}`);
    if (!hdr || hdr.querySelector('.rem-notif-btn')) return;
    if (Notification.permission !== 'granted') {
      const btn = document.createElement('button');
      btn.className = 'rem-notif-btn p-1 rounded text-gray-400 hover:text-wblue'
                    + ' hover:bg-blue-50 dark:hover:bg-wblue/10 transition';
      btn.title   = Notification.permission === 'denied'
                    ? 'Notifications blocked — allow in browser settings'
                    : 'Enable reminder alerts';
      btn.innerHTML = '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"'
                    + ' stroke-width="2" aria-hidden="true"><path stroke-linecap="round"'
                    + ' stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0'
                    + ' 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67'
                    + ' 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6'
                    + ' 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>';
      if (Notification.permission !== 'denied')
        btn.onclick = () => reminderEnableNotifications(wid);
      hdr.prepend(btn);
    }
  });
  if (Notification.permission === 'granted') {
    setInterval(_checkReminderNotifications, 30_000);
    _checkReminderNotifications();
  }
}

// ── Todo helpers ─────────────────────────────────────────────────────────────────────

/** Compact view: toggle showing/hiding completed task rows. */
function todoToggleDone(wid) {
  const ul  = document.getElementById(`todo-list-${wid}`);
  const btn = document.getElementById(`todo-show-done-${wid}`);
  if (!ul) return;
  const show = ul.dataset.showDone !== 'true';
  ul.dataset.showDone = show;
  ul.querySelectorAll('.bw-done-item').forEach(li => li.classList.toggle('hidden', !show));
  if (btn) {
    const count = ul.querySelectorAll('.bw-done-item').length;
    btn.textContent = show
      ? `Hide completed (${count})`
      : `Show ${count} completed`;
  }
}

/** Full list: remove all completed tasks (server save + DOM refresh). */
async function todoClearDone(wid) {
  const items = _getTodoItems(wid).filter(it => !it.done);
  await _saveWidgetConfig(wid, { items });
  delete _todoData[wid];
  const ul    = document.getElementById(`todo-list-${wid}`);
  const style = ul?.dataset.style || 'list';
  if (ul) {
    ul.innerHTML = items.map((it, i) => _todoLiHtml(wid, it, i, style)).join('');
    style === 'compact' ? _todoUpdateCompact(wid) : _todoUpdateProgress(wid);
  }
}

/** Full list: open a styled confirmation modal before wiping. */
function todoClearAll(wid) {
  const modal = document.getElementById('todo-clear-all-modal');
  if (!modal) {
    if (confirm('Clear every task on this list? This cannot be undone.')) _doTodoClearAll(wid);
    return;
  }
  document.getElementById('tca-widget-id').value = wid;
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('tca-confirm-btn')?.focus(), 50);
}
function closeTodoClearAllModal() {
  document.getElementById('todo-clear-all-modal')?.classList.add('hidden');
}
async function _confirmTodoClearAll() {
  const wid = parseInt(document.getElementById('tca-widget-id').value, 10);
  closeTodoClearAllModal();
  await _doTodoClearAll(wid);
}
async function _doTodoClearAll(wid) {
  await _saveWidgetConfig(wid, { items: [] });
  delete _todoData[wid];
  const ul = document.getElementById(`todo-list-${wid}`);
  if (ul) {
    ul.innerHTML = `<li class="flex flex-col items-center justify-center py-4 text-center">`
      + `<span class="text-3xl mb-1">✨</span>`
      + `<span class="text-xs text-gray-400">No tasks yet — add one below!</span></li>`;
    _todoUpdateProgress(wid);
  }
}

/** Shared helper: render a single <li> html string for todo list/compact. */
function _todoLiHtml(wid, item, idx, style) {
  if (style === 'compact') {
    return `<li class="flex items-center gap-1.5 rounded pl-1 border-l-2 ${item.done
      ? 'bw-done-item border-wgreen' : 'border-wblue/40'}">`
      + `<input type="checkbox" id="todo-${wid}-${idx}"
           class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 w-3.5 h-3.5 cursor-pointer"
           ${item.done ? 'checked' : ''}
           onchange="todoToggle(${wid}, ${idx}, this.checked)">`
      + `<label for="todo-${wid}-${idx}"
             class="text-xs text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug">${_esc(item.text)}</label>`
      + `</li>`;
  }
  return `<li class="flex items-center gap-2 group/tdi rounded-lg px-1.5 py-1 hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition">`
    + `<input type="checkbox" id="todo-${wid}-${idx}"
         class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 cursor-pointer"
         ${item.done ? 'checked' : ''}
         onchange="todoToggle(${wid}, ${idx}, this.checked)">`
    + `<label for="todo-${wid}-${idx}"
           class="text-sm text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug
                  ${item.done ? 'line-through text-gray-400 dark:text-zinc-500' : ''}">${_esc(item.text)}</label>`
    + `<button onclick="todoDelete(${wid}, ${idx})" title="Remove task"
             class="opacity-0 group-hover/tdi:opacity-100 flex-shrink-0 p-0.5 rounded
                    text-gray-300 hover:text-wred transition" aria-label="Delete task">`
    + `<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">`
    + `<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button></li>`;
}

// ── Calendar day-detail popup ────────────────────────────────────────────────────

/** Open a popup showing all events & reminders that fall on `isoDate`. */
function calDayClick(isoDate) {
  let modal = document.getElementById('cal-day-modal');
  if (!modal) { modal = _calBuildDayModal(); document.body.appendChild(modal); }

  // ── Format heading ────────────────────────────────────────────────────
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dateObj = new Date(y, mo - 1, d);
  const heading = dateObj.toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  modal.querySelector('#cal-day-heading').textContent = heading;
  modal.dataset.isoDate = isoDate;

  // ── Gather events for this date ───────────────────────────────────────────────
  const storeEntries = (window._bwEventStore || {})[isoDate] || [];
  const eventsHtml = storeEntries.map(entry => {
    // find idx in the widget's item array by matching id
    const readFn = typeof _evtReadItems === 'function' ? _evtReadItems : () => [];
    const widItems = readFn(entry.wid);
    const idx = widItems.findIndex(it => it.id === entry.id);
    const btnBase = 'flex-shrink-0 p-1 rounded transition focus:outline-none focus:ring-2';
    const editBtn = idx >= 0
      ? `<button onclick="calCloseDayModal();evtOpenEdit(${entry.wid},${idx});"
           class="${btnBase} text-gray-400 hover:text-wblue focus:ring-wblue"
           title="Edit event" aria-label="Edit ${_esc(entry.text)}">
           <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round"
               d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                  m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
         </button>` : '';
    const delBtn = idx >= 0
      ? `<button onclick="calCloseDayModal();evtDelete(${entry.wid},${idx});"
           class="${btnBase} text-gray-400 hover:text-wred focus:ring-wred"
           title="Delete event" aria-label="Delete ${_esc(entry.text)}">
           <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0
               0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0
               00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
         </button>` : '';
    return `<div class="flex items-center gap-2 px-2.5 py-2 rounded-xl
                 border border-gray-100 dark:border-zinc-800
                 bg-white dark:bg-zinc-900 mb-1.5"
                 style="border-left:3px solid ${entry.color}">
      <span class="flex-1 text-xs font-semibold text-gray-800 dark:text-zinc-100 truncate">
        ${_esc(entry.text)}
      </span>
      ${editBtn}${delBtn}
    </div>`;
  }).join('');

  // ── Gather reminders for this date ─────────────────────────────────────────────
  let remindersHtml = '';
  document.querySelectorAll('[id^="reminder-list-"]').forEach(ul => {
    const wid   = ul.id.replace('reminder-list-', '');
    const items = _getReminderItems(wid);
    items.forEach((item, idx) => {
      if (item.date !== isoDate) return;
      const p      = _reminderTimePalette(item.time);
      const t12    = _fmt12h(item.time);
      const timeLbl = `${t12.h12}:${t12.mn} ${t12.ap}`;
      remindersHtml += `<div class="flex items-center gap-2 px-2.5 py-2 rounded-xl
          border border-gray-100 dark:border-zinc-800
          bg-white dark:bg-zinc-900 mb-1.5">
        <span class="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style="${p.pillst}">${_esc(timeLbl)}</span>
        <span class="flex-1 text-xs text-gray-800 dark:text-zinc-100 truncate">${_esc(item.text)}</span>
        <button onclick="calCloseDayModal();reminderDelete(${wid},${idx});"
            class="flex-shrink-0 p-1 rounded text-gray-400 hover:text-wred transition
                   focus:outline-none focus:ring-2 focus:ring-wred"
            title="Delete reminder" aria-label="Delete reminder: ${_esc(item.text)}">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0
              0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0
              00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>`;
    });
  });

  // ── Compose body ──────────────────────────────────────────────────────────────
  const body = modal.querySelector('#cal-day-body');
  if (!eventsHtml && !remindersHtml) {
    body.innerHTML = `<div class="flex flex-col items-center py-6 text-center">
      <span class="text-3xl mb-1.5">🌿</span>
      <span class="text-xs text-gray-400 dark:text-zinc-500">Nothing scheduled for this day</span>
    </div>`;
  } else {
    body.innerHTML =
      (eventsHtml ? `<p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Events</p>${eventsHtml}` : '') +
      (remindersHtml ? `<p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 ${eventsHtml ? 'mt-3' : ''}">Reminders</p>${remindersHtml}` : '');
  }

  // ── Pre-fill the "Add Event" date input ─────────────────────────────────────────
  const addEvtBtn = modal.querySelector('#cal-day-add-evt');
  const firstEvtWid = document.querySelector('[id^="evt-json-"]')?.id.replace('evt-json-','');
  if (addEvtBtn && firstEvtWid) {
    addEvtBtn.onclick = () => { calCloseDayModal(); evtOpenModalPrefilled(firstEvtWid, isoDate); };
    addEvtBtn.classList.remove('hidden');
  } else if (addEvtBtn) {
    addEvtBtn.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  setTimeout(() => modal.querySelector('#cal-day-close-btn')?.focus(), 50);
}

/** Pre-fill evtOpenModal with a specific date (convenience wrapper). */
function evtOpenModalPrefilled(wid, isoDate) {
  if (typeof evtOpenModal !== 'function') return;
  evtOpenModal(wid);
  // slight delay so the modal DOM is rendered before we write the date
  setTimeout(() => {
    const inp = document.getElementById('evt-f-date');
    if (inp) inp.value = isoDate;
  }, 30);
}

window.calCloseDayModal = function () {
  document.getElementById('cal-day-modal')?.classList.add('hidden');
};

function _calBuildDayModal() {
  const el = document.createElement('div');
  el.id = 'cal-day-modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cal-day-heading');
  el.className = 'hidden fixed inset-0 z-50 flex items-center justify-center p-4';
  el.setAttribute('onkeydown', "if(event.key==='Escape') calCloseDayModal()");
  el.innerHTML = `
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
         onclick="calCloseDayModal()" aria-hidden="true"></div>
    <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
                w-full max-w-sm p-6 flex flex-col max-h-[80vh]">

      <!-- Header -->
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-lg" aria-hidden="true">📅</span>
          <h2 id="cal-day-heading"
              class="text-sm font-bold text-gray-900 dark:text-zinc-100 leading-snug truncate"></h2>
        </div>
        <button id="cal-day-close-btn" onclick="calCloseDayModal()"
                class="flex-shrink-0 p-1 rounded-lg text-gray-400 hover:text-gray-700
                       dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800
                       transition focus:outline-none focus:ring-2 focus:ring-gray-300"
                aria-label="Close">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24"
               stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Scrollable body -->
      <div id="cal-day-body" class="flex-1 overflow-y-auto min-h-0 pr-0.5"></div>

      <!-- Footer -->
      <div class="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800 flex gap-2">
        <button id="cal-day-add-evt"
                class="hidden flex-1 text-xs py-1.5 rounded-lg border border-dashed
                       border-gray-300 dark:border-zinc-600
                       text-gray-400 dark:text-zinc-500
                       hover:border-wblue hover:text-wblue transition">+ Add Event</button>
        <button onclick="calCloseDayModal()"
                class="flex-1 text-xs py-1.5 rounded-lg border border-gray-300
                       dark:border-zinc-600 text-gray-600 dark:text-zinc-400
                       hover:bg-gray-50 dark:hover:bg-zinc-800 transition">Close</button>
      </div>
    </div>`;
  return el;
}

// ── Subscriptions Summary Widget ─────────────────────────────────────────────────────────────
// Shared chart lib promise — one lazy-load for all subs-summary widgets on the page.
var _subsWgtChartPromise = null;
// Per-widget data store: {list, summary, chart (Chart instance or null)}
var _subsWgtData = {};

function _subsWgtEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _subsWgtFaviconUrl(url) {
  if (!url) return null;
  try {
    var u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    var host = new URL(u).hostname;
    if (!host || host.indexOf('.') === -1) return null;
    return 'https://www.google.com/s2/favicons?domain=' +
           encodeURIComponent(host) + '&sz=32';
  } catch (e) { return null; }
}

function _subsWgtFmtMoney(val) {
  return '$' + (parseFloat(val) || 0).toFixed(2);
}

// Switch slides; persist choice to localStorage.
function _subsWgtGoTo(wid, idx) {
  var el = document.getElementById('subs-sw-' + wid);
  if (!el) return;
  var slides = el.querySelectorAll('.subs-sw-slide');
  var dots   = el.querySelectorAll('.subs-sw-dot');
  idx = ((idx % slides.length) + slides.length) % slides.length;
  slides.forEach(function(s, i) {
    s.style.display = (i === idx) ? 'flex' : 'none';
  });
  dots.forEach(function(d, i) {
    d.style.background = (i === idx) ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)';
  });
  localStorage.setItem('bw-subs-slide-' + wid, idx);
  // Lazy-render chart when switching to slide 1
  if (idx === 1) _subsWgtRenderChart(wid);
}

// Navigate relative to the current slide (+1 forward, -1 back, wraps).
// Used by click arrows so they don’t bake in a stale slide index at render time.
function _subsWgtNav(wid, dir) {
  var cur   = parseInt(localStorage.getItem('bw-subs-slide-' + wid) || '0', 10) || 0;
  var el    = document.getElementById('subs-sw-' + wid);
  var count = (el ? el.querySelectorAll('.subs-sw-slide').length : 0) || 2;
  _subsWgtGoTo(wid, (cur + dir + count) % count);
}

function _subsWgtRenderChart(wid) {
  var canvas = document.getElementById('subs-sw-canvas-' + wid);
  if (!canvas) return;
  var store = _subsWgtData[wid];
  if (!store || !store.summary) return;
  // Destroy old chart instance if re-rendering
  if (store.chart) { store.chart.destroy(); store.chart = null; }

  var cats = store.summary.by_category || [];
  if (!cats.length) {
    canvas.parentNode.innerHTML =
      '<p class="text-xs text-gray-400 dark:text-zinc-500 text-center py-4">No data yet.</p>';
    return;
  }

  var labels = cats.map(function(c) { return c.category || 'Other'; });
  var values = cats.map(function(c) { return c.monthly_total; });
  var palette = ['#0053e2','#ffc220','#2a8703','#ea1100','#995213',
                 '#0ea5e9','#a855f7','#ec4899','#f97316','#14b8a6'];
  var bgColors = labels.map(function(_, i) { return palette[i % palette.length]; });

  // Lazy-load Chart.js vendor bundle, then draw
  if (!_subsWgtChartPromise) {
    _subsWgtChartPromise = new Promise(function(resolve, reject) {
      if (window.Chart) { resolve(); return; }
      var s = document.createElement('script');
      s.src = '/static/js/vendor/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _subsWgtChartPromise.then(function() {
    var c = document.getElementById('subs-sw-canvas-' + wid);
    if (!c || !window.Chart) return;
    var total = store.summary ? store.summary.monthly_total || 0 : 0;
    var centerLabelPlugin = {
      id: 'centerLabel-' + wid,
      afterDraw: function(chart) {
        var ctx2 = chart.ctx;
        var cx = chart.chartArea ? (chart.chartArea.left + chart.chartArea.right) / 2 : 0;
        var cy = chart.chartArea ? (chart.chartArea.top  + chart.chartArea.bottom) / 2 : 0;
        ctx2.save();
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillStyle = 'rgba(241,245,249,0.95)';
        ctx2.font = 'bold 13px sans-serif';
        ctx2.fillText('$' + (total).toFixed(2), cx, cy - 5);
        ctx2.fillStyle = 'rgba(148,163,184,0.7)';
        ctx2.font = '9px sans-serif';
        ctx2.fillText('/mo', cx, cy + 9);
        ctx2.restore();
      }
    };
    store.chart = new window.Chart(c, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: values, backgroundColor: bgColors,
                borderWidth: 2, borderColor: 'rgba(15,23,42,0.8)' }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { display: true, position: 'right',
            labels: { boxWidth: 8, boxHeight: 8, font: { size: 9 }, padding: 4,
                      color: 'rgba(148,163,184,0.9)' } },
          tooltip: {
            callbacks: { label: function(ctx) {
              return ' $' + (ctx.raw || 0).toFixed(2) + '/mo';
            }}
          }
        }
      },
      plugins: [centerLabelPlugin]
    });
  }).catch(function(e) {
    console.error('[subs-widget] Chart.js vendor bundle load failed:', e);
  });
}

function _subsWgtGradient(hex) {
  // Layer a subtle depth vignette over a flat color base — works for any hue.
  return 'linear-gradient(135deg,rgba(0,0,0,0.18) 0%,rgba(255,255,255,0.04) 50%,rgba(0,0,0,0.12) 100%),' + hex;
}

function _subsWgtRender(el, list, summary) {
  var wid = el.dataset.widgetId;
  var pid = el.dataset.pageId;
  var savedSlide = parseInt(localStorage.getItem('bw-subs-slide-' + wid) || '0', 10) || 0;

  // Cache data for chart rendering
  _subsWgtData[wid] = { list: list, summary: summary, chart: null };

  // ── Glassmorphism dark skin ──────────────────────────────────────────────
  var _card = el.closest ? el.closest('.hw-card') : null;
  var _cfg  = {};
  try { _cfg = JSON.parse(_card ? _card.dataset.widgetConfig || '{}' : '{}'); } catch(e) {}
  var bgHex = _cfg.bg_color || '#1a2b3c';
  el.style.background   = _subsWgtGradient(bgHex);
  el.style.borderRadius = '10px';
  el.style.overflow     = 'hidden';

  var activeRows = (list || []).filter(function(s) { return s.active; });
  var overflow   = Math.max(0, activeRows.length - 5);
  var topRows    = activeRows.slice(0, 5);

  // ── Hero monthly total ───────────────────────────────────────────────────
  var heroHtml =
    '<div style="text-align:center;padding:5px 0 7px;">'
    + '<p style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;'
      + 'color:rgba(148,163,184,0.7);margin:0 0 2px;">Monthly</p>'
    + '<p style="font-size:22px;font-weight:800;line-height:1;color:#f1f5f9;'
      + 'letter-spacing:-0.5px;margin:0;">'
      + _subsWgtFmtMoney(summary.monthly_total)
    + '</p>'
  + '</div>';

  // ── Slide 0: subscription list ────────────────────────────────
  var rowsHtml = topRows.length ? topRows.map(function(s) {
    var color = s.color || '#0053e2';
    var faviconUrl = _subsWgtFaviconUrl(s.website_url || '');
    var iconHtml = faviconUrl
      ? '<img src="' + faviconUrl + '" width="18" height="18" alt=""'
        + ' style="flex-shrink:0;border-radius:4px;"'
        + ' onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\';">'
        + '<span style="width:18px;height:18px;border-radius:4px;display:none;flex-shrink:0;'
          + 'align-items:center;justify-content:center;font-size:10px;font-weight:700;'
          + 'color:#fff;background:' + _subsWgtEsc(color) + ';">'
          + _subsWgtEsc((s.name || '?').charAt(0).toUpperCase()) + '</span>'
      : '<span style="width:18px;height:18px;border-radius:4px;flex-shrink:0;display:flex;'
          + 'align-items:center;justify-content:center;font-size:10px;font-weight:700;'
          + 'color:#fff;background:' + _subsWgtEsc(color) + ';">'
          + _subsWgtEsc((s.name || '?').charAt(0).toUpperCase()) + '</span>';
    return '<div style="display:flex;align-items:center;gap:7px;padding:3px 4px 3px 6px;'
      + 'border-left:3px solid ' + _subsWgtEsc(color) + ';'
      + 'border-radius:0 4px 4px 0;margin-bottom:3px;min-width:0;'
      + 'background:rgba(255,255,255,0.04);">'
      + iconHtml
      + '<span style="font-size:11px;font-weight:600;flex:1;white-space:nowrap;'
        + 'overflow:hidden;text-overflow:ellipsis;color:#e2e8f0;">'
        + _subsWgtEsc(s.name) + '</span>'
      + '<span style="font-size:10px;color:rgba(148,163,184,0.85);white-space:nowrap;padding-left:4px;">'
        + _subsWgtEsc(s.currency) + '\u00a0' + (s.amount || 0).toFixed(2)
      + '</span>'
    + '</div>';
  }).join('')
  : '<p style="font-size:11px;color:rgba(148,163,184,0.5);text-align:center;padding:10px 0;">No active subscriptions.</p>';

  var overflowHtml = overflow > 0
    ? '<p style="font-size:9px;color:rgba(148,163,184,0.45);text-align:right;margin-top:2px;">+ '
      + overflow + ' more</p>' : '';

  var slide0 = '<div class="subs-sw-slide" '
    + 'style="display:' + (savedSlide === 0 ? 'flex' : 'none')
    + ';flex-direction:column;flex:1;overflow:hidden;padding:0 2px;">'
    + heroHtml + rowsHtml + overflowHtml
    + '</div>';

  // ── Slide 1: donut chart ───────────────────────────────────
  var slide1 = '<div class="subs-sw-slide"'
    + ' style="display:' + (savedSlide === 1 ? 'flex' : 'none')
    + ';flex-direction:column;flex:1;min-height:0;">'
    + '<div style="position:relative;height:130px;flex-shrink:0;">'
      + '<canvas id="subs-sw-canvas-' + wid + '"></canvas>'
    + '</div>'
    + '</div>';

  // ── Footer: totals + dots + page link ──────────────────────────
  var dotsHtml = [0, 1].map(function(i) {
    return '<span class="subs-sw-dot" onclick="_subsWgtGoTo(' + wid + ',' + i + ')" '
      + 'style="display:inline-block;width:6px;height:6px;border-radius:50%;cursor:pointer;'
      + 'background:' + (i === savedSlide ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)') + ';"></span>';
  }).join('');

  var footer = '<div style="flex-shrink:0;padding:6px 2px 2px;border-top:1px solid rgba(255,255,255,0.07);">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;">'
      + '<span style="font-size:10px;color:rgba(148,163,184,0.6);">'
        + _subsWgtFmtMoney(summary.yearly_total) + '/yr'
      + '</span>'
      + '<span style="display:flex;gap:5px;align-items:center;">' + dotsHtml + '</span>'
      + '<button onclick="openHomePage(' + pid + ')" '
        + 'style="font-size:10px;color:rgba(147,197,253,0.85);background:none;border:none;cursor:pointer;'
        + 'padding:0;text-decoration:underline;text-underline-offset:2px;">'
        + 'Open \u2192</button>'
    + '</div>'
  + '</div>';

  el.innerHTML = '<div id="subs-sw-' + wid + '" '
    + 'style="display:flex;flex-direction:column;height:100%;padding:6px 8px 4px;">'
    + slide0 + slide1 + footer
    + '</div>';

  // Draw chart if starting on slide 1
  if (savedSlide === 1) _subsWgtRenderChart(wid);

  // ── Touch swipe + mouse drag-to-swipe ──────────────────────────────────────
  // Guard: only bind once per element even if _subsWgtRender is called again.
  if (!el.dataset.swipeInited) {
    el.dataset.swipeInited = '1';

    // ─ Touch (mobile / touchpad) ──────────────────────────────────────────
    var _swStartX = null;
    var _swStartY = null;
    el.addEventListener('touchstart', function(e) {
      _swStartX = e.touches[0].clientX;
      _swStartY = e.touches[0].clientY;
    }, {passive: true});
    el.addEventListener('touchend', function(e) {
      if (_swStartX === null) return;
      var dx = e.changedTouches[0].clientX - _swStartX;
      var dy = e.changedTouches[0].clientY - _swStartY;
      _swStartX = null; _swStartY = null;
      if (Math.abs(dy) > Math.abs(dx)) return;  // vertical scroll intent
      if (Math.abs(dx) < 30) return;
      _subsWgtNav(wid, dx < 0 ? 1 : -1);
    }, {passive: true});

    // ─ Mouse drag (desktop) ──────────────────────────────────────────
    // mouseup is on document so releasing outside the card still triggers.
    var _mouseX = 0;
    el.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;  // left-click only
      _mouseX = e.clientX;
      function onUp(ev) {
        document.removeEventListener('mouseup', onUp);
        // Don’t swipe in widget-edit (stack) mode
        var grid = document.querySelector('[id^="widget-grid-"]');
        if (grid && grid.dataset.stackMode === 'true') return;
        var dx = ev.clientX - _mouseX;
        if (dx < -40) _subsWgtNav(wid, 1);
        if (dx >  40) _subsWgtNav(wid, -1);
      }
      document.addEventListener('mouseup', onUp);
    });
  }
}

function _loadSubscriptionsSummary(el) {
  var pid = el.dataset.pageId;
  if (!pid || pid === '0') return; // unconfigured — placeholder shown by template

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;justify-content:center;height:100%;'
    + 'font-size:11px;color:#9ca3af;">'
    + '<div style="width:14px;height:14px;border-radius:50%;border:2px solid #0053e2;'
    + 'border-top-color:transparent;animation:spin 0.8s linear infinite;"></div>'
    + 'Loading…</div>';

  Promise.all([
    fetch('/home/subscriptions/' + pid + '/list',
      {credentials: 'same-origin'}).then(function(r) { return r.json(); }),
    fetch('/home/subscriptions/' + pid + '/summary',
      {credentials: 'same-origin'}).then(function(r) { return r.json(); }),
  ]).then(function(results) {
    _subsWgtRender(el, results[0], results[1]);
  }).catch(function(e) {
    console.error('[subs-widget] failed to load data:', e);
    el.innerHTML =
      '<p style="font-size:11px;color:#ef4444;text-align:center;padding:16px;">'
      + 'Failed to load.</p>';
  });
}
