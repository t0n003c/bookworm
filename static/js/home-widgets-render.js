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
  try {
    const res  = await fetch(
      `/home/weather?${new URLSearchParams({ loc, unit })}`,
      { credentials: 'same-origin' },
    );
    const data = await res.json();
    if (!res.ok) {
      el.textContent = data.error === 'location_not_found'
        ? '⚠️ Location not found'
        : '⚠️ Could not load weather';
      return;
    }
    const { name, admin1, current: cur, daily: days } = data;
    const temp = Math.round(cur.temperature_2m);
    const code = cur.weathercode;
    const icon = _wmoIcon[code] || '🌡️';
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
        <span>${_wmoIcon[dc] || '🌡️'}</span>
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
        <p>💨 ${Math.round(cur.windspeed_10m)} mph</p>
        <p>💧 ${cur.relativehumidity_2m}%</p>
      </div>
    </div>
    <div class="border-t border-gray-100 dark:border-zinc-800 pt-2 space-y-1.5">${dayRows}</div>`;
  } catch (err) {
    console.error('[weather]', err);
    el.textContent = '⚠️ Could not load weather';
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
      const isToday = d === today;
      const isPast  = (offset === 0) && d < today;
      cells += `<div class="w-5 h-5 flex items-center justify-center text-[10px] rounded-full
        ${isToday
          ? 'bg-wblue text-white font-bold'
          : isPast
            ? 'text-gray-300 dark:text-zinc-600'
            : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
        } cursor-default select-none">${d}</div>`;
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
    let cls = 'h-7 flex items-center justify-center text-xs rounded-lg select-none cursor-default ';
    if (isToday) {
      cls += 'bg-wblue text-white font-bold shadow-sm';
    } else if (isPast) {
      cls += 'text-gray-300 dark:text-zinc-600';
    } else if (isWeekend) {
      cls += 'text-wred/80 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium';
    } else {
      cls += 'text-gray-700 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800';
    }
    grid += `<div class="${cls}">${d}</div>`;
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
    // update done badge
    const badge   = document.getElementById(`todo-done-${wid}`);
    const allLis  = Array.from(ul.querySelectorAll('li'));
    const doneN   = allLis.filter(l => l.querySelector('input')?.checked).length;
    if (badge) { badge.textContent = `${doneN} done ✓`; badge.classList.toggle('hidden', doneN === 0); }
  } else {
    label?.classList.toggle('line-through', done);
    label?.classList.toggle('text-gray-400', done);
    label?.classList.toggle('dark:text-zinc-500', done);
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
    const idx = items.length - 1;
    const li  = document.createElement('li');
    if (compact) {
      li.className = 'flex items-center gap-1.5';
      li.innerHTML = `<input type="checkbox" id="todo-${wid}-${idx}"
        class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0 w-3.5 h-3.5"
        onchange="todoToggle(${wid}, ${idx}, this.checked)">
        <label for="todo-${wid}-${idx}"
               class="text-xs text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer leading-snug">${_esc(text)}</label>`;
    } else {
      li.className = 'flex items-center gap-2';
      li.innerHTML = `<input type="checkbox" id="todo-${wid}-${idx}"
        class="rounded border-gray-300 text-wblue focus:ring-wblue flex-shrink-0"
        onchange="todoToggle(${wid}, ${idx}, this.checked)">
        <label for="todo-${wid}-${idx}"
               class="text-sm text-gray-700 dark:text-zinc-300 flex-1 cursor-pointer">${_esc(text)}</label>`;
    }
    ul.appendChild(li);
  }
}

// ── Reminder ──────────────────────────────────────────────────────────────────────────
const _reminderData = {};

function _getReminderItems(wid) {
  if (!_reminderData[wid]) {
    _reminderData[wid] = Array.from(
      document.querySelectorAll(`#reminder-list-${wid} li`)
    ).map(li => ({
      time: li.dataset.time || li.querySelector('span')?.textContent?.trim() || '',
      text: li.querySelector('span:nth-child(2), .text-sm')?.textContent?.trim() || '',
    }));
  }
  return _reminderData[wid];
}

