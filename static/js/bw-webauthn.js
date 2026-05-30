/**
 * bw-webauthn.js — biometric / passkey sign-in for BookWorm
 *
 * Covers two contexts:
 *   1. Account settings panel (registration + device management)
 *   2. 2FA verify page (authentication — fingerprint replaces TOTP)
 *
 * All ArrayBuffer <-> base64url conversions are done here so the server
 * only ever sees plain JSON with base64url strings.
 *
 * No global state beyond what's needed for the one-shot registration flow.
 */
(function () {
  'use strict';

  // ── base64url helpers ───────────────────────────────────────────────────────

  function _b64urlToBuffer(b64) {
    var padded = b64 + '==='.slice(0, (4 - b64.length % 4) % 4);
    var binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    var buf = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf.buffer;
  }

  function _bufToB64url(buf) {
    var bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── decode server options (challenge + credential IDs → ArrayBuffer) ────────

  function _prepareCreationOptions(opts) {
    opts.challenge = _b64urlToBuffer(opts.challenge);
    opts.user.id  = _b64urlToBuffer(opts.user.id);
    if (opts.excludeCredentials) {
      opts.excludeCredentials = opts.excludeCredentials.map(function (c) {
        return Object.assign({}, c, { id: _b64urlToBuffer(c.id) });
      });
    }
    return opts;
  }

  function _prepareRequestOptions(opts) {
    opts.challenge = _b64urlToBuffer(opts.challenge);
    if (opts.allowCredentials) {
      opts.allowCredentials = opts.allowCredentials.map(function (c) {
        return Object.assign({}, c, { id: _b64urlToBuffer(c.id) });
      });
    }
    return opts;
  }

  // ── encode browser credential → JSON for server ─────────────────────────────

  function _encodeRegistration(cred, deviceName) {
    return {
      id:      cred.id,
      rawId:   _bufToB64url(cred.rawId),
      type:    cred.type,
      deviceName: deviceName,
      response: {
        clientDataJSON:    _bufToB64url(cred.response.clientDataJSON),
        attestationObject: _bufToB64url(cred.response.attestationObject),
      },
    };
  }

  function _encodeAuthentication(cred) {
    return {
      id:    cred.id,
      rawId: _bufToB64url(cred.rawId),
      type:  cred.type,
      response: {
        clientDataJSON:    _bufToB64url(cred.response.clientDataJSON),
        authenticatorData: _bufToB64url(cred.response.authenticatorData),
        signature:         _bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle
          ? _bufToB64url(cred.response.userHandle) : null,
      },
    };
  }

  // ── WebAuthn platform availability ─────────────────────────────────────────

  /**
   * Returns a promise that resolves to true when the browser has a platform
   * authenticator (fingerprint reader, Face ID, Windows Hello, etc.).
   */
  function bwWaAvailable() {
    if (!window.PublicKeyCredential) return Promise.resolve(false);
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }
  window.bwWaAvailable = bwWaAvailable;

  // ── Registration (called from account settings panel) ───────────────────────

  /**
   * Register a new credential for this device.
   * @param {string} deviceName  — label shown in the device list
   * @param {string} loaderId    — id of the panel's loader div (to refresh)
   */
  function bwWaRegister(deviceName, loaderId) {
    var btn = document.getElementById('wa-register-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Registering…'; }

    fetch('/account/webauthn/register/begin', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (opts) {
        if (opts.error) throw new Error(opts.error);
        return navigator.credentials.create({ publicKey: _prepareCreationOptions(opts) });
      })
      .then(function (cred) {
        return fetch('/account/webauthn/register/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_encodeRegistration(cred, deviceName || 'My Device')),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Registration failed.');
        // Reload the panel to show the new device
        if (loaderId && typeof _loadPanel === 'function') {
          _loadPanel('/account/webauthn/panel', loaderId);
        }
      })
      .catch(function (err) {
        var errEl = document.getElementById('wa-register-error');
        if (errEl) {
          errEl.textContent = err.name === 'NotAllowedError'
            ? 'Cancelled — try again when ready.'
            : (err.message || String(err));
          errEl.classList.remove('hidden');
        }
        if (btn) { btn.disabled = false; btn.textContent = '➕ Register this device'; }
      });
  }
  window.bwWaRegister = bwWaRegister;

  /**
   * Remove a registered device.
   * @param {number} credId   — database row id
   * @param {string} loaderId — panel loader id to refresh
   */
  function bwWaDelete(credId, loaderId) {
    if (!confirm('Remove this device from biometric sign-in?')) return;
    fetch('/account/webauthn/credentials/' + credId, { method: 'DELETE' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var el = document.getElementById(loaderId);
        if (el) el.innerHTML = html;
      });
  }
  window.bwWaDelete = bwWaDelete;

  // ── Authentication (called from 2FA verify page) ───────────────────────────

  /**
   * Attempt biometric authentication.
   * On success → server redirects to /.
   * On user-cancel → calls onCancel() so the TOTP fallback can be shown.
   *
   * @param {function} onCancel   — called when user dismisses the prompt
   * @param {function} onError    — called with an error message string
   */
  function bwWaAuthenticate(onCancel, onError) {
    fetch('/2fa/webauthn/begin', { method: 'POST' })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'No credentials.'); });
        return r.json();
      })
      .then(function (opts) {
        if (opts.error) throw new Error(opts.error);
        return navigator.credentials.get({ publicKey: _prepareRequestOptions(opts) });
      })
      .then(function (cred) {
        return fetch('/2fa/webauthn/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_encodeAuthentication(cred)),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || 'Verification failed.');
        window.location.href = res.redirect || '/';
      })
      .catch(function (err) {
        if (err.name === 'NotAllowedError') {
          if (typeof onCancel === 'function') onCancel();
        } else {
          if (typeof onError === 'function') onError(err.message || String(err));
        }
      });
  }
  window.bwWaAuthenticate = bwWaAuthenticate;

  // ── 2FA verify page bootstrap ───────────────────────────────────────────────

  /**
   * Called on page-load of 2fa_verify.html when has_webauthn is true.
   * Auto-triggers the fingerprint prompt and wires up the fallback toggle.
   */
  function bwWaInitVerifyPage() {
    var bioSection  = document.getElementById('wa-bio-section');
    var totpSection = document.getElementById('wa-totp-section');
    var statusEl    = document.getElementById('wa-status');
    var fallbackBtn = document.getElementById('wa-fallback-btn');
    var retryBtn    = document.getElementById('wa-retry-btn');

    function showTotp() {
      if (totpSection) totpSection.classList.remove('hidden');
      if (bioSection)  bioSection.classList.add('hidden');
    }

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = isError
        ? 'text-red-400 text-sm text-center mt-3'
        : 'text-white/60 text-sm text-center mt-3';
    }

    function doAuth() {
      setStatus('Waiting for biometric confirmation…', false);
      if (retryBtn) retryBtn.classList.add('hidden');
      bwWaAuthenticate(
        function onCancel() {
          setStatus('Biometric cancelled.', true);
          if (retryBtn) retryBtn.classList.remove('hidden');
        },
        function onError(msg) {
          setStatus('Error: ' + msg, true);
          if (retryBtn) retryBtn.classList.remove('hidden');
        }
      );
    }

    if (retryBtn)    retryBtn.addEventListener('click', doAuth);
    if (fallbackBtn) fallbackBtn.addEventListener('click', showTotp);

    // Auto-trigger on load — give the browser 300 ms to settle
    setTimeout(doAuth, 300);
  }
  window.bwWaInitVerifyPage = bwWaInitVerifyPage;

})();
