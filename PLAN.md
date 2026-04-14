# Plan: Document Studio — Uploads Homespace Phase 4
Date: 2026-04-14
Estimated complexity: High

## Summary
Add server-side document processing to the Uploads Homespace page: full-content read
(text files + Word docs), inline text editing with save-back, PDF merge + text
concatenate (Combine), canvas-drawn visual signature stamping on PDFs (Sign), and
format conversion (docx→PDF, txt→PDF, PDF→txt, docx→txt). All operations surface in
an expandable "Document Studio" section inside the existing `#uploads-detail-panel` —
no new page route, no new homespace type. Multi-select checkboxes on grid cards drive
the Combine workflow with a floating selection toolbar. All write operations are
`src='page'` only — note-attached files remain strictly read-only. No LibreOffice, no
PKI signing, no PDF.js CDN, no Excel support, no version history. Video/audio players
were already shipped in Phase 3 and are explicitly out of scope here.

---

## Files to Change
Ordered to resolve dependencies before consumers.

| # | File | What changes |
|---|---|---|
| 1 | `requirements.txt` | Add `pypdf>=4.0.0`, `python-docx>=1.1.0`, `reportlab>=4.0.0` |
| 2 | `main.py` | Import and `include_router` for the new `home_uploads_docs` router |
| 3 | `static/js/home-page-uploads.js` | Add 2 hook calls + 1 DOM placeholder; move 2 helpers to tags file (net −4 lines, stays ≤600) |
| 4 | `templates/partials/home_page_uploads.html` | Add Combine modal + Signature modal HTML (no `<script>` blocks) |
| 5 | `templates/base.html` or `templates/index.html` | Add `<script src="/static/js/home-page-uploads-docs.js?v={{ static_v }}">` after the tags companion tag |

### Detail on file 3 — `home-page-uploads.js` changes (keep ≤ 600 lines)

**Step A — Move helpers to companion file first (−10 lines):**
Move `_uplFmtSize(bytes)` and `_uplFmtDate(s)` from the bottom of
`home-page-uploads.js` to the bottom of `home-page-uploads-tags.js`. Both are pure
utilities with no dependency on main-file state. Mark with `// moved from main file`.

**Step B — Add hooks (+6 lines):**

In `_uplRenderDetail(f)` — append one placeholder `<div>` to the `el.innerHTML`
string (inside the existing template literal, after the `upl-tags-area` block):
```html
<div id="upl-doc-studio" class="mt-4"></div>
```
Then after `_uplLoadTags(f.src, f.id);` at the end of the function body:
```javascript
if (typeof _uplDocStudioInit === 'function') _uplDocStudioInit(f);
```

In `_uplRender()` — at the very end of the function body (after `_uplRenderPager()`):
```javascript
if (typeof _uplDocAfterRender === 'function') _uplDocAfterRender();
```

These two defensive guards are zero-cost when the docs JS is absent.

---

## New Files to Create

| File | Purpose |
|---|---|
| `routers/home_uploads_docs.py` | 5 new API endpoints (read content, save, combine, sign, convert). Router prefix `/home/uploads`. Kept separate from `home_uploads.py` (already 8.9 KB). |
| `routers/uploads_docs_db.py` | DB helpers: `update_page_upload_size()`, `get_page_upload_owned_bulk()` |
| `static/js/home-page-uploads-docs.js` | Document Studio JS module (≤ 600 lines). Entry points: `_uplDocStudioInit(f)` + `_uplDocAfterRender()`. Multi-select, combine toolbar, edit UI, convert UI, sign UI. |

---

## DB Migrations Needed

**None.** No schema changes are required for Phase 4.

All operations either:
- Read existing files (no DB write)
- Overwrite a file on disk + run `UPDATE page_uploads SET size = ? WHERE id = ? AND user_id = ?` (no column additions needed)
- Create a new derived file via the existing `create_page_upload()` helper already in `uploads_db.py`

The existing tables are fully sufficient:
```sql
page_uploads: id, page_id, user_id, filename, original_name, mime_type, size, created_at
```
`size` is already present. No `updated_at` column is needed for v1 (out of scope).

---

## New Python Dependencies

Add to `requirements.txt`:
```
pypdf>=4.0.0
python-docx>=1.1.0
reportlab>=4.0.0
```

**⚠️ Verify each on the Walmart PyPI mirror before adding:**
```
uv pip index versions pypdf --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple --allow-insecure-host pypi.ci.artifacts.walmart.com
uv pip index versions python-docx --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple --allow-insecure-host pypi.ci.artifacts.walmart.com
uv pip index versions reportlab --index-url https://pypi.ci.artifacts.walmart.com/artifactory/api/pypi/external-pypi/simple --allow-insecure-host pypi.ci.artifacts.walmart.com
```
If any package is absent from the mirror, stop and escalate — do NOT use a public PyPI fallback on Walmart network.

