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
  function bwWaRegister(deviceName, biometricType, loaderId) {
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
          body: JSON.stringify(Object.assign(
            _encodeRegistration(cred, deviceName || 'My Device'),
            { biometricType: biometricType || 'auto' }
          )),
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
   * Attempt biometric authentication for ONE specific type (or all).
   *
   * @param {string}   biometricType  'face' | 'fingerprint' | 'auto' | '' (all)
   * @param {function} onSuccess      called on success (no args — page navigates)
   * @param {function} onCancel       called when user explicitly dismisses the prompt
   * @param {function} onNoCredsForType  called when server has no creds of this type
   * @param {function} onError        called with an error message string
   */
  function bwWaAuthenticate(biometricType, onSuccess, onCancel, onNoCredsForType, onError) {
    var typeParam = biometricType ? ('?type=' + encodeURIComponent(biometricType)) : '';
    fetch('/2fa/webauthn/begin' + typeParam, { method: 'POST' })
      .then(function (r) {
        if (r.status === 404) {
          return r.json().then(function (d) {
            if (d.error === 'no_creds_for_type') {
              if (typeof onNoCredsForType === 'function') onNoCredsForType();
              return null;  // signal: skip this phase
            }
            throw new Error(d.error || 'No credentials registered.');
          });
        }
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Begin failed.'); });
        return r.json();
      })
      .then(function (opts) {
        if (!opts) return null;  // skip phase
        if (opts.error) throw new Error(opts.error);
        return navigator.credentials.get({ publicKey: _prepareRequestOptions(opts) });
      })
      .then(function (cred) {
        if (!cred) return null;  // skip phase
        return fetch('/2fa/webauthn/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(_encodeAuthentication(cred)),
        });
      })
      .then(function (r) {
        if (!r) return null;  // skip phase
        return r.json();
      })
      .then(function (res) {
        if (!res) return;  // skip phase
        if (!res.ok) throw new Error(res.error || 'Verification failed.');
        if (typeof onSuccess === 'function') onSuccess();
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

  // Phase config — emoji + label shown during each phase
  var _PHASES = [
    { type: 'face',        icon: '\uD83D\uDE36', label: 'Trying Face ID…' },
    { type: 'fingerprint', icon: '\uD83E\uDEF6', label: 'Trying fingerprint…' },
    { type: 'auto',        icon: '\uD83D\uDD10', label: 'Waiting for biometric…' },
  ];

  /**
   * Called on page-load of 2fa_verify.html when has_webauthn is true.
   *
   * Phase sequence (Face-first):
   *   1. Try credentials of type 'face'   (auto-retries once on OS timeout)
   *   2. Try credentials of type 'fingerprint'  (same auto-retry)
   *   3. Try ALL remaining credentials ('auto' / legacy)
   *   4. If all phases exhausted → show TOTP fallback
   *
   * Each phase is skipped silently when the server has no creds of that type.
   */
  function bwWaInitVerifyPage() {
    var bioSection  = document.getElementById('wa-bio-section');
    var totpSection = document.getElementById('wa-totp-section');
    var statusEl    = document.getElementById('wa-status');
    var iconEl      = document.getElementById('wa-bio-icon');
    var retryBtn    = document.getElementById('wa-retry-btn');
    var fallbackBtn = document.getElementById('wa-fallback-btn');

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

    function setPhaseIcon(phase) {
      if (iconEl) iconEl.textContent = phase.icon;
    }

    // Run phases in order; each phase may auto-retry once before moving on.
    // phaseIdx  — index into _PHASES
    // retryLeft — auto-retries remaining for the current phase
    function runPhase(phaseIdx, retryLeft) {
      if (phaseIdx >= _PHASES.length) {
        // All biometric phases exhausted
        setStatus('Biometric sign-in unavailable. Use your code instead.', true);
        if (retryBtn) retryBtn.classList.add('hidden');
        showTotp();
        return;
      }
      var phase = _PHASES[phaseIdx];
      setPhaseIcon(phase);
      setStatus(phase.label, false);
      if (retryBtn) retryBtn.classList.add('hidden');

      bwWaAuthenticate(
        phase.type,
        // onSuccess: page will redirect — nothing to do
        function () {},
        // onCancel (NotAllowedError): OS dismissed the prompt
        function () {
          if (retryLeft > 0) {
            // Auto-retry once — OS may have timed out rather than user cancelling
            setStatus(phase.label + ' (retrying…)', false);
            setTimeout(function () { runPhase(phaseIdx, retryLeft - 1); }, 600);
          } else {
            // Out of retries for this phase — advance to next
            runPhase(phaseIdx + 1, 1);
          }
        },
        // onNoCredsForType: server has nothing for this type, skip silently
        function () {
          runPhase(phaseIdx + 1, 1);
        },
        // onError: unexpected error
        function (msg) {
          setStatus('Error: ' + msg, true);
          if (retryBtn) {
            retryBtn.classList.remove('hidden');
            retryBtn.onclick = function () { runPhase(0, 1); };
          }
        }
      );
    }

    if (fallbackBtn) fallbackBtn.addEventListener('click', showTotp);

    // Auto-trigger Phase 0 (Face ID) after 300 ms browser settle time
    setTimeout(function () { runPhase(0, 1); }, 300);
  }
  window.bwWaInitVerifyPage = bwWaInitVerifyPage;

})();
