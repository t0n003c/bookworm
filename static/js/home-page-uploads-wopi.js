/**
 * home-page-uploads-wopi.js — Collabora Online WOPI editor modal.
 *
 * Loaded after home-page-uploads-sign.js (load order in base.html matters).
 * Entry point: _uplWopiOpen(f)  called from _uplDocStudioInit in docs JS.
 * Uses: var (not let/const) — house style; consistent with rest of codebase.
 *
 * WOPI-eligible MIME types (must match WOPI_MIMES frozenset in routers/wopi.py)
 */

/* exported _uplWopiOpen, _uplWopiClose, _uplWopiFrameLoaded */

var _WOPI_MIMES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

// ── Module state ──────────────────────────────────────────────────────────────
var _uplWopiFile       = null;   // current file object passed to _uplWopiOpen
var _uplWopiDirty      = false;  // was a save event received from Collabora?
var _uplWopiMsgHandler = null;   // reference to the PostMessage handler (for cleanup)


// ── Public helpers ────────────────────────────────────────────────────────────

/** Return true when Collabora is enabled for this uploads page. */
function _uplWopiEnabled() {
  var root = document.getElementById("uploads-page-root");
  if (!root) return false;
  try {
    return JSON.parse(root.dataset.collaboraEnabled || "false");
  } catch (_) { return false; }
}

/** Return the page ID from the uploads-page-root data attribute. */
function _uplWopiPageId() {
  var root = document.getElementById("uploads-page-root");
  return root ? (root.dataset.pageId || "") : "";
}


// ── Open ─────────────────────────────────────────────────────────────────────

/**
 * Open the Collabora Online editor for a file.
 * @param {Object} f - File object with .id, .original_name, .mime_type
 */
function _uplWopiOpen(f) {
  if (!_uplWopiEnabled()) {
    alert("Collabora Online is not configured on this server.");
    return;
  }
  if (_WOPI_MIMES.indexOf(f.mime_type) === -1) {
    alert("This file type is not supported by Collabora.");
    return;
  }

  _uplWopiFile  = f;
  _uplWopiDirty = false;

  // Show modal with loading state
  var modal = document.getElementById("upl-wopi-modal");
  var frame = document.getElementById("upl-wopi-frame");
  var loading = document.getElementById("upl-wopi-loading");
  var titleEl = document.getElementById("upl-wopi-filename");

  if (!modal || !frame || !loading || !titleEl) return;

  titleEl.textContent = f.original_name || f.filename || "Document";
  loading.classList.remove("hidden");
  frame.classList.add("hidden");
  frame.src = "about:blank";
  modal.classList.remove("hidden");

  // Fetch the WOPI token and editor URL from the server
  var pid = _uplWopiPageId();
  fetch("/home/uploads/" + pid + "/files/page/" + f.id + "/wopi-token")
    .then(function(r) {
      if (r.status === 401) { window.location.href = "/login"; return null; }
      return r.json();
    })
    .then(function(data) {
      if (!data) return;
      if (data.collabora_disabled) {
        _uplWopiClose();
        alert("Collabora Online is not configured on this server.\nSet BW_COLLABORA_URL in your environment.");
        return;
      }
      if (data.detail) {
        _uplWopiClose();
        alert("Could not open editor:\n" + data.detail);
        return;
      }
      // Wire up the PostMessage listener before setting src
      _uplWopiBindPostMessage();
      frame.src = data.editor_url;
    })
    .catch(function(err) {
      _uplWopiClose();
      alert("Error opening Collabora editor: " + err);
    });
}


// ── Close ─────────────────────────────────────────────────────────────────────

/** Close the WOPI modal and clean up. */
function _uplWopiClose() {
  var modal   = document.getElementById("upl-wopi-modal");
  var frame   = document.getElementById("upl-wopi-frame");
  var loading = document.getElementById("upl-wopi-loading");

  if (modal)   modal.classList.add("hidden");
  if (frame)   { frame.src = "about:blank"; frame.classList.add("hidden"); }
  if (loading) loading.classList.remove("hidden");

  // Remove PostMessage listener
  if (_uplWopiMsgHandler) {
    window.removeEventListener("message", _uplWopiMsgHandler);
    _uplWopiMsgHandler = null;
  }

  // Refresh the file list if Collabora sent a save event
  if (_uplWopiDirty && typeof _uplFetch === "function") {
    _uplFetch();
  }
  _uplWopiDirty = false;
  _uplWopiFile  = null;
}


// ── iframe onload callback ────────────────────────────────────────────────────

/** Called by iframe.onload — hide spinner, reveal editor. */
function _uplWopiFrameLoaded() {
  var frame   = document.getElementById("upl-wopi-frame");
  var loading = document.getElementById("upl-wopi-loading");
  // Ignore the initial about:blank load
  if (!frame || frame.src === "about:blank" || frame.src === window.location.href) return;
  if (loading) loading.classList.add("hidden");
  if (frame)   frame.classList.remove("hidden");
}


// ── PostMessage listener ──────────────────────────────────────────────────────

/**
 * Attach a window.message listener to receive events from the Collabora iframe.
 * Collabora sends save/close/status events as structured PostMessage data.
 * We mark _uplWopiDirty=true on any save notification so Close triggers a refresh.
 */
function _uplWopiBindPostMessage() {
  // Always start fresh
  if (_uplWopiMsgHandler) {
    window.removeEventListener("message", _uplWopiMsgHandler);
  }

  _uplWopiMsgHandler = function(event) {
    // Only accept messages from the Collabora frame
    var frame = document.getElementById("upl-wopi-frame");
    if (!frame || event.source !== frame.contentWindow) return;

    var msg = event.data;

    // Collabora sends structured objects or JSON strings
    if (typeof msg === "string") {
      try { msg = JSON.parse(msg); } catch (_) { return; }
    }
    if (!msg || typeof msg !== "object") return;

    var msgType = msg.MessageId || msg.type || "";

    // Document saved events
    if (
      msgType === "Action_Save_Resp" ||
      msgType === "Doc_ModifiedStatus" ||
      msgType === "close"
    ) {
      _uplWopiDirty = true;
    }

    // Collabora requests the editor be closed
    if (msgType === "UI_Close" || msgType === "close") {
      _uplWopiClose();
    }
  };

  window.addEventListener("message", _uplWopiMsgHandler);
}
