# Plan: Jspreadsheet CE In-Browser XLSX/CSV Editor (Document Studio Phase 7)
Date: 2026-04-15
Estimated complexity: Medium

---

## Summary

Add a fully client-side spreadsheet editor to Document Studio. XLSX and CSV files uploaded to an Uploads homespace page will gain a **📊 Edit Spreadsheet** button in their Document Studio panel. Clicking it opens a fullscreen modal containing a live [Jspreadsheet CE](https://bossanova.uk/jspreadsheet/v4/) grid. [SheetJS (xlsx.js)](https://sheetjs.com/) handles XLSX ↔ JS-array round-tripping; Jspreadsheet CE renders the editable grid. Both libraries are loaded lazily from CDN (injected dynamically in JS at first open, not in `base.html`). A **💾 Save** button serializes the current grid back to the original format (XLSX bytes via SheetJS or CSV text) and PUTs it to a new dedicated endpoint `PUT /home/uploads/{pid}/files/page/{fid}/spreadsheet` which accepts base64-encoded bytes. Closing without saving discards all changes. Read-only mode applies automatically for `note-src` files, matching every other Document Studio editor.

The existing `PUT /{pid}/files/page/{fid}/content` endpoint is **not reused** because it validates `mime.startswith("text/")` before writing and rejects XLSX (binary, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). A unified base64 endpoint is cleaner than special-casing the existing one.

---

## Files to Change

Touch in this sequence to avoid dependency issues.

| # | File | What changes |
|---|---|---|
| 1 | `routers/home_uploads_docs.py` | Add `SpreadsheetBody` Pydantic model + `PUT /{pid}/files/page/{fid}/spreadsheet` endpoint |
| 2 | `templates/partials/home_page_uploads.html` | Add `#upl-spreadsheet-modal` HTML block (fullscreen, mirrors `#upl-wopi-modal` structure) |
| 3 | `static/js/home-page-uploads-spreadsheet.js` | **New file** — all spreadsheet editor JS (see New Files below) |
| 4 | `templates/base.html` | Add `<script>` tag for new JS file at line 587 (after `uploads-wopi.js`) |
| 5 | `static/js/home-page-uploads-docs.js` | Add `canSpreadsheet` flag + **📊 Edit Spreadsheet** button in `_uplDocStudioInit` |

---

## New Files to Create

| File | Purpose |
|---|---|
| `static/js/home-page-uploads-spreadsheet.js` | CDN loader, Jspreadsheet CE + SheetJS integration, modal open/close/save, read-only guard |

---

## DB Migrations Needed

**None.** No schema changes. `update_page_upload_size()` already exists in `routers/uploads_docs_db.py` and is reused by the new endpoint. `page_uploads` table already stores `mime_type`, `filename`, and `size`.

---

## New Backend Endpoint (File 1 detail)

### `PUT /{page_id}/files/page/{file_id}/spreadsheet`

**Location:** Add to `routers/home_uploads_docs.py` after the existing `save_content` function (~line 225).

**New Pydantic model** (add with the other models near top of file, after `ContentBody`):
```python
class SpreadsheetBody(BaseModel):
    content_b64: str   # base64-encoded file bytes (SheetJS XLSX or UTF-8 CSV)
    format: str        # "xlsx" | "csv"

MAX_SPREADSHEET_BYTES = 10_000_000  # 10 MB guard (larger than the 1 MB text guard)
```

**Endpoint logic — exact sequence:**
1. `if guard := _demo_guard(request): return guard`
2. `uid = request.session.get("user_id")` → 401 if falsy
3. `await _require_uploads_page(page_id, uid)`
4. `row = await get_page_upload_owned(file_id, uid)` → 404 if None
5. MIME-type gate: only `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `text/csv` → 400 otherwise
6. Format gate: `body.format` must be `"xlsx"` or `"csv"` → 400 otherwise
7. `data = base64.b64decode(body.content_b64)` — wrap in try/except → 400 on bad base64
8. Size gate: `len(data) > MAX_SPREADSHEET_BYTES` → 413
9. `(UPLOAD_DIR / row["filename"]).write_bytes(data)` — wrap in try/except → 500 on failure
10. `await update_page_upload_size(file_id, uid, len(data))`
11. `return JSONResponse({"ok": True, "size": len(data)})`

**No new Python imports needed** — `base64` is already imported at the top of `home_uploads_docs.py` (used by `sign_pdf`).

---

## New Modal HTML (File 2 detail)

Add to `templates/partials/home_page_uploads.html` **just before** the closing `</div>{# /uploads-page-root #}` line (i.e., directly after the `#upl-wopi-modal` closing `</div>` block).

Follow the WOPI modal structure exactly (same z-index, same dark top bar, same Escape handler pattern):

```html
{# ── Jspreadsheet CE spreadsheet editor modal ──────────────────────── #}
<div id="upl-spreadsheet-modal"
     class="hidden fixed inset-0 z-[60] flex flex-col"
     role="dialog" aria-modal="true" aria-labelledby="upl-ss-title" tabindex="-1"
     onkeydown="if(event.key==='Escape')_uplSsClose()">
  {# Top bar #}
  <div class="flex items-center gap-3 px-4 py-2 flex-shrink-0
              bg-zinc-900 border-b border-zinc-700">
    <span class="text-base leading-none">📊</span>
    <span id="upl-ss-filename"
          class="text-sm font-semibold text-zinc-100 truncate flex-1"></span>
    <span id="upl-ss-title" class="text-xs text-zinc-400 select-none">Spreadsheet Editor</span>
    <button id="upl-ss-save-btn" type="button"
            onclick="_uplSsSave()"
            class="hidden text-white bg-[#0053e2] hover:bg-[#003eb3]
                   rounded-lg px-3 py-1.5 text-xs font-semibold transition
                   focus:outline-none focus:ring-1 focus:ring-white"
            aria-label="Save spreadsheet">
      💾 Save
    </button>
    <button type="button" onclick="_uplSsClose()"
            class="text-zinc-300 hover:text-white bg-zinc-700 hover:bg-zinc-600
                   rounded-lg px-3 py-1.5 text-xs font-medium transition
                   focus:outline-none focus:ring-1 focus:ring-white"
            aria-label="Close spreadsheet editor">
      ✕ Close
    </button>
  </div>
  {# Loading state #}
  <div id="upl-ss-loading"
       class="flex-1 flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
    <svg class="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    Loading spreadsheet…
  </div>
  {# Error state #}
  <div id="upl-ss-error"
       class="hidden flex-1 flex flex-col items-center justify-center bg-zinc-900
              text-red-400 text-sm gap-3">
    <p id="upl-ss-error-msg"></p>
    <button type="button" onclick="_uplSsClose()"
            class="text-xs px-3 py-1.5 rounded-lg border border-zinc-600
                   text-zinc-300 hover:text-white transition">Close</button>
  </div>
  {# Grid mount — Jspreadsheet CE renders here #}
  <div id="upl-ss-grid" class="hidden flex-1 overflow-auto bg-white"></div>
</div>
```

---

## New JS File (File 3 detail)

**`static/js/home-page-uploads-spreadsheet.js`** — keep under 600 lines. All variables `var`. No `let`/`const`.

### CDN URLs to use (pin to major version, not `latest`, for stability)
```
Jsuites JS  : https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.js
Jsuites CSS : https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.css
Jspreadsheet JS : https://cdn.jsdelivr.net/npm/jspreadsheet-ce@5/dist/index.js
Jspreadsheet CSS: https://cdn.jsdelivr.net/npm/jspreadsheet-ce@5/dist/jspreadsheet.css
SheetJS     : https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
```

**Mandatory load order:** Jsuites JS → Jsuites CSS → Jspreadsheet JS → Jspreadsheet CSS → SheetJS.
Jspreadsheet CE has a hard runtime dependency on Jsuites — reversing order causes `jsuites is not defined`.

### Module-level `var` declarations (at top of file)
```javascript
var _uplSsFile        = null;   // current file object { id, filename, mime_type, original_name, src }
var _uplSsGridEl      = null;   // the #upl-ss-grid DOM element (instance attached via jexcel prop)
var _uplSsLibsLoaded  = false;  // true after CDN scripts are injected and resolved
var _uplSsLibsPromise = null;   // cached Promise for in-flight or completed CDN load
var _uplSsBusy        = false;  // prevents double-save
var _XLSX_MIME_SS = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
```

### Functions — full list and signatures

#### `_uplSsLoadScript(url)` → Promise
Creates a `<script>` element, sets `.src = url`, appends to `document.head`, returns a Promise that resolves on `onload`, rejects on `onerror`.

#### `_uplSsLoadStyle(url)` → Promise
Creates a `<link rel="stylesheet">` element, appends to `document.head`, resolves on `onload`.

#### `_uplSsLoadLibs()` → Promise
- Return `_uplSsLibsPromise` if already set (cached — avoids re-injection on repeat opens).
- Chain the loads **sequentially** (each `.then()` returns the next load call):
  `_uplSsLoadScript(jsuites_js)` → `_uplSsLoadStyle(jsuites_css)` → `_uplSsLoadScript(jspreadsheet_js)` → `_uplSsLoadStyle(jspreadsheet_css)` → `_uplSsLoadScript(sheetjs_url)`
- Set `_uplSsLibsLoaded = true` at the end of the chain.
- Store the entire Promise in `_uplSsLibsPromise` and return it.

#### `_uplSsOpen(f)` — public entry point (called from `_uplDocStudioInit`)
1. `_uplSsFile = f`
2. Show `#upl-spreadsheet-modal` (remove `hidden`)
3. Show `#upl-ss-loading`, hide `#upl-ss-grid`, hide `#upl-ss-error`, hide `#upl-ss-save-btn`
4. Set `#upl-ss-filename` text content to `f.original_name`
5. `_uplSsLoadLibs().then(function() { _uplSsRender(f); }).catch(function(err) { _uplSsShowError('Could not load spreadsheet libraries: ' + err); })`

#### `_uplSsRender(f)` — async, fetch + parse + mount grid
1. Fetch file bytes:
   ```javascript
   // /uploads/<uuid-filename> is served by StaticFiles mount (unguarded — see Quirk #18)
   // This is consistent with how #upl-viewer-embed src works for PDFs.
   fetch('/uploads/' + f.filename)
     .then(function(r) {
       if (!r.ok) throw new Error('Could not fetch file (' + r.status + ')');
       return r.arrayBuffer();
     })
   ```
2. Parse with SheetJS:
   ```javascript
   var wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
   var sheetName = wb.SheetNames[0];
   var ws = wb.Sheets[sheetName];
   var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
   ```
3. If `wb.SheetNames.length > 1`: call `_uplShowToast('Showing sheet 1 of ' + wb.SheetNames.length + '. Save will keep only this sheet.')` (non-blocking warning).
4. Destroy existing instance if any:
   ```javascript
   if (_uplSsGridEl && _uplSsGridEl.jexcel) {
     _uplSsGridEl.jexcel.destroy();
   }
   ```
5. Clear and mount:
   ```javascript
   _uplSsGridEl = document.getElementById('upl-ss-grid');
   _uplSsGridEl.innerHTML = '';
   jspreadsheet(_uplSsGridEl, {
     data: data.length ? data : [[]],
     minDimensions: [26, 50],
     tableOverflow: true,
     tableWidth: '100%',
     tableHeight: '100%'
   });
   ```
6. Hide loading, show grid, show save button.
7. On any error: `_uplSsShowError(String(err))`.

#### `_uplSsShowError(msg)`
Hide loading, hide grid, set `#upl-ss-error-msg` text, show `#upl-ss-error`.

#### `_uplSsClose()`
1. If `_uplSsGridEl && _uplSsGridEl.jexcel`: `_uplSsGridEl.jexcel.destroy()`
2. Clear `_uplSsGridEl.innerHTML` if set
3. `_uplSsGridEl = null`, `_uplSsFile = null`, `_uplSsBusy = false`
4. Hide `#upl-spreadsheet-modal` (add `hidden`)
5. Reset modal state: show loading, hide grid, hide error, hide save button

#### `_uplSsSave()` — async
1. Guard: `_uplSsBusy` → return
2. Guard: `!_uplSsGridEl || !_uplSsGridEl.jexcel || !_uplSsFile` → return
3. `_uplSsBusy = true`; disable `#upl-ss-save-btn`, set text to `'Saving…'`
4. Get data: `var rows = _uplSsGridEl.jexcel.getData(false)`
5. Serialize based on format:
   - **XLSX** (`_uplSsFile.mime_type === _XLSX_MIME_SS`):
     ```javascript
     var ws = XLSX.utils.aoa_to_sheet(rows);
     var wb = XLSX.utils.book_new();
     XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
     // type:'array' returns a plain Array (not Buffer) — safe in all browsers
     var arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
     var bytes = new Uint8Array(arr);
     var fmt = 'xlsx';
     ```
   - **CSV** (`mime_type === 'text/csv'`):
     ```javascript
     var ws = XLSX.utils.aoa_to_sheet(rows);
     var csvStr = XLSX.utils.sheet_to_csv(ws);
     var bytes = new TextEncoder().encode(csvStr);
     var fmt = 'csv';
     ```
6. Base64-encode `bytes` using **chunked loop** (avoids stack overflow on large files):
   ```javascript
   var binary = '';
   var CHUNK = 8192;
   for (var i = 0; i < bytes.length; i += CHUNK) {
     binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
   }
   var b64 = btoa(binary);
   ```
7. `fetch('/home/uploads/' + _uplPid + '/files/page/' + _uplSsFile.id + '/spreadsheet', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content_b64: b64, format: fmt }) })`
8. Session-expiry check:
   ```javascript
   var ct = r.headers.get('content-type') || '';
   if (ct.includes('text/html')) throw new Error('Session expired — please refresh.');
   ```
9. If `!r.ok`: `var e = await r.json(); throw new Error(e.detail || r.status)`
10. On success: update cached file size:
    ```javascript
    var data = await r.json();
    var cached = _uplFiles.find(function(x) { return x.src === _uplSsFile.src && x.id === _uplSsFile.id; });
    if (cached) cached.size = data.size;
    _uplDocCurrentFile.size = data.size;
    _uplShowToast('Spreadsheet saved ✓');
    _uplSsClose();
    ```
11. On error: `_uplShowToast('Save failed: ' + _uplEsc(String(e)))`, re-enable save button (text back to `'💾 Save'`)
12. `finally`: `_uplSsBusy = false`

---

## Changes to `_uplDocStudioInit` (File 5 detail)

**In `static/js/home-page-uploads-docs.js`**, inside `async function _uplDocStudioInit(f)`, add **after** the existing `canWopi` variable declaration:

```javascript
var _XLSXM_DOC = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var canSpreadsheet = f.src === 'page'
  && (f.mime_type === _XLSXM_DOC || f.mime_type === 'text/csv')
  && typeof _uplSsOpen === 'function';
```

In the button-building block, add **after** the `canWopi` push and **before** the `canSign` push:

```javascript
if (canSpreadsheet) btns.push(
  '<button onclick="_uplSsOpen(_uplDocCurrentFile)" class="' + _STUDIO_BTN + '">📊 Edit Spreadsheet</button>'
);
```

The `typeof _uplSsOpen === 'function'` guard is defensive: if the spreadsheet JS file fails to load for any reason (CDN outage, network block), the button simply won't appear rather than producing a broken onclick.

---

## `base.html` Change (File 4 detail)

Add **exactly one line** at line 587, immediately after the existing `uploads-wopi.js` script tag:

```html
<script src="/static/js/home-page-uploads-spreadsheet.js?v={{ static_v }}" defer></script>
```

Final load order for uploads companions (lines 583–587):
```
583: home-page-uploads-tags.js
584: home-page-uploads-docs.js
585: home-page-uploads-sign.js
586: home-page-uploads-wopi.js
587: home-page-uploads-spreadsheet.js   ← NEW
```

`_uplSsOpen` must be defined before a user can click the button. Since `defer` executes after DOM parse, and the button only appears after `_uplDocStudioInit` runs (triggered by user clicking a file in the detail panel), load order is safe.

---

## Skills to Invoke

- **`bookworm-template-audit`** — after touching `home_page_uploads.html`, `base.html`, and the two JS files. Specifically check: `var` usage in new JS, `?v={{ static_v }}` present, no `<script>` blocks added to the template partial, no broken `hx-target` references.
- **`bookworm-pre-commit`** — before committing. Key checks: `_demo_guard` on new PUT endpoint, no raw `aiosqlite.connect()`, no hardcoded secrets.
- **`bookworm-docs-keeper`** — after implementation, to update CODEPUPPY_NOTES.md with the new endpoint (`PUT /spreadsheet`), new JS file, and Phase 7 completion note.

No DB migration skill needed (no schema changes).
No widget scaffolder needed (not a widget).

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #13 — `var` not `let`/`const` in partial `<script>` blocks**
The new JS file is loaded via `<script defer>` in `base.html`, not re-injected by HTMX, so technically `let`/`const` are safe from the "already declared" re-injection trap. However, house style mandates `var` throughout all uploads companion files for consistency. Use `var` everywhere in the new file.

**CODEPUPPY_NOTES — "Don't add more CDN script tags to base.html"**
The notes flag this as tech debt: *"Until then, don't add more CDN script tags."* This plan avoids the prohibition entirely by **dynamically injecting** CDN scripts at runtime via JS when the modal first opens. CDN bytes are never loaded for pages that don't use the spreadsheet editor. Only one new app-local `<script>` tag is added to `base.html`.

**Quirk #18 — `/uploads/<uuid>` StaticFiles mount is unguarded**
`_uplSsRender` fetches the raw file via `fetch('/uploads/' + f.filename)`. This is intentional — it mirrors how `#upl-viewer-embed` loads PDFs. The UUID filename is unguessable; user is already authenticated. Document this in a comment in the JS file referencing Quirk #18.

**Quirk #20 — `_uplJsStr` vs `_uplEsc`**
The `onclick="_uplSsOpen(_uplDocCurrentFile)"` button passes an object reference — no string escaping needed. If future changes embed a filename in a JS string literal inside an onclick attribute, use `_uplJsStr(name)`, not `_uplEsc(name)`.

**`_demo_guard` on the new write endpoint**
`page_uploads` is a per-user table, but ALL write routes in the uploads router include `_demo_guard`. Add it as the very first statement in the new endpoint body.

**Session-expiry check before `r.json()`**
The auth middleware silently follows `302 → /login` redirects inside `fetch()`, delivering HTML to the caller. Always check `r.headers.get('content-type').includes('text/html')` before calling `r.json()`. Pattern is already used throughout `home-page-uploads-docs.js` — copy it exactly in `_uplSsSave`.

**`btoa` stack overflow on large `Uint8Array`**
`btoa(String.fromCharCode(...bytes))` with spread syntax will throw `RangeError: Maximum call stack size exceeded` for large XLSX files. Use the chunked loop (CHUNK = 8192) shown in the `_uplSsSave` implementation detail above.

**Jspreadsheet CE v5 instance API**
`jspreadsheet(el, opts)` mutates the element: the API is available at `el.jexcel` (not on the return value). Use `el.jexcel.getData(false)` and `el.jexcel.destroy()`. The return value is `[el]`. Verify this against the CDN v5 bundle at implementation time — v4 and v5 have different method names.

**SheetJS `XLSX.write` type: 'array'**
Use `{ bookType: 'xlsx', type: 'array' }` (not `'buffer'` which is Node-only) to get a plain JS `Array`. Wrap with `new Uint8Array(arr)` before base64-encoding.

---

## Implementation Checklist

- [ ] **1 — Pydantic model** — Add `SpreadsheetBody` + `MAX_SPREADSHEET_BYTES = 10_000_000` to `routers/home_uploads_docs.py` alongside existing models. Confirm `base64` is already imported (it is, line 13).
- [ ] **2 — PUT endpoint** — Add `PUT /{pid}/files/page/{fid}/spreadsheet` to `routers/home_uploads_docs.py` after `save_content`. Full auth + MIME + size guards. Uses existing `update_page_upload_size`.
- [ ] **3 — Modal HTML** — Add `#upl-spreadsheet-modal` to `templates/partials/home_page_uploads.html` before the closing `/uploads-page-root` div. No `<script>` blocks. Match WOPI modal structure exactly.
- [ ] **4 — New JS file** — Create `static/js/home-page-uploads-spreadsheet.js`. All `var`. Functions: `_uplSsLoadScript`, `_uplSsLoadStyle`, `_uplSsLoadLibs`, `_uplSsOpen`, `_uplSsRender`, `_uplSsShowError`, `_uplSsClose`, `_uplSsSave`. Under 600 lines.
- [ ] **5 — base.html** — Add `<script defer src="...home-page-uploads-spreadsheet.js?v={{ static_v }}">` at line 587. One line only.
- [ ] **6 — `_uplDocStudioInit`** — Add `canSpreadsheet` variable + `📊 Edit Spreadsheet` button push in `home-page-uploads-docs.js`. Place button after Collabora button, before Sign PDF.
- [ ] **7 — Smoke test: CSV** — Upload a 3-column CSV → click 📊 Edit Spreadsheet → confirm grid renders with correct data → edit cell → Save → re-open → confirm edit persisted on disk.
- [ ] **8 — Smoke test: XLSX** — Same flow with an XLSX file → confirm bytes written correctly (re-download, open in Excel/LibreOffice, verify edits appear).
- [ ] **9 — Smoke test: read-only guard** — Open a note-src CSV file → confirm 📊 Edit Spreadsheet button is absent (button only added when `f.src === 'page'`).
- [ ] **10 — Smoke test: multi-sheet toast** — Upload a 2-sheet XLSX → open editor → confirm toast warns "Showing sheet 1 of 2. Save will keep only this sheet."
- [ ] **11 — Smoke test: demo mode** — Enable demo user, upload XLSX, try save → confirm `_demo_guard` returns 403 toast, file unchanged on disk.
- [ ] **12 — bookworm-template-audit** — Pass exact files changed and what was modified. Specifically: new JS file uses `var`, `base.html` has `?v={{ static_v }}`, no `<script>` inside the partial template.
- [ ] **13 — bookworm-pre-commit** — Pass files staged. Confirm no temp debug files, no hardcoded secrets.
- [ ] **14 — bookworm-docs-keeper** — Update CODEPUPPY_NOTES.md: new endpoint row in key file map, new JS file row, Phase 7 complete entry in Features Completed section.

---

## Open Questions

1. **UX: two buttons for XLSX/CSV when Collabora is configured?**
   Both XLSX and CSV are already in `_WOPI_MIMES`, so when `BW_COLLABORA_URL` is set, both file types get an "🖊️ Edit in Collabora" button AND (with this feature) a "📊 Edit Spreadsheet" button. **Recommendation: keep both.** Jspreadsheet is zero-config and works offline; Collabora requires server setup and a running Docker service. Users without Collabora get only Jspreadsheet. Users with Collabora can choose. Confirm this UX with the team.

2. **Multi-sheet XLSX preservation**
   v1 saves only the first sheet, silently discarding sheets 2+. The toast warning mitigates user surprise. If multi-sheet support is needed before ship, flag it now — it requires a sheet-tab switcher UI and tracking which sheet is active. Recommend punting to a future revision.

3. **Jspreadsheet CE license compatibility**
   Jspreadsheet CE is MIT-licensed for personal/open-source. Confirm with Walmart open-source policy that MIT-licensed code is acceptable in this internal tool. If a commercial license is required, evaluate [Handsontable Community Edition](https://github.com/handsontable/handsontable) (MIT) or a pure SheetJS + plain `<table>` contenteditable approach as fallback.

4. **Large files near 10 MB limit**
   A 10 MB XLSX with thousands of rows may be slow to parse in-browser on older hardware. Consider a client-side row count warning: if SheetJS parses >10,000 rows, show a banner: "Large file — editing may be slow." No action needed unless users report sluggishness.

5. **CDN availability behind Walmart proxy**
   `cdn.jsdelivr.net` and `cdn.sheetjs.com` may be blocked on Eagle WiFi behind the Walmart proxy. Since the CDN scripts are loaded lazily, a CDN outage just means the modal shows an error toast (controlled by `.catch` in `_uplSsOpen`) rather than breaking the rest of Document Studio. For air-gapped environments, the fix is vendoring the JS files into `static/js/vendor/` — out of scope for v1, but worth noting.
