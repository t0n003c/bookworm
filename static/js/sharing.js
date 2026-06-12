/**
 * sharing.js — share UI for BookWorm (user-to-user copy + public links).
 *
 * Loaded via base.html <script defer>. Uses var throughout (project convention).
 * Never uses let/const at module level to survive future HTMX re-injection.
 */

/* ── Module state ─────────────────────────────────────────────────────────── */
var _shareModalCurrentType = null;   // 'note' | 'db_card'
var _shareModalCurrentId   = null;
var _shareSearchTimer      = null;   // debounce handle

/* ── Modal open / close ──────────────────────────────────────────────────── */

function shareOpenModal(type, id) {
  _shareModalCurrentType = type;
  _shareModalCurrentId   = id;

  var endpoint = type === 'note'
    ? '/share/modal/note/' + id
    : '/share/modal/db-card/' + id;

  // Try note_form container first; fall back to db-card detail panel container.
  var container = document.getElementById('share-modal-container')
    || document.getElementById('share-modal-container-card');

  if (!container) {
    // Dynamically create a body-level container as last resort.
    container = document.createElement('div');
    container.id = 'share-modal-container-body';
    document.body.appendChild(container);
  }

  fetch(endpoint, { headers: { 'HX-Request': 'true' } })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      container.innerHTML = html;
      // Focus the search input for keyboard users.
      var inp = document.getElementById('share-user-search');
      if (inp) setTimeout(function() { inp.focus(); }, 80);
    })
    .catch(function() {
      shareShowToast('Could not open share panel.', true);
    });
}

function shareCloseModal() {
  var overlay = document.getElementById('share-modal-overlay');
  if (overlay) overlay.parentElement.innerHTML = '';
  // Also clear any body-level container
  var bc = document.getElementById('share-modal-container-body');
  if (bc) bc.innerHTML = '';
  _shareSearchTimer = null;
}

/* ── User search ─────────────────────────────────────────────────────────── */

function shareSearchUsers(query) {
  clearTimeout(_shareSearchTimer);
  if (!query || query.length < 2) {
    var r = document.getElementById('share-user-results');
    if (r) r.innerHTML = '';
    return;
  }
  _shareSearchTimer = setTimeout(function() {
    fetch('/share/users/search?q=' + encodeURIComponent(query))
      .then(function(r) { return r.json(); })
      .then(function(users) {
        var container = document.getElementById('share-user-results');
        if (!container) return;
        if (!users.length) {
          container.innerHTML =
            '<p"text-xs text-gray-400 dark:text-zinc-500 px-1 py-1 italic">No users found.</p>';
          return;
        }
        var html = '';
        for (var i = 0; i < users.length; i++) {
          var u = users[i];
          html +=
            '<div role="listitem"'
            + ' class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg'
            + ' hover:bg-gray-50 dark:hover:bg-zinc-800 transition">'
            + '<span class="text-sm text-gray-800 dark:text-zinc-200">'
            + _shareEsc(u.username) + '</span>'
            + '<button type="button"'
            + ' onclick="shareSendCopy(' + u.id + ', \'' + _shareEsc(u.username) + '\')"'
            + ' class="text-xs px-2.5 py-1 rounded-lg bg-[#0053e2] text-white font-semibold'
            + ' hover:bg-blue-700 transition focus:outline-none">'
            + 'Send copy'
            + '</button>'
            + '</div>';
        }
        container.innerHTML = html;
      })
      .catch(function() {});
  }, 320);
}

/* ── Send copy to user ────────────────────────────────────────────────────── */

function shareSendCopy(recipientId, username) {
  var meta    = document.getElementById('share-modal-meta');
  var type    = (meta && meta.dataset.type) || _shareModalCurrentType;
  var id      = (meta && meta.dataset.id)   || _shareModalCurrentId;
  if (!type || !id) return;

  var endpointMap = {
    'note':    '/share/note/' + id + '/to-user',
    'db_card': '/share/db-card/' + id + '/to-user',
  };
  var endpoint = endpointMap[type];
  if (!endpoint) return;

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ recipient_id: recipientId }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { shareShowToast(data.error, true); return; }
      shareShowToast('📋 Copy sent to ' + username + '!', false);
      // Clear search results
      var res = document.getElementById('share-user-results');
      if (res) res.innerHTML = '';
      var inp = document.getElementById('share-user-search');
      if (inp) inp.value = '';
    })
    .catch(function() { shareShowToast('Failed to send copy.', true); });
}

/* ── Public link ─────────────────────────────────────────────────────────── */

function shareCreatePublicLink(type, id) {
  var endpoint = type === 'note'
    ? '/share/note/' + id + '/public-link'
    : '/share/db-card/' + id + '/public-link';

  fetch(endpoint, { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { shareShowToast(data.error, true); return; }
      // Show the active-link area with the new URL
      var inactiveArea = document.getElementById('share-link-inactive-area');
      var activeArea   = document.getElementById('share-link-active-area');
      var urlInput     = document.getElementById('share-link-url');
      if (inactiveArea) inactiveArea.classList.add('hidden');
      if (activeArea)   activeArea.classList.remove('hidden');
      if (urlInput)     urlInput.value = data.url;

      // Update the badge on the note form / card panel
      shareUpdateBadge(type, id, true);
    })
    .catch(function() { shareShowToast('Failed to create link.', true); });
}