async function reminderAdd(wid, input) {
  const text = input?.value?.trim();
  const time = document.getElementById(`rem-time-${wid}`)?.value || '00:00';
  if (!text) return;
  const items = _getReminderItems(wid);
  items.push({ time, text });
  items.sort((a, b) => a.time.localeCompare(b.time));
  await _saveWidgetConfig(wid, { items });
  input.value = '';

  // Re-render the full list so sort order and indices stay accurate
  const ul    = document.getElementById(`reminder-list-${wid}`);
  const style = ul?.dataset.style || 'list';
  if (!ul) return;
  delete _reminderData[wid];
  ul.innerHTML = items.map((item, i) =>
    style === 'agenda' ? _reminderAgendaLi(wid, item, i, i === items.length - 1)
                       : _reminderListLi(wid, item, i)
  ).join('');
}

async function reminderDelete(wid, idx) {
  const items = _getReminderItems(wid);
  items.splice(idx, 1);
  await _saveWidgetConfig(wid, { items });
  delete _reminderData[wid];
  const ul    = document.getElementById(`reminder-list-${wid}`);
  const style = ul?.dataset.style || 'list';
  if (!ul) return;
  ul.innerHTML = items.map((item, i) =>
    style === 'agenda' ? _reminderAgendaLi(wid, item, i, i === items.length - 1)
                       : _reminderListLi(wid, item, i)
  ).join('');
}

function _reminderListLi(wid, item, i) {
  return `<li class="flex items-start gap-2 group/rem">
    <span class="text-xs font-mono text-wblue bg-blue-50 dark:bg-blue-900/20
                 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">${_esc(item.time)}</span>
    <span class="text-sm text-gray-700 dark:text-zinc-300 flex-1 leading-snug">${_esc(item.text)}</span>
    <button onclick="reminderDelete(${wid}, ${i})"
            class="opacity-0 group-hover/rem:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition flex-shrink-0"
            aria-label="Delete">
      <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button></li>`;
}

function _reminderAgendaLi(wid, item, i, isLast) {
  const spine = isLast ? '' : '<div class="w-0.5 flex-1 bg-gray-200 dark:bg-zinc-700 mt-0.5"></div>';
  return `<li class="relative flex gap-2.5 group/rem pl-1" data-time="${_esc(item.time)}">
    <div class="flex flex-col items-center flex-shrink-0">
      <div class="w-2 h-2 rounded-full bg-wblue dark:bg-blue-400 mt-1.5 flex-shrink-0
                  ring-2 ring-white dark:ring-zinc-900"></div>${spine}
    </div>
    <div class="flex-1 bg-gray-50 dark:bg-zinc-800 rounded-lg px-2.5 py-1.5 mb-0.5">
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm text-gray-800 dark:text-zinc-100 flex-1 leading-snug">${_esc(item.text)}</span>
        <button onclick="reminderDelete(${wid}, ${i})"
                class="opacity-0 group-hover/rem:opacity-100 p-0.5 text-gray-400 hover:text-red-500
                       transition flex-shrink-0 mt-0.5" aria-label="Delete">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <span class="text-[10px] font-mono text-wblue dark:text-blue-400 tabular-nums">${_esc(item.time)}</span>
    </div></li>`;
}

// ── Reminder Notifications ───────────────────────────────────────────────────────────────
const _notifFired = {}; // key: `${wid}-${date}-${time}` → true

function _checkReminderNotifications() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const hhmm  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  document.querySelectorAll('[id^="reminder-list-"]').forEach(ul => {
    const wid = ul.id.replace('reminder-list-', '');
    const items = _getReminderItems(wid);
    items.forEach(item => {
      const key = `${wid}-${today}-${item.time}`;
      if (item.time === hhmm && !_notifFired[key]) {
        _notifFired[key] = true;
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
