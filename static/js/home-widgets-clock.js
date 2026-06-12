/* home-widgets-clock.js — Clock rendering engine for BookWorm home widgets */
'use strict';

// ── Clock ─────────────────────────────────────────────────────────────────────
const _clkIntervals = {};

/** Returns a greeting string + emoji based on the hour (0–23). */
function _clockGreeting(h) {
  if (h >= 5  && h < 12) return '🌅 Good morning';
  if (h >= 12 && h < 17) return '☀️ Good afternoon';
  if (h >= 17 && h < 21) return '🌆 Good evening';
  return '🌙 Good night';
}

/** Returns a short timezone label, e.g. "CDT", "UTC+5:30", or "". */
function _tzLabel(tz) {
  if (!tz || tz === 'local') return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

function _startClock(el) {
  const rawId  = el.id.replace('clock-', '');
  const tz     = el.dataset.tz     || 'local';
  const fmt    = el.dataset.format  || '12h';
  const pad    = n => String(n).padStart(2, '0');

  // Digital clock uses clock-hm-{id} + clock-sec-{id}.
  // Minimal clock still uses a single clock-time-{id} span.
  const hmEl    = document.getElementById(`clock-hm-${rawId}`);
  const secEl   = document.getElementById(`clock-sec-${rawId}`);
  const timeEl  = document.getElementById(`clock-time-${rawId}`);   // minimal only
  const ampmEl  = document.getElementById(`clock-ampm-${rawId}`);
  const dateEl  = document.getElementById(`clock-date-${rawId}`);
  const greetEl = document.getElementById(`clock-greet-${rawId}`);
  const tzEl    = document.getElementById(`clock-tz-${rawId}`);

  if (tzEl) tzEl.textContent = _tzLabel(tz);

  const tick = () => {
    const now = tz === 'local'
      ? new Date()
      : new Date(new Date().toLocaleString('en-US', { timeZone: tz }));

    const h24 = now.getHours();
    const m   = now.getMinutes();
    const s   = now.getSeconds();

    if (fmt === '12h') {
      const h12 = h24 % 12 || 12;
      if (hmEl)   hmEl.textContent  = `${pad(h12)}:${pad(m)}`;
      if (secEl)  secEl.textContent = `:${pad(s)}`;
      if (timeEl) timeEl.textContent = `${pad(h12)}:${pad(m)}:${pad(s)} `; // minimal
      if (ampmEl) ampmEl.textContent = h24 < 12 ? 'AM' : 'PM';
    } else {
      if (hmEl)   hmEl.textContent  = `${pad(h24)}:${pad(m)}`;
      if (secEl)  secEl.textContent = `:${pad(s)}`;
      if (timeEl) timeEl.textContent = `${pad(h24)}:${pad(m)}:${pad(s)}`; // minimal
      if (ampmEl) ampmEl.textContent = '';
    }

    if (dateEl)  dateEl.textContent  = now.toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric' });
    if (greetEl) greetEl.textContent = _clockGreeting(h24);
  };

  tick();
  if (_clkIntervals[rawId]) clearInterval(_clkIntervals[rawId]);
  _clkIntervals[rawId] = setInterval(tick, 1000);
}

function _startAnalogClock(canvas) {
  const rawId = canvas.id.replace('analog-clock-', '');
  const tz    = canvas.dataset.tz || 'local';
  const ctx   = canvas.getContext('2d');
  const size  = canvas.width;
  const cx    = size / 2;
  const cy    = size / 2;
  const r     = cx - 6;

  const tick = () => {
    const now = tz === 'local'
      ? new Date()
      : new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
    const dark = document.documentElement.classList.contains('dark');

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);

    // Face
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fillStyle   = dark ? '#27272a' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = dark ? '#3f3f46' : '#e5e7eb';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Hour markers
    for (let i = 0; i < 12; i++) {
      const a     = (i / 12) * 2 * Math.PI;
      const major = i % 3 === 0;
      const dotR  = major ? 3 : 1.5;
      const dist  = r - 10;
      ctx.beginPath();
      ctx.arc(Math.sin(a) * dist, -Math.cos(a) * dist, dotR, 0, 2 * Math.PI);
      ctx.fillStyle = dark
        ? (major ? '#a1a1aa' : '#52525b')
        : (major ? '#6b7280' : '#d1d5db');
      ctx.fill();
    }

    // Hands
    const secs  = now.getSeconds()  + now.getMilliseconds() / 1000;
    const mins  = now.getMinutes()  + secs / 60;
    const hours = now.getHours() % 12 + mins / 60;

    const drawHand = (angleFraction, length, width, color, cap = 0) => {
      const a = angleFraction * 2 * Math.PI;
      ctx.beginPath();
      if (cap > 0) ctx.moveTo(-Math.sin(a) * cap, Math.cos(a) * cap);
      else         ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * length, -Math.cos(a) * length);
      ctx.strokeStyle = color;
      ctx.lineWidth   = width;
      ctx.lineCap     = 'round';
      ctx.stroke();
    };

    drawHand(hours / 12, r * 0.50, 4,   dark ? '#e4e4e7' : '#1e3a5f');
    drawHand(mins  / 60, r * 0.72, 2.5, dark ? '#a1a1aa' : '#0053e2');
    const sFrac = secs / 60;
    drawHand(sFrac, r * 0.82, 1.5, '#ea1100', r * 0.18);

    // Center cap
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ea1100';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = dark ? '#27272a' : '#ffffff';
    ctx.fill();

    ctx.restore();

    const greetEl = document.getElementById(`clock-greet-${rawId}`);
    const dateEl  = document.getElementById(`clock-date-${rawId}`);
    if (greetEl) greetEl.textContent = _clockGreeting(now.getHours());
    if (dateEl)  dateEl.textContent  = now.toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric' });
  };

  tick();
  if (_clkIntervals['a' + rawId]) clearInterval(_clkIntervals['a' + rawId]);
  _clkIntervals['a' + rawId] = setInterval(tick, 100);
}
