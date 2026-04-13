// home-page-crm-slash.js
// Slash-command palette for text inputs in the CRM contact modal.
// Call _crmAttachSlash(formEl) after the modal is shown.
// No backend calls — all commands are client-side transformations.
'use strict';

// ── Command definitions ───────────────────────────────────────────────────────
var _CRM_SLASH_CMDS = [
  {
    cmd: 'today',
    icon: '📅',
    label: 'Insert today\'s date',
    value: function() {
      var d = new Date();
      return d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
    },
  },
  {
    cmd: 'now',
    icon: '🕐',
    label: 'Insert date & time',
    value: function() {
      var d = new Date();
      return d.toLocaleString('en-US', {
        year:'numeric', month:'short', day:'numeric',
        hour:'2-digit', minute:'2-digit',
      });
    },
  },
  {
    cmd: 'year',
    icon: '📆',
    label: 'Insert current year',
    value: function() { return String(new Date().getFullYear()); },
  },
  {
    cmd: 'me',
    icon: '👤',
    label: 'Insert my name',
    value: function() {
      // Pull from the logged-in user badge in the nav if present
      var el = document.getElementById('bw-username') ||
               document.querySelector('[data-username]');
      return el ? (el.dataset.username || el.textContent.trim()) : '';
    },
  },
  {
    cmd: 'clear',
    icon: '🗑',
    label: 'Clear this field',
    value: function() { return ''; },
  },
  {
    cmd: 'na',
    icon: '—',
    label: 'Mark as N/A',
    value: function() { return 'N/A'; },
  },
  {
    cmd: 'tbd',
    icon: '⏳',
    label: 'Mark as TBD',
    value: function() { return 'TBD'; },
  },
];

// ── Module state ──────────────────────────────────────────────────────────────
var _slashPalette  = null; // current floating palette el
var _slashTarget   = null; // input/textarea the palette is anchored to
var _slashCursor   = -1;   // keyboard cursor index

// ── Attach to a form ──────────────────────────────────────────────────────────
function _crmAttachSlash(formEl) {
  if (!formEl) return;
  // Attach to all editable text-like inputs + textareas
  var fields = formEl.querySelectorAll(
    'input[type=text], input[type=email], input[type=tel], input[type=url], ' +
    'input[type=number], textarea'
  );
  fields.forEach(function(el) {
    el.addEventListener('input',   _slashOnInput);
    el.addEventListener('keydown', _slashOnKeydown);
    el.addEventListener('blur',    function() {
      // small delay so click on palette registers first
      setTimeout(_slashHide, 150);
    });
  });
}

// ── Input handler ─────────────────────────────────────────────────────────────
function _slashOnInput(e) {
  var el  = e.target;
  var val = el.value;
  // Show palette when the entire value starts with '/'
  if (val.startsWith('/')) {
    var query = val.slice(1).toLowerCase();
    var matches = _CRM_SLASH_CMDS.filter(function(c) {
      return c.cmd.startsWith(query) || c.label.toLowerCase().includes(query);
    });
    if (matches.length) {
      _slashShow(el, matches);
    } else {
      _slashHide();
    }
  } else {
    _slashHide();
  }
}

// ── Keyboard navigation ───────────────────────────────────────────────────────
function _slashOnKeydown(e) {
  if (!_slashPalette) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _slashCursor = Math.min(_slashCursor + 1, _slashPalette._cmds.length - 1);
    _slashHighlight();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _slashCursor = Math.max(_slashCursor - 1, 0);
    _slashHighlight();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (_slashCursor >= 0 && _slashPalette._cmds[_slashCursor]) {
      e.preventDefault();
      _slashApply(_slashTarget, _slashPalette._cmds[_slashCursor]);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    _slashHide();
  }
}

// ── Show palette ──────────────────────────────────────────────────────────────
function _slashShow(inputEl, cmds) {
  _slashTarget = inputEl;
  _slashCursor = cmds.length === 1 ? 0 : -1;

  if (!_slashPalette) {
    _slashPalette = document.createElement('div');
    _slashPalette.id = 'crm-slash-palette';
    _slashPalette.className =
      'fixed z-[200] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 ' +
      'rounded-xl shadow-xl py-1 min-w-[220px] max-w-[320px] overflow-y-auto max-h-52';
    document.body.appendChild(_slashPalette);
  }
  _slashPalette._cmds = cmds;

  // Position below the input (fixed → viewport coords, no scroll offset)
  var rect = inputEl.getBoundingClientRect();
  _slashPalette.style.top  = (rect.bottom + 4) + 'px';
  _slashPalette.style.left = rect.left + 'px';
  _slashPalette.style.display = 'block';

  _slashPalette.innerHTML = cmds.map(function(c, i) {
    return '<div class="slash-item flex items-center gap-2.5 px-3 py-2 cursor-pointer ' +
           'hover:bg-blue-50 dark:hover:bg-zinc-800 transition text-sm" ' +
           'data-idx="' + i + '" onmousedown="event.preventDefault();_slashApply(_slashTarget,_slashPalette._cmds[' + i + '])">' +
           '<span class="text-base leading-none">' + c.icon + '</span>' +
           '<div class="flex-1 min-w-0">' +
           '<span class="font-mono text-[#0053e2] dark:text-blue-400 text-xs font-semibold">/' + c.cmd + '</span>' +
           '<span class="text-gray-500 dark:text-zinc-400 text-xs ml-2">' + c.label + '</span>' +
           '</div></div>';
  }).join('');

  _slashHighlight();
}

function _slashHighlight() {
  if (!_slashPalette) return;
  _slashPalette.querySelectorAll('.slash-item').forEach(function(el, i) {
    if (i === _slashCursor) {
      el.classList.add('bg-blue-50', 'dark:bg-zinc-800');
    } else {
      el.classList.remove('bg-blue-50', 'dark:bg-zinc-800');
    }
  });
}

// ── Apply a command ───────────────────────────────────────────────────────────
function _slashApply(el, cmd) {
  if (!el || !cmd) return;
  var result = typeof cmd.value === 'function' ? cmd.value() : cmd.value;
  el.value = result;
  // Fire an input event so any listeners (e.g. form validation) pick up the change
  el.dispatchEvent(new Event('input', { bubbles: true }));
  _slashHide();
  el.focus();
}

// ── Hide palette ──────────────────────────────────────────────────────────────
function _slashHide() {
  if (_slashPalette) _slashPalette.style.display = 'none';
  _slashTarget = null;
  _slashCursor = -1;
}