**Why these three (not others):**
- `pypdf` — pure-Python PDF read/write/merge/stamp. Replaces deprecated `PyPDF2`. No system dependencies.
- `python-docx` — pure-Python .docx text extraction and round-trip writing. No LibreOffice.
- `reportlab` — pure-Python PDF generation from text/paragraph content. No LibreOffice.
- `Pillow` — already in `requirements.txt` (`Pillow>=10.0.0`). Used for signature image resizing.

**YAGNI — do NOT add:** `mammoth` (docx→HTML overkill), `pikepdf` (needs system QPDF lib),
`weasyprint` (needs GTK), `fpdf2` (duplicate of reportlab's role).

---

## Endpoint Table

All 5 endpoints live in `routers/home_uploads_docs.py` with router prefix `/home/uploads`.
Full paths are `/home/uploads/{page_id}/...`.

| Method | Path (relative to prefix) | Demo Guard | Body | Response |
|--------|--------------------------|------------|------|----------|
| `GET` | `/{pid}/files/{src}/{id}/content` | No (read) | — | `{content: str, content_type: "text"\|"docx_html"}` |
| `PUT` | `/{pid}/files/page/{id}/content` | ✅ Yes | `{content: str}` | `{ok: true, size: int}` |
| `POST` | `/{pid}/files/page/combine` | ✅ Yes | `{ids: [int], output_name: str, combine_type: "pdf"\|"text"}` | `{ok: true, file: {id, original_name, size}}` |
| `POST` | `/{pid}/files/page/{id}/sign` | ✅ Yes | `{signature_data: "data:image/png;base64,...", page_num: int}` | `{ok: true, size: int}` |
| `POST` | `/{pid}/files/page/{id}/convert` | ✅ Yes | `{to_format: "pdf"\|"txt"}` | `{ok: true, file: {id, original_name, size}}` |

### Auth pattern (mirrors existing `home_uploads.py` exactly):
```python
from routers.home_uploads import _demo_guard, _require_uploads_page

uid = request.session.get("user_id")
if not uid:
    raise HTTPException(status_code=401)
await _require_uploads_page(page_id, uid)
```

### GET `/{pid}/files/{src}/{id}/content` — pseudocode
```python
# Ownership check (mirrors download endpoints)
if src == 'note':
    row = await get_note_attachment_owned(id, uid)   # from uploads_db.py
else:
    row = await get_page_upload_owned(id, uid)       # from uploads_db.py
if not row:
    raise HTTPException(404)

disk_path = UPLOAD_DIR / row["filename"]
mime = row["mime_type"]

if mime.startswith("text/") or mime == "application/json":
    text = disk_path.read_text(errors="replace")
    return JSONResponse({"content": text, "content_type": "text"})

if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    from docx import Document
    from html import escape
    doc = Document(disk_path)
    paras = [escape(p.text) for p in doc.paragraphs if p.text.strip()]
    html_content = "<br>".join(f"<p>{p}</p>" for p in paras)
    return JSONResponse({"content": html_content, "content_type": "docx_html"})

raise HTTPException(400, "Content read not supported for this file type")
```

### PUT `/{pid}/files/page/{id}/content` — pseudocode
```python
if guard := _demo_guard(request): return guard
row = await get_page_upload_owned(id, uid)
if not row:
    raise HTTPException(404)
mime = row["mime_type"]
if not (mime.startswith("text/") or mime == "application/json"):
    raise HTTPException(400, "Only text files are editable")
data = body.content.encode("utf-8")
(UPLOAD_DIR / row["filename"]).write_bytes(data)
await update_page_upload_size(id, uid, len(data))   # uploads_docs_db.py
return JSONResponse({"ok": True, "size": len(data)})
```

### POST `/{pid}/files/page/combine` — pseudocode
```python
if guard := _demo_guard(request): return guard
if not 2 <= len(body.ids) <= 20:
    raise HTTPException(400, "Select 2–20 files")
rows = await get_page_upload_owned_bulk(body.ids, uid)   # uploads_docs_db.py
if len(rows) != len(body.ids):
    raise HTTPException(404, "One or more files not found")

output_name = (body.output_name.strip() or "combined")[:80]

if body.combine_type == "pdf":
    if any(r["mime_type"] != "application/pdf" for r in rows):
        raise HTTPException(400, "All files must be PDFs for PDF merge")
    import pypdf, io
    writer = pypdf.PdfWriter()
    for r in rows:
        reader = pypdf.PdfReader(str(UPLOAD_DIR / r["filename"]))
        for page in reader.pages:
            writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    data = buf.getvalue()
    stored_name = f"{uuid.uuid4().hex}.pdf"
    (UPLOAD_DIR / stored_name).write_bytes(data)
    new_id = await create_page_upload(page_id, uid, stored_name,
                                       output_name + ".pdf", "application/pdf", len(data))
    return JSONResponse({"ok": True, "file": {"id": new_id, "original_name": output_name + ".pdf", "size": len(data)}})

if body.combine_type == "text":
    if any(not r["mime_type"].startswith("text/") for r in rows):
        raise HTTPException(400, "All files must be text files for text join")
    parts = []
    for r in rows:
        parts.append(f"── {r['original_name']} ──\n")
        parts.append((UPLOAD_DIR / r["filename"]).read_text(errors="replace"))
        parts.append("\n\n")
    data = "".join(parts).encode("utf-8")
    stored_name = f"{uuid.uuid4().hex}.txt"
    (UPLOAD_DIR / stored_name).write_bytes(data)
    new_id = await create_page_upload(page_id, uid, stored_name,
                                       output_name + ".txt", "text/plain", len(data))
    return JSONResponse({"ok": True, "file": {"id": new_id, "original_name": output_name + ".txt", "size": len(data)}})

raise HTTPException(400, "combine_type must be 'pdf' or 'text'")
```

### POST `/{pid}/files/page/{id}/sign` — pseudocode
```python
if guard := _demo_guard(request): return guard
row = await get_page_upload_owned(id, uid)
if not row or row["mime_type"] != "application/pdf":
    raise HTTPException(400, "File must be a PDF")

import base64, io, PIL.Image, pypdf
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.utils import ImageReader

# Decode base64 PNG from canvas.toDataURL()
header, b64 = body.signature_data.split(",", 1)
sig_bytes = base64.b64decode(b64)
sig_img = PIL.Image.open(io.BytesIO(sig_bytes)).convert("RGBA")

# Build overlay PDF with signature stamped at fixed lower-right position
reader = pypdf.PdfReader(str(UPLOAD_DIR / row["filename"]))
writer = pypdf.PdfWriter()
writer.append(reader)

target_page = writer.pages[min(body.page_num, len(writer.pages) - 1)]
pg_w = float(target_page.mediabox.width)
pg_h = float(target_page.mediabox.height)

# Fixed placement: lower-right, signature width = 30% of page width
sig_w_pt = pg_w * 0.30
sig_h_pt = sig_w_pt * sig_img.height / sig_img.width
x_pt = pg_w - sig_w_pt - 36   # 0.5 inch right margin
y_pt = 36                       # 0.5 inch bottom margin

overlay_buf = io.BytesIO()
c = rl_canvas.Canvas(overlay_buf, pagesize=(pg_w, pg_h))
c.drawImage(ImageReader(sig_img), x_pt, y_pt,
            width=sig_w_pt, height=sig_h_pt, mask='auto')
c.save()

overlay_reader = pypdf.PdfReader(overlay_buf)
target_page.merge_page(overlay_reader.pages[0])

out_buf = io.BytesIO()
writer.write(out_buf)
data = out_buf.getvalue()
(UPLOAD_DIR / row["filename"]).write_bytes(data)   # overwrite in-place
await update_page_upload_size(id, uid, len(data))
return JSONResponse({"ok": True, "size": len(data)})
```

### POST `/{pid}/files/page/{id}/convert` — conversion matrix

| Source `mime_type` | `to_format` | Operation | Output mime |
|---|---|---|---|
| `text/*` | `pdf` | reportlab paragraph-per-line | `application/pdf` |
| `.docx` | `pdf` | python-docx extract paragraphs → reportlab | `application/pdf` |
| `.docx` | `txt` | python-docx extract paragraphs → join | `text/plain` |
| `application/pdf` | `txt` | `pypdf.PdfReader.pages[n].extract_text()` join | `text/plain` |

All conversions produce a NEW `page_uploads` row (new UUID filename, new DB row). The
original file is never modified. Output `original_name` = `stem(original) + "." + to_format`.

For text→PDF with reportlab:
```python
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import pt
buf = io.BytesIO()
doc = SimpleDocTemplate(buf, pagesize=A4,
                         leftMargin=72, rightMargin=72, topMargin=72, bottomMargin=72)
styles = getSampleStyleSheet()
story = []
for line in text.splitlines():
    story.append(Paragraph(line or "&nbsp;", styles["Normal"]))
    story.append(Spacer(1, 4 * pt))
doc.build(story)
```

---

## New DB Helper Functions (`routers/uploads_docs_db.py`)

```python
"""DB helpers for Document Studio (home_uploads_docs.py).
Uses get_db() exclusively — never raw aiosqlite.connect().
"""
from database import get_db


async def update_page_upload_size(upload_id: int, user_id: int, size: int) -> None:
    """Update stored byte-size after in-place edit or sign stamp."""
    async with get_db() as db:
        await db.execute(
            "UPDATE page_uploads SET size = ? WHERE id = ? AND user_id = ?",
            (size, upload_id, user_id),
        )
        await db.commit()


async def get_page_upload_owned_bulk(
    ids: list[int], user_id: int
) -> list[dict]:
    """Fetch multiple page_uploads rows that all belong to user_id.

    Returns rows in the same order as ids.
    Rows missing from DB (not found or wrong owner) are silently omitted —
    caller must check len(result) == len(ids) to detect partial misses.
    """
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT id, page_id, filename, original_name, mime_type, size "
            f"FROM page_uploads "
            f"WHERE id IN ({placeholders}) AND user_id = ?",
            (*ids, user_id),
        )
        rows = await cur.fetchall()
    by_id = {r["id"]: dict(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]
```

`create_page_upload()` already exists in `uploads_db.py` — import directly in the
docs router, no duplication.

---

## `home-page-uploads-docs.js` Module Plan (≤ 600 lines)

Follows companion-file pattern of `home-page-uploads-tags.js`:
reads shared state from main file (`_uplPid`, `_uplFiles`, `_uplMeta`, `_uplEsc`,
`_uplJsStr`, `_uplShowToast`, `_uplFetch`, `_uplMimeGroup`) via global scope.

```
// ── Module state ─────────────────────────────────────────────────────────────
var _uplDocSelectMode = false;   // whether multi-select is active in the grid
var _uplDocSelected   = {};      // key "src:id" → {src, id, mime_type, original_name}
var _uplDocBusy       = false;   // request in-flight guard

// ── Hook called by _uplRenderDetail (main file) after panel HTML is written ──
function _uplDocStudioInit(f)          ~65 lines
  Builds content of #upl-doc-studio based on f.src and f.mime_type.
  Decision matrix: (see table in UI Design section above)
  For note-src: shows read-only label, no write controls.
  For page-src text/*: "View Full Content" + "Edit" + "→ PDF" convert button.
  For page-src PDF: "Sign" button + "→ TXT" convert button.
  For page-src .docx: "View Content" + "→ PDF" + "→ TXT" convert buttons.
  For other types: renders nothing (section stays empty).

// ── Hook called by _uplRender (main file) after grid is rebuilt ──────────────
function _uplDocAfterRender()          ~35 lines
  If _uplDocSelectMode:
    - inject checkboxes on every page-src card (note-src cards get none)
    - re-tick already-selected cards from _uplDocSelected
    - inject/update floating toolbar at bottom of #uploads-main
  Always: inject "☐ Select" toggle button into filter bar if any page-src docs/PDFs exist.

// ── Multi-select ──────────────────────────────────────────────────────────────
function _uplDocToggleSelectMode()     ~15 lines
function _uplDocToggleItem(src, id)    ~20 lines
function _uplDocRenderToolbar()        ~45 lines
  Floating sticky bar: "N files selected | [Merge PDFs] [Join Text] [✕ Clear]"
  Merge PDFs = enabled only when ALL selected are application/pdf.
  Join Text  = enabled only when ALL selected are text/*.
  If mixed types: both disabled with tooltip "select same-type files".

// ── Full content view ─────────────────────────────────────────────────────────
async function _uplDocShowFullContent(f)   ~45 lines
  GET /{pid}/files/{src}/{id}/content
  Renders in #upl-doc-studio:
    - text: <pre class="...max-h-96 overflow-y-auto ...">
    - docx_html: <div class="...max-h-96 overflow-y-auto ..."> rendered HTML
  Shows char/line count. "Collapse" toggle resets to buttons view.

// ── Text edit ─────────────────────────────────────────────────────────────────
function _uplDocEnterEditMode(f)       ~35 lines
  Replaces #upl-doc-studio content with:
    <textarea> pre-filled with current content (via GET /content if not yet loaded)
    [Save] [Cancel] buttons
async function _uplDocSaveEdit(f)      ~30 lines
  PUT /{pid}/files/page/{id}/content
  On success: update f.size in _uplFiles, refresh size display, exit edit mode.
function _uplDocCancelEdit()           ~10 lines

// ── Convert ──────────────────────────────────────────────────────────────────
async function _uplDocConvert(src, id, toFmt)  ~35 lines
  POST /{pid}/files/page/{id}/convert
  On success: _uplShowToast("Converted → filename"), _uplFetch(_uplMeta.page)
              and open the new file's detail panel.

// ── Combine (multi-select workflow) ──────────────────────────────────────────
function _uplDocOpenCombineModal(combineType)  ~30 lines
  Validates selection (min 2), sets #upl-combine-desc, opens #upl-combine-modal.
async function _uplDocDoCombine()      ~40 lines
  POST /{pid}/files/page/combine with current _uplDocSelected ids + modal name.
  On success: exit select mode, refresh grid, toast "Combined → filename".
function _uplDocCloseCombineModal()    ~8 lines

// ── Sign (PDF, page-src only) ─────────────────────────────────────────────────
function _uplDocOpenSignModal(f)       ~25 lines
  Opens #upl-sig-modal. Wires #upl-sig-confirm-btn onclick to _uplDocDoSign(f).
  Calls _uplDocInitCanvas().
function _uplDocInitCanvas()           ~45 lines
  pointerdown / pointermove / pointerup drawing on #upl-sig-canvas.
  Respects dark mode (dark bg, white stroke or vice-versa — use black on white).
function _uplDocClearCanvas()          ~6 lines
async function _uplDocDoSign(f)        ~35 lines
  canvas.toDataURL("image/png") → POST /{pid}/files/page/{id}/sign
  On success: update f.size in _uplFiles, _uplShowToast("Signature stamped").
function _uplDocCloseSignModal()       ~8 lines

// ── Utility (shared with main file globals) ───────────────────────────────────
// _uplFmtSize and _uplFmtDate are moved HERE from home-page-uploads.js (Step A).
function _uplFmtSize(bytes)   ~6 lines   // moved
function _uplFmtDate(s)       ~8 lines   // moved
```

**Estimated line count:** ~550 lines including comments and blank lines. Safe under 600.

---

## Template Changes (`home_page_uploads.html`)

Add two modal `<div>` blocks immediately before the closing `</div>{# /uploads-page-root #}` tag.
Zero `<script>` blocks. All event wiring via `onclick="..."` attrs or programmatic `.onclick` in JS.

### Combine Modal (`#upl-combine-modal`)

```html
{# ── Combine documents modal ─────────────────────────────────────────────── #}
<div id="upl-combine-modal"
     class="hidden fixed inset-0 z-50 flex items-center justify-center"
     role="dialog" aria-modal="true" aria-labelledby="upl-combine-title"
     onkeydown="if(event.key==='Escape')_uplDocCloseCombineModal()">
  <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
       onclick="_uplDocCloseCombineModal()" aria-hidden="true"></div>
  <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
              w-full max-w-sm mx-4 p-6">
    <h2 id="upl-combine-title"
        class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-1">
      Combine Files
    </h2>
    <p id="upl-combine-desc"
       class="text-xs text-gray-500 dark:text-zinc-400 mb-4"></p>
    <label class="block text-xs font-semibold text-gray-700 dark:text-zinc-300 mb-1"
           for="upl-combine-name">
      Output filename
    </label>
    <input id="upl-combine-name"
           class="w-full border border-gray-200 dark:border-zinc-700 rounded-lg
                  px-3 py-2 text-sm bg-white dark:bg-zinc-800
                  text-gray-800 dark:text-zinc-100
                  focus:outline-none focus:ring-2 focus:ring-[#0053e2] mb-4"
           placeholder="combined" />
    <div class="flex gap-3 justify-end">
      <button type="button" onclick="_uplDocCloseCombineModal()"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300
                     dark:border-zinc-600 text-gray-700 dark:text-zinc-300
                     hover:bg-gray-50 dark:hover:bg-zinc-800 transition
                     focus:outline-none focus:ring-2 focus:ring-gray-300">
        Cancel
      </button>
      <button id="upl-combine-confirm-btn" type="button"
              onclick="_uplDocDoCombine()"
              class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white
                     font-semibold hover:bg-[#003eb3] transition
                     focus:outline-none focus:ring-2 focus:ring-[#0053e2]">
        Combine
      </button>
    </div>
  </div>
</div>
```

### Signature Modal (`#upl-sig-modal`)

```html
{# ── Signature modal ─────────────────────────────────────────────────────── #}
<div id="upl-sig-modal"
     class="hidden fixed inset-0 z-50 flex items-center justify-center"
     role="dialog" aria-modal="true" aria-labelledby="upl-sig-title"
     onkeydown="if(event.key==='Escape')_uplDocCloseSignModal()">
  <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
       onclick="_uplDocCloseSignModal()" aria-hidden="true"></div>
  <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl
              w-full max-w-md mx-4 p-6">
    <h2 id="upl-sig-title"
        class="text-base font-bold text-gray-900 dark:text-zinc-100 mb-1">
      Draw Signature
    </h2>
    <p class="text-xs text-gray-500 dark:text-zinc-400 mb-3">
      Sign in the box below. The signature will be stamped onto the PDF.
    </p>
    <canvas id="upl-sig-canvas" width="400" height="150"
            class="w-full rounded-xl border-2 border-dashed
                   border-gray-300 dark:border-zinc-600
                   bg-white cursor-crosshair touch-none"
            aria-label="Signature drawing area"
            role="img"></canvas>
    <div class="flex items-center gap-3 mt-3 mb-4">
      <label class="text-xs text-gray-600 dark:text-zinc-400 flex-shrink-0"
             for="upl-sig-page-num">
        PDF page (0 = first):
      </label>
      <input id="upl-sig-page-num" type="number" value="0" min="0"
             class="w-16 border border-gray-200 dark:border-zinc-700 rounded-lg
                    px-2 py-1 text-xs bg-white dark:bg-zinc-800
                    text-gray-800 dark:text-zinc-100
                    focus:outline-none focus:ring-1 focus:ring-[#0053e2]" />
      <button type="button" onclick="_uplDocClearCanvas()"
              class="ml-auto text-xs px-3 py-1 rounded-lg border
                     border-gray-300 dark:border-zinc-600
                     text-gray-500 dark:text-zinc-400
                     hover:text-gray-800 dark:hover:text-zinc-100
                     hover:bg-gray-50 dark:hover:bg-zinc-800 transition">
        Clear
      </button>
    </div>
    <div class="flex gap-3 justify-end">
      <button type="button" onclick="_uplDocCloseSignModal()"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300
                     dark:border-zinc-600 text-gray-700 dark:text-zinc-300
                     hover:bg-gray-50 dark:hover:bg-zinc-800 transition
                     focus:outline-none focus:ring-2 focus:ring-gray-300">
        Cancel
      </button>
      <button id="upl-sig-confirm-btn" type="button"
              class="px-4 py-2 text-sm rounded-lg bg-[#0053e2] text-white
                     font-semibold hover:bg-[#003eb3] transition
                     focus:outline-none focus:ring-2 focus:ring-[#0053e2]">
        Stamp Signature
      </button>
    </div>
  </div>
</div>
```
The `#upl-sig-confirm-btn` `onclick` is wired programmatically by `_uplDocOpenSignModal(f)`
so it captures the `f` closure. Do not hardcode it in the template.

---

## `main.py` Changes

```python
# After existing line (from routers import home_uploads as home_uploads_router):
from routers import home_uploads_docs as home_uploads_docs_router

# After existing line (app.include_router(home_uploads_router.router)):
app.include_router(home_uploads_docs_router.router)
```

No new `_PUBLIC` entries needed — all 5 endpoints require a valid session cookie.

---

## `base.html` / `index.html` — Script Tag Addition

Locate the existing `home-page-uploads-tags.js` `<script>` tag (grep to find it):
```
grep -n "home-page-uploads-tags" templates/base.html templates/index.html
```
Add the docs companion immediately after it:
```html
<script src="/static/js/home-page-uploads-docs.js?v={{ static_v }}"></script>
```
Load order must be: `home-page-uploads.js` → `home-page-uploads-tags.js` → `home-page-uploads-docs.js`.
The docs file depends on globals from both predecessors.

---

## Document Studio UI — Detail Panel Decision Matrix

`_uplDocStudioInit(f)` populates `<div id="upl-doc-studio">` based on file type and source.

| File condition | Read (full) | Edit | Sign | Convert |
|---|---|---|---|---|
| `src='note'`, any type | ✅ read-only label | ❌ | ❌ | ❌ |
| `src='page'`, `text/*` or `application/json` | ✅ | ✅ | ❌ | → PDF |
| `src='page'`, `application/pdf` | embed already shown | ❌ | ✅ | → TXT |
| `src='page'`, `.docx` | ✅ extracted text | ❌ v1 | ❌ | → PDF, → TXT |
| All other types | ❌ | ❌ | ❌ | ❌ (section hidden) |

If no operations are available, `#upl-doc-studio` renders nothing (zero height, invisible).

### Multi-select toolbar (floating, bottom of `#uploads-main`)
```
┌──────────────────────────────────────────────────────────────────┐
│  📄 3 files selected   [Merge PDFs]  [Join Text]   [✕ Clear]     │
└──────────────────────────────────────────────────────────────────┘
```
- Injected by `_uplDocAfterRender()` as a `position:sticky; bottom:0` div at the bottom of
  `#uploads-main` when `_uplDocSelectMode === true` and `Object.keys(_uplDocSelected).length > 0`.
- "Merge PDFs" is enabled only when all selected files are `application/pdf`.
- "Join Text" is enabled only when all selected files are `text/*`.
- Mixed-type selection: both disabled, tooltip = "Select files of the same type to combine".
- Multi-select is activated by a "☐ Select" button injected at the end of the filter tab bar.
  The button is only shown when at least one `src='page'` document or PDF is in the current view.
- Only `src='page'` cards get checkboxes. `src='note'` cards are never selectable.

---

## Rollout Order — Build Sequence

Build in this order to enable incremental testing at each step.

1. **Deps + skeleton** — add 3 deps to `requirements.txt`; create empty
   `home_uploads_docs.py` (just the `router = APIRouter(...)` line) + `uploads_docs_db.py`
   with only import stubs; add `include_router` in `main.py`. Restart + health check.

2. **GET /content endpoint** — implement read for `text/*` and `.docx`.
   Test with curl: `curl -b cookies.txt /home/uploads/1/files/page/1/content`.

3. **Full-content read UI in docs JS** — create `home-page-uploads-docs.js`; implement
   `_uplDocStudioInit(f)` and `_uplDocShowFullContent(f)` only. Add the hook call to
   `home-page-uploads.js` (Step B) and the `<script>` tag to base/index. Test: open a
   text file, click "View Full Content", see untruncated text in the detail panel.

4. **Text editing** — add `PUT /content` endpoint; add `_uplDocEnterEditMode`,
   `_uplDocSaveEdit`, `_uplDocCancelEdit` to docs JS. Test round-trip.

5. **Template additions** — add Combine + Signature modals to `home_page_uploads.html`.
   Verify page still loads; modals are hidden by default.

6. **Multi-select + Combine** — implement `_uplDocAfterRender`, `_uplDocToggleSelectMode`,
   `_uplDocToggleItem`, `_uplDocRenderToolbar`, `_uplDocOpenCombineModal`,
   `_uplDocDoCombine`. Add `POST /combine` endpoint. Test PDF merge + text join.

7. **Convert** — add `POST /convert` endpoint + `_uplDocConvert` in JS.
   Test all 4 conversion paths (txt→pdf, docx→pdf, docx→txt, pdf→txt).

8. **Sign** — add `POST /sign` endpoint + canvas drawing JS (`_uplDocOpenSignModal`,
   `_uplDocInitCanvas`, `_uplDocClearCanvas`, `_uplDocDoSign`). Test last as most complex.

---

## Skills to Invoke

- **`bookworm-db-migration`** — run after Step 1 even with no schema changes, to verify
  `init_db()` is still idempotent and the new deps don't break startup.
- **`bookworm-template-audit`** — after Step 5 (template modals added) and after the
  `<script>` tag is added to base/index. Check: `?v={{ static_v }}` on new script tag,
  no `let`/`const` in any `<script>` blocks (none should exist), WCAG AA on canvas.
- **`bookworm-pre-commit`** — before every commit. Checks: `_demo_guard` on all 4 write
  endpoints, `get_db()` only in `uploads_docs_db.py`, no hardcoded paths.
- **`bookworm-qa`** — after Steps 3, 6, and 8. Endpoints to verify each round:
  - Step 3: `GET /home/uploads/{pid}/files/page/{id}/content` (text file + .docx)
  - Step 6: `POST /home/uploads/{pid}/files/page/combine` (2 PDFs; 2 text files)
  - Step 8: `POST /home/uploads/{pid}/files/page/{id}/sign` (PNG stamp visible in download)
- **`bookworm-docs-keeper`** — run once at the end to update CODEPUPPY_NOTES.md with
  the 5 new endpoints, 3 new deps, and Phase 4 completion status.

---

## BookWorm Gotchas That Apply to This Feature

**Quirk #11 — UPLOAD_DIR import path**
`UPLOAD_DIR` is defined in `routers/attachments_db.py`, not at the project root.
Import it in `home_uploads_docs.py` exactly as `home_uploads.py` does:
```python
from routers.attachments_db import UPLOAD_DIR
```
Never redefine it or hard-code a path string — it respects `BW_DATA_DIR` for Docker.

**Quirk #16 — `tojson | safe` in `<script>` tags**
The docs JS module uses no Jinja2 `<script>` blocks. But: if any future change
serialises file metadata into the template, always write `{{ data | tojson | safe }}`.
Omitting `| safe` produces `&quot;`-escaped JSON that `JSON.parse()` silently mangles.

**Quirk #18 — unguarded `/uploads/<uuid>` StaticFiles mount**
The GET /content endpoint MUST serve file bytes through the authenticated FastAPI route
(read `UPLOAD_DIR / row["filename"]` server-side and return as JSON).
Do NOT redirect the client to the raw `/uploads/<uuid>` URL for content reads —
that mount has no auth gate (see Quirk #18 in CODEPUPPY_NOTES.md).
The raw mount is acceptable only for image thumbnails in the grid (already established).

**Quirk #20 — `_uplJsStr` vs `_uplEsc` for onclick embedding**
In `home-page-uploads-docs.js`, when building `onclick="fn('...')"` strings:
- `_uplJsStr(value)` — for values inside JS string literals (backslash-escapes `\` and `'`)
- `_uplEsc(value)` — for values inside HTML content or HTML attributes (HTML-encodes `& < > " '`)
Mixing them causes XSS or broken JS. This is the same rule as Quirk #20 in the main file.

**CDN ban — no PDF.js**
CODEPUPPY_NOTES.md: "don't add more CDN script tags" (Tailwind CDN already flagged as
tech debt). PDF.js from any CDN (cdnjs, unpkg, jsDelivr) is therefore prohibited for
Phase 4. The existing `<embed>` tag remains the PDF viewer. PDF editing (which would
require PDF.js or similar) is explicitly out of scope.

**Demo guard — all 4 write endpoints**
`PUT /content`, `POST /combine`, `POST /sign`, `POST /convert` must each start with:
```python
if guard := _demo_guard(request):
    return guard
```
The GET /content endpoint is read-only and does NOT get a demo guard.

**`get_db()` only — no raw connects**
`uploads_docs_db.py` must import `get_db` from `database`, never `DB_PATH` or raw
`aiosqlite.connect()`. Enforced by `bookworm-pre-commit`.

**Note-src is always read-only for write operations**
The GET /content endpoint accepts `src='note'`. All other endpoints are path-parameterised
as `.../files/page/...` which structurally prevents note-src access at the URL level.
The JS must additionally hide all write controls when `f.src === 'note'` to make this
visible to users (not just enforced silently at the server).

**`home-page-uploads.js` at line limit**
The file is currently at ~600 lines. Step A (move `_uplFmtSize` + `_uplFmtDate` to tags
file, −10 lines) must happen before Step B (add hooks, +6 lines). Net result: −4 lines.
Verify with a line count before committing:
```
findstr /c:"" static\js\home-page-uploads.js | find /c /v ""
```
(Windows equivalent of `wc -l`.)

**WCAG 2.2 AA — signature canvas**
Canvas-based drawing is not keyboard-accessible. The `<canvas>` element must have:
- `aria-label="Signature drawing area"`
- `role="img"` (already in the template above)
A visible "Clear" button is provided. A keyboard/mouse-free alternative (upload PNG)
is a Phase 5 stretch goal; note it in the UI near the canvas.

---

## YAGNI — Explicitly Out of Scope for Phase 4

| Excluded feature | Why |
|---|---|
| LibreOffice headless | Breaks Python 3.12-slim Docker image; 500 MB+ binary |
| PKI / cryptographic PDF signing | Requires HSM or cert authority; visual stamp is sufficient |
| PDF.js CDN viewer | CDN additions are banned per CODEPUPPY_NOTES.md |
| Word doc rich editing (tables, images, formatting) | No pure-Python editor without LibreOffice |
| Excel / PowerPoint conversion | Not requested; no lightweight pure-Python solution |
| Collaborative / real-time editing | No WebSocket infrastructure in BookWorm |
| Version history / undo | Out of scope; overwrite is v1 behaviour |
| Edit note-src files | Note attachments are owned by the note, not the uploads page |
| Edit PDFs inline | No pure-Python round-trip PDF editor |
| .docx edit with formatting preserved | python-docx fidelity for complex docs is poor; text-only |
| Drag-to-position signature placement | Phase 5; v1 stamps at fixed lower-right corner |
| Upload-a-PNG-signature fallback | Phase 5; canvas is sufficient for v1 |
| .docx merge (Combine output) | python-docx merge is complex; PDF merge + txt join cover the use case |
| Convert note-src files to new page-src files | Technically possible; complexity vs benefit too high for v1 |
| `.txt` → `.docx` conversion | Not requested; low value |

---

## Open Questions

1. **Walmart PyPI mirror availability** — run the three `uv pip index versions` commands
   listed in the Deps section before touching any code. If `pypdf`, `python-docx`, or
   `reportlab` are absent, the entire Phase 4 is blocked and requires IT escalation.

2. **Combine: allow note-src files as combine inputs?** — current plan excludes note-src
   from multi-select checkboxes. A user might want to merge a note-attached PDF with a
   standalone one. Decision needed before Step 6. Recommendation: exclude note-src in v1
   for simplicity; revisit in Phase 5.

3. **Signature placement** — v1 stamps at a fixed lower-right position (30% of page width,
   0.5 inch margins). Should the Signature modal expose X/Y coordinate inputs, or is the
   fixed placement acceptable for the team's use case?

4. **Max combine file count** — plan uses 20 as the hard limit. Should this be configurable
   via a `BW_MAX_COMBINE_FILES` env var? If yes, add it to `.env.example` and
   `docker-compose.yml` following the existing env var pattern.

5. **Edit size limit** — no cap on `PUT /content` body size (unlike the 4 000-char preview).
   Should there be a maximum edit payload (e.g. 1 MB) to prevent accidental overwrite of
   very large files via the textarea? Recommendation: yes, add a `MAX_EDIT_BYTES = 1_000_000`
   guard in the endpoint and show a toast in the JS when exceeded.

6. **WCAG: signature canvas keyboard alternative** — for WCAG 2.2 AA compliance, the
   canvas-only drawing path is not keyboard-accessible. Phase 4 ships without a keyboard
   alternative (flagged as known gap). Should this block the Phase 4 ship, or is it
   acceptable as a known limitation documented in the UI?