function shareRevokePublicLink(type, id) {
  var endpoint = type === 'note'
    ? '/share/note/' + id + '/public-link'
    : '/share/db-card/' + id + '/public-link';

  fetch(endpoint, { method: 'DELETE' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { shareShowToast(data.error, true); return; }
      // Swap areas back
      var inactiveArea = document.getElementById('share-link-inactive-area');
      var activeArea   = document.getElementById('share-link-active-area');
      if (activeArea)   activeArea.classList.add('hidden');
      if (inactiveArea) inactiveArea.classList.remove('hidden');

      // Update the badge
      shareUpdateBadge(type, id, false);
      shareShowToast('🔒 Link revoked.', false);
    })
    .catch(function() { shareShowToast('Failed to revoke link.', true); });
}

function shareCopyUrlToClipboard(url) {
  if (!url) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      shareShowToast('🔗 Link copied!', false);
    }).catch(function() { _shareFallbackCopy(url); });
  } else {
    _shareFallbackCopy(url);
  }
}

function _shareFallbackCopy(url) {
  var ta = document.createElement('textarea');
  ta.value = url;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); shareShowToast('🔗 Link copied!', false); }
  catch(e) { shareShowToast('Copy failed — select the URL manually.', true); }
  document.body.removeChild(ta);
}

/* ── Badge management ────────────────────────────────────────────────────── */

/**
 * Show or hide the "🔗 Shared" badge for a note or db card.
 * badge id pattern:
 *   note    → share-badge-note-{id}
 *   db_card → share-badge-db-card-{id}
 *             + db-card-grid-share-{id}  (card grid preview badge)
 */
function shareUpdateBadge(type, id, active) {
  // ── Detail-panel / note-form badge ──
  var badgeId = type === 'note'
    ? 'share-badge-note-' + id
    : 'share-badge-db-card-' + id;
  var badge = document.getElementById(badgeId);
  if (badge) {
    if (active) {
      badge.className = 'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold'
        + ' bg-[#ffc220] text-[#995213] self-center flex-shrink-0 whitespace-nowrap';
      badge.textContent = '🔗 Shared';
      badge.title = 'Public link active — anyone with the link can view this';
    } else {
      badge.className = 'hidden';
      badge.textContent = '';
      badge.title = '';
    }
  }

  // ── Card grid preview badge (db_card only) ──
  if (type === 'db_card') {
    var gridBadge = document.getElementById('db-card-grid-share-' + id);
    if (gridBadge) {
      if (active) {
        gridBadge.classList.remove('hidden');
      } else {
        gridBadge.classList.add('hidden');
      }
    }
    // Also keep the in-memory card state in sync so re-renders reflect reality.
    if (typeof _dbCards !== 'undefined') {
      var card = _dbCards.find(function(c) { return c.id === id || c.id === +id; });
      if (card) card.has_share_link = active;
    }
  }

  // ── Note list sidebar badge ──
  if (type === 'note') {
    var listBadge = document.getElementById('note-list-share-' + id);
    if (listBadge) {
      if (active) {
        listBadge.classList.remove('hidden');
      } else {
        listBadge.classList.add('hidden');
      }
    }
  }
}

/**
 * Async fetch + apply the public link badge for a DB card detail panel.
 * Called from _dbOpenDetail / _dbRenderDetailPanel after the panel renders.
 */
function shareLoadCardBadge(cardId) {
  fetch('/share/db-card/' + cardId + '/public-link')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      shareUpdateBadge('db_card', cardId, data.active);
    })
    .catch(function() {}); // badge stays hidden on error — graceful
}

/* ── Toast notifications ─────────────────────────────────────────────────── */

function shareShowToast(msg, isError) {
  // Reuse the existing reminder toast container if available.
  var wrap = document.getElementById('rem-fun-popup-wrap');
  var toast = document.createElement('div');
  toast.style.cssText =
    'pointer-events:auto;padding:.6rem 1rem;border-radius:.75rem;font-size:.8rem;font-weight:500;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:280px;'
    + (isError
       ? 'background:#fef2f2;color:#991b1b;border:1px solid #fecaca;'
       : 'background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;');
  toast.textContent = msg;

  if (wrap) {
    wrap.appendChild(toast);
  } else {
    // Fallback: create our own fixed container
    var fb = document.createElement('div');
    fb.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;';
    fb.appendChild(toast);
    document.body.appendChild(fb);
    setTimeout(function() { fb.remove(); }, 3500);
    return;
  }
  setTimeout(function() { toast.remove(); }, 3500);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function _shareEsc(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* ── Expose to global scope so Jinja2 onclick attrs can call them ─────────── */
window.shareOpenModal          = shareOpenModal;
window.shareCloseModal         = shareCloseModal;
window.shareSearchUsers        = shareSearchUsers;
window.shareSendCopy           = shareSendCopy;
window.shareCreatePublicLink   = shareCreatePublicLink;
window.shareRevokePublicLink   = shareRevokePublicLink;
window.shareCopyUrlToClipboard = shareCopyUrlToClipboard;
window.shareUpdateBadge        = shareUpdateBadge;
window.shareLoadCardBadge      = shareLoadCardBadge;
window.shareShowToast          = shareShowToast;
