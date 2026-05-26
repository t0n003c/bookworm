/* bw-push.js — Web Push subscription manager.
 *
 * Reads the VAPID public key from <meta name="bw-vapid-key">.
 * Exposes two globals:
 *   bwPushInit()   — call once on page load; syncs bell UI with SW state
 *   bwPushToggle() — call from the bell button; subscribe / unsubscribe
 */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  function _vapidKey() {
    var m = document.querySelector('meta[name="bw-vapid-key"]');
    return m ? m.content.trim() : '';
  }

  /** Convert a base64url VAPID public key to the Uint8Array browsers require. */
  function _urlB64ToUint8Array(b64) {
    var pad    = '='.repeat((4 - b64.length % 4) % 4);
    var raw    = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function _isSupported() {
    return 'serviceWorker' in navigator
        && 'PushManager'   in window
        && 'Notification'  in window;
  }

  /* ── Bell UI ─────────────────────────────────────────────────────────────── */

  function _setBellState(active, label) {
    var btn = document.getElementById('bw-push-btn');
    if (!btn) return;
    btn.dataset.active = active ? '1' : '0';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    var lbl = btn.querySelector('[data-push-label]');
    if (lbl) lbl.textContent = label || (active ? 'Notifications On' : 'Notifications Off');
    var icon = btn.querySelector('[data-push-icon]');
    if (icon) icon.textContent = active ? '\uD83D\uDD14' : '\uD83D\uDD15';  // 🔔 / 🔕
  }

  function _setBellLoading(loading) {
    var btn = document.getElementById('bw-push-btn');
    if (!btn) return;
    btn.disabled = loading;
  }

  /* ── Core subscription logic ─────────────────────────────────────────────── */

  async function _getSwReg() {
    if (!_isSupported()) return null;
    try {
      return await navigator.serviceWorker.ready;
    } catch (_) { return null; }
  }

  async function _getCurrentSub() {
    var reg = await _getSwReg();
    if (!reg) return null;
    try {
      return await reg.pushManager.getSubscription();
    } catch (_) { return null; }
  }

  async function _subscribe() {
    var key = _vapidKey();
    if (!key) { console.warn('[bw-push] VAPID key missing'); return null; }
    var reg = await _getSwReg();
    if (!reg) return null;
    try {
      return await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: _urlB64ToUint8Array(key),
      });
    } catch (e) {
      console.warn('[bw-push] subscribe failed:', e);
      return null;
    }
  }

  async function _saveToServer(sub) {
    var j = sub.toJSON();
    try {
      var r = await fetch('/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
      });
      return r.ok;
    } catch (_) { return false; }
  }

  async function _removeFromServer(endpoint) {
    try {
      await fetch('/push/unsubscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint }),
      });
    } catch (_) { /* best-effort */ }
  }

  /* ── Public API ──────────────────────────────────────────────────────────── */

  window.bwPushInit = async function () {
    if (!_isSupported() || !_vapidKey()) {
      // Hide bell if push is not configured / supported
      var btn = document.getElementById('bw-push-btn');
      if (btn) btn.closest('li, div') && btn.closest('li, div').classList.add('hidden');
      return;
    }
    var sub = await _getCurrentSub();
    _setBellState(!!sub);
  };

  window.bwPushToggle = async function () {
    if (!_isSupported()) {
      alert('Push notifications are not supported by this browser.');
      return;
    }
    if (!_vapidKey()) {
      alert('Push notifications are not configured on this server.\nAdd VAPID keys to your .env file.');
      return;
    }

    _setBellLoading(true);
    var current = await _getCurrentSub();

    if (current) {
      /* — Unsubscribe — */
      await _removeFromServer(current.endpoint);
      await current.unsubscribe();
      _setBellState(false);
    } else {
      /* — Subscribe — */
      var perm = Notification.permission;
      if (perm === 'denied') {
        alert('Notifications are blocked in your browser.\nOpen browser settings to allow them for this site.');
        _setBellLoading(false);
        return;
      }
      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }
      if (perm !== 'granted') {
        _setBellLoading(false);
        return;
      }
      var sub = await _subscribe();
      if (!sub) {
        _setBellLoading(false);
        return;
      }
      await _saveToServer(sub);
      _setBellState(true);
    }
    _setBellLoading(false);
  };

  /* Auto-init after the DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bwPushInit);
  } else {
    window.bwPushInit();
  }
})();
