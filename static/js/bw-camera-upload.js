/**
 * bw-camera-upload.js
 * Adds a "Take photo" (camera) option next to file-upload controls on mobile.
 *
 * Strategy: reuse each <input type="file">'s existing change handler. A camera
 * button temporarily sets capture="environment" + accept="image/*" on that very
 * input and clicks it, so the OS opens the rear camera and the captured photo
 * flows through the page's normal upload code. Attributes are restored right
 * after, so the regular browse/drag-drop path is untouched.
 *
 * Touch-only: on desktop (fine pointer) this script is a complete no-op, so it
 * can never affect the existing desktop experience.
 *
 * Auto-enhances file inputs that have a real visible anchor (a wrapping <label>,
 * a clickable drop-zone, or a `data-bw-cam-anchor="<id>"` hint). Hidden/ephemeral
 * inputs with no anchor are skipped (those already expose the camera via the
 * native picker when they accept images). JS-built modals can call
 * window.bwCameraScan(modalEl) after rendering to enhance their inputs.
 */
(function () {
  'use strict';

  var isTouch = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  if (!isTouch) return;   // desktop: do nothing

  var CAM_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' style="width:1rem;height:1rem;flex-shrink:0" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round"' +
    ' d="M3 9a2 2 0 012-2h1.5l1-1.5a1 1 0 01.83-.5h5.34a1 1 0 01.83.5l1 1.5H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>' +
    '<circle cx="12" cy="13" r="3.2"/></svg>';

  /* ── Open the camera by toggling capture/accept on the input, reuse handler ── */
  function openCamera(inp) {
    if (!inp) return;
    var prevAccept  = inp.getAttribute('accept');
    var prevCapture = inp.getAttribute('capture');
    if (!prevAccept || prevAccept.toLowerCase().indexOf('image') === -1) {
      inp.setAttribute('accept', 'image/*');
    }
    inp.setAttribute('capture', 'environment');
    inp.click();
    // Restore once the OS picker has taken over, so plain browse still works.
    setTimeout(function () {
      if (prevAccept === null) inp.removeAttribute('accept');
      else inp.setAttribute('accept', prevAccept);
      if (prevCapture === null) inp.removeAttribute('capture');
      else inp.setAttribute('capture', prevCapture);
    }, 500);
  }
  window.bwCameraOpen = openCamera;

  /* ── Build the camera button ─────────────────────────────────────────────── */
  function makeBtn(inp) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-bw-cam-btn', '');
    b.setAttribute('aria-label', 'Take photo with camera');
    b.title = 'Take a photo';
    b.style.cssText =
      'display:inline-flex;align-items:center;gap:0.35rem;margin-top:0.4rem;' +
      'padding:0.4rem 0.7rem;border-radius:0.5rem;border:1px solid #0053e2;' +
      'background:rgba(0,83,226,0.06);color:#0053e2;font-size:0.78rem;' +
      'font-weight:600;cursor:pointer;line-height:1;-webkit-tap-highlight-color:transparent;';
    b.innerHTML = CAM_ICON + '<span>Take photo</span>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openCamera(inp);
    });
    return b;
  }

  /* ── Find a sensible place to drop the camera button ─────────────────────── */
  function anchorFor(inp) {
    var explicit = inp.getAttribute('data-bw-cam-anchor');
    if (explicit) { var el = document.getElementById(explicit); if (el) return el; }
    var lbl = inp.closest('label');
    if (lbl) return lbl;
    var zone = inp.closest(
      '[class*="cursor-pointer"],[class*="drop"],[class*="dropzone"],[role="button"]'
    );
    if (zone && zone !== inp) return zone;
    return inp;
  }

  function _visible(el) {
    return !!(el && (el.offsetParent !== null || el.getClientRects().length));
  }

  function enhance(inp) {
    if (!inp || inp.hasAttribute('data-bw-cam-done')) return;

    // Skip inputs that clearly can't take a photo (e.g. accept=".html,.csv"),
    // unless explicitly opted in with data-bw-cam. (Mark done — never retry.)
    var accept = (inp.getAttribute('accept') || '').toLowerCase();
    if (accept && accept.indexOf('image') === -1 && accept.indexOf('*') === -1 &&
        !inp.hasAttribute('data-bw-cam')) {
      inp.setAttribute('data-bw-cam-done', '1');
      return;
    }

    var anchor = anchorFor(inp);
    // No real visible anchor yet → leave the input un-marked so a later scan
    // (e.g. after a modal opens) can retry. Prevents stray buttons next to
    // hidden/ephemeral inputs while still covering inside-modal drop zones.
    if (anchor === inp && !_visible(inp)) return;
    if (anchor !== inp && !_visible(anchor)) return;

    inp.setAttribute('data-bw-cam-done', '1');

    // Avoid duplicating if a button is already right after the anchor.
    var next = anchor.nextSibling;
    if (next && next.nodeType === 1 && next.hasAttribute && next.hasAttribute('data-bw-cam-btn')) return;

    var btn = makeBtn(inp);
    if (anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input[type="file"]:not([data-bw-cam-done])').forEach(enhance);
    // If root itself is a file input
    if (root && root.matches && root.matches('input[type="file"]')) enhance(root);
  }
  window.bwCameraScan = scan;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
  // Re-scan after HTMX swaps (panels, note attachments, workspace switches…).
  document.addEventListener('htmx:afterSettle', function () { scan(); });
})();
