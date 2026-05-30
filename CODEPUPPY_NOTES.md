# 🐾 CODEPUPPY_NOTES.md
> Eddie's private scratchpad. Updated each session. Helps avoid re-sniffing the whole project from scratch.

---

## 🚀 Docker & GitHub Deployment Rules
> **Eddie must check this section before making ANY code change.**
> BookWorm is designed to be cloned from GitHub and run via `docker compose up -d` by strangers.
> Every change must be safe for that path.

### ✅ Configuration — env vars only
- **No hardcoded config.** Ports, paths, secrets, feature flags → always `os.getenv("BW_*", default)`.
- Existing env vars and their defaults:

  | Variable | Default | Purpose |
  |---|---|---|
  | `BW_DATA_DIR` | `.` | Where `bookworm.db`, `bookworm.secret`, and `uploads/` live |
  | `BW_SECRET_KEY` | `load_secret_key()` (file-persisted) | Session signing key — MUST be set in prod |
  | `BW_HTTPS` | `false` | Set `true` behind a TLS proxy to enable Secure cookies + HSTS header (`Strict-Transport-Security: max-age=63072000; includeSubDomains`). |
  | `BW_ALLOW_REGISTRATION` | `true` | Seeds `site_settings.registration_open` on first boot only. After that the DB value is authoritative — toggle live in the superadmin panel. |
  | `BW_DEMO_ENABLED` | `true` | `false` = hide Try Demo button, disable `/demo/start` |
  | `BW_COLLABORA_URL` | `` (disabled) | Browser-facing URL of the Collabora Online server (e.g. `http://localhost:9980`). Empty = "Edit in Collabora" button hidden everywhere. |
  | `BW_WOPI_BASE_URL` | `` (disabled) | URL Collabora uses to reach BookWorm's WOPI endpoints (server-to-server). Must be set when `BW_COLLABORA_URL` is set. e.g. `http://bookworm:8001` (Docker bridge) |
  | `BW_WOPI_TOKEN_EXPIRY` | `3600` | WOPI access-token lifetime in seconds (default 1 hour). |
  | `BW_MAX_UPLOAD_MB` | `200` | Per-file upload size cap in megabytes. Enforced in `routers/home_uploads.py` (`_MAX_MB`) and exposed as Jinja2 global `bw_max_upload_mb` for UI display. |
  | `BW_VAPID_PRIVATE_KEY` | `` (push disabled) | Raw base64url P-256 EC private key for Web Push (VAPID). Generate with `python gen_vapid_keys.py`. Leave empty to disable push entirely. |
  | `BW_VAPID_PUBLIC_KEY` | `` (push disabled) | Matching base64url P-256 EC public key. Injected as `bw_vapid_public_key` Jinja2 global + `<meta name="bw-vapid-key">` in `base.html`. Must be the mathematical pair of `BW_VAPID_PRIVATE_KEY` — not a random string. |
  | `BW_VAPID_SUBJECT` | `mailto:admin@localhost` | `sub` claim in VAPID JWT — your admin email or app URL. |
  | `BW_WEBAUTHN_RP_ID` | `` (auto-detect from request) | WebAuthn Relying Party ID — bare domain, e.g. `note.toramochie.com`. Leave empty for localhost dev; set explicitly if auto-detect fails behind a non-standard proxy. |
  | `BW_WEBAUTHN_ORIGIN` | `` (auto-detect from request) | WebAuthn expected browser origin — full URL, e.g. `https://note.toramochie.com`. Auto-detect priority: env var → `BW_HTTPS=true` → `X-Forwarded-Proto` header → `request.url.scheme`. Must match exactly what the browser uses — `http://` ≠ `https://`. |
  | `BW_HTTP_PROXY` | `` (auto-detected) | Outbound HTTP/S proxy for RSS fetches. If unset, `_detect_proxy()` auto-detects via: HTTPS_PROXY/HTTP_PROXY env vars → Windows registry PAC file (`AutoConfigURL`). On Walmart machines this resolves to `http://sysproxy.wal-mart.com:8080` automatically. Set explicitly in Docker: `BW_HTTP_PROXY=http://sysproxy.wal-mart.com:8080`. |
  | `WORKERS` | `1` | Uvicorn workers (max ~4 with SQLite+WAL) |

- **New env var added?** → also add it to `.env.example` AND `docker-compose.yml` (with comment). No exceptions.

### ✅ File paths — always through `BW_DATA_DIR`
- Any file the app writes at runtime (DB, uploads, secret key, logs) **must** live under `_DATA_DIR = Path(os.getenv("BW_DATA_DIR", "."))`.
- Use `pathlib.Path` for all path operations — no string concatenation. This keeps it cross-platform.
- Never write runtime files to the source tree inside a Docker container — they'd go to the read-only image layer.

### ✅ Database — always `get_db()`, never raw connects
- **All** DB access goes through `get_db()` in `database.py`. It sets `foreign_keys`, `journal_mode=WAL`, and `busy_timeout=5000` on every connection.
- Never call `aiosqlite.connect(DB_PATH)` directly (that was the `home_db.py` bug). If you add a new `*_db.py` file, import `get_db` from `database` — not `DB_PATH`.
- `PRAGMA foreign_keys = ON` is handled by `get_db()` — don't duplicate it inside individual functions unless there's a special reason (e.g. the `demo.py` migration).

### ✅ Schema migrations — additive only
- Migrations live in `init_db()` in `database.py`. They run on every startup and must be **idempotent**.
- Pattern: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`.
- Dropping columns or changing constraints requires the full SQLite table-swap dance (`CREATE new → INSERT SELECT → DROP old → RENAME`). See the `workspaces.name UNIQUE` fix in the session log for the template.
- Never ship a migration that requires manual intervention or loses data.

### ✅ Secrets — never in code or committed files
- `.env` is gitignored. `.env.example` is committed (with placeholder values only).
- `docker-compose.yml` uses `${VAR:?error message}` for required secrets so Docker fails loudly instead of silently using a default.
- `*.secret` is gitignored (the auto-generated key file).
- `*.db`, `uploads/`, `*.log` are gitignored AND dockerignored.
- **`collabora` service** — `docker-compose.yml` includes an optional `collabora/code:latest` service. It has **no host-port mapping by default** (internal bridge only). To use it, set `BW_COLLABORA_URL=http://<host-ip>:9980` and `BW_WOPI_BASE_URL=http://bookworm:8001`, then uncomment the host-port in `docker-compose.yml`. Leave both env vars empty to skip Collabora entirely — the service can remain defined in the file; it only activates when the vars are set.

### ✅ Dependencies — `requirements.txt` only
- All Python deps go in `requirements.txt` with pinned major versions (e.g. `fastapi==0.115.12`).
- No `pip install` one-liners in docs. Docker builds from `requirements.txt` exclusively.
- Don't add a dep for something Python stdlib already does (YAGNI).

### ✅ Auth middleware — keep `_PUBLIC` current
- Any new route that must work without a session (e.g. a public API, a webhook) → add it to `_PUBLIC` in `auth_middleware.py`.
- `/health` must stay in `_PUBLIC` — the Docker healthcheck depends on it.
- Routes inside `_PUBLIC` are reachable without a cookie — treat them as internet-facing and validate all inputs.

### ✅ Global vs per-user tables
- **Global** (shared by ALL users): `categories`, `attr_definitions`, `workspace_categories`.
- **Per-user** (scoped by `user_id`): `workspaces`, `notes`, `home_pages`, `home_widgets`, `note_attachments`.
- Any write route that touches a **global** table must check `request.session.get("is_demo")` and return `_demo_guard(request)` if true. See `routers/categories.py` for the pattern.
- New global tables need the same guard applied before merging.

### ✅ Static assets
- `static/` is served by FastAPI `StaticFiles` — files are committed to git and baked into the Docker image.
- Cache-busting: `static_v` global in Jinja2 (computed from max mtime of all JS/CSS at startup). Always append `?v={{ static_v }}` to `<script src>` and `<link href>` tags for app assets.
- **Tailwind CSS is bundled locally via Tailwind CLI v3.4.17 standalone** (commit `28e14a9`). The CDN tech debt is resolved.
  - `tailwind.config.js` — custom BookWorm theme (wblue/wspark/wred/wgreen + `darkMode: 'class'`)
  - `static/css/input.css` — Tailwind directives source (do not edit generated output)
  - `static/css/tailwind.css` — 75 KB minified output, **committed to git**, copied into Docker image automatically
  - `tailwindcss.exe` — Windows-only CLI binary, gitignored (download from Walmart Artifactory if needed; see `rebuild_css.bat`)
  - **Rule: after adding new Tailwind classes in templates or JS files, run `rebuild_css.bat` and commit the updated `static/css/tailwind.css`**
  - Dynamic color values (RSS feed colours, CRM stage colours) use inline `style=` attributes — NOT Tailwind classes. The CLI scan does not miss them.

### ✅ Docker image hygiene
- `.dockerignore` excludes: `__pycache__`, `.venv`, `*.db`, `*.sqlite`, `uploads/`, `*.log`, `.git/`, `*.secret`. Keep it up to date.
- The image is single-stage Python 3.12-slim. No npm, no node_modules, no compiled assets.
- `RUN mkdir -p /data/uploads` ensures the directory exists even before a volume is mounted.
- `CMD` uses shell form so `${WORKERS:-1}` expands correctly.
- Do NOT use `--reload` in the Dockerfile CMD.

### ✅ Port conventions
- Local dev: **8000** (uvicorn direct)
- Docker: **8001** (mapped from container's 8001)
- Teams lives on 8080 — never kill or bind to it.

### ✅ Before opening a PR / pushing to GitHub
- [ ] No hardcoded secrets, IPs, or internal Walmart hostnames in the diff
- [ ] `.env.example` updated if env vars changed
- [ ] `docker-compose.yml` updated if env vars changed
- [ ] New `_db.py` files use `get_db()`, not raw `aiosqlite.connect()`
- [ ] New global-table write routes have `_demo_guard(request)`
- [ ] New public routes added to `_PUBLIC` in `auth_middleware.py`
- [ ] Migration in `init_db()` is idempotent (can run 10× safely)
- [ ] `requirements.txt` updated if new dep added
- [ ] No PII or user data in committed files
- [ ] If new WOPI-eligible MIME type added: updated BOTH `WOPI_MIMES` in `routers/wopi.py` AND `_WOPI_MIMES` in `home-page-uploads-wopi.js`

---

## 🗺️ What Is This?

**BookWorm** — a self-hosted team note-taking app for Tinh's Walmart Grocery team.
- Stack: **FastAPI + HTMX + Tailwind CSS (bundled, pre-built) + SQLite (aiosqlite)**
- Runs locally at **http://localhost:8000** via `.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000`
- Started via `restart.bat` or the command above (background process, log → `bookworm.log`)
- Health check: `_health_check.py` — run it to sanity-check templates + live routes
- Docker also supported (`docker compose up -d`) — exposes port **8001** in that mode
- DB file: `bookworm.db` in project root (local dev) or `/data/bookworm.db` (Docker, via `BW_DATA_DIR` env var)
- Uploads folder: next to the DB under `uploads/`

---

## 📁 Key File Map

| File / Folder | Purpose |
|---|---|
| `main.py` | App entry point, mounts routers, serves `/` SPA shell |
| `database.py` | Schema creation + all migrations (ALTER TABLE pattern) |
| `models.py` | Pydantic models |
| `templates_env.py` | **Single shared Jinja2 env** — ALL custom filters registered here. Jinja2 globals exposed: `static_v` (cache-bust hash), `bw_max_upload_mb`, `bw_vapid_public_key` (VAPID public key for Web Push — empty string when push not configured; consumed by `<meta name="bw-vapid-key">` in `base.html`). |
| `auth_middleware.py` | Redirect unauthenticated users to `/login` |
| `security.py` | Password hashing, session secret loading |
| `routers/auth.py` | Login / logout / `/setup` (first-run) / register |
| `routers/auth_db.py` | DB helpers for users |
| `routers/notes.py` | Note CRUD routes |
| `routers/notes_db.py` | DB helpers for notes |
| `routers/workspaces.py` | Workspace CRUD + tree + trash |
| `routers/workspaces_db.py` | DB helpers for workspaces (largest file ~16 KB) |
| `routers/categories.py` | Category + attribute definition management |
| `routers/categories_db.py` | DB helpers for categories |
| `routers/attachments.py` | File upload/download/delete |
| `routers/attachments_db.py` | DB helpers for attachments; sets `UPLOAD_DIR` |
| `routers/home.py` | Home pages + widget CRUD + weather proxy. Includes `GET /home/pages` → `list_pages_json` (returns `{pages: [{id, name, emoji, page_type}]}` for the current user; auth-gated; must be declared **before** `/pages/{page_id}` so Starlette matches it first; used by add-widget modal CRM picker and upload-preview file picker — both break silently if this is missing). `GET /home/workspaces-for-picker` → returns `[{id, name, emoji, ws_type}]` for the current user's workspaces; auth-protected (NOT in `_PUBLIC`); must also be declared **before** the `/{page_id}` wildcard — powers the `note_link` widget's workspace picker via `_nlLoadWorkspaces()` in `home-widgets-settings.js` (result cached client-side in `_nlWsCache`). **RSS proxy internals (all in this file):** `_detect_proxy()` — auto-detects outbound proxy at module import: checks `BW_HTTP_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY` env vars, then on Windows reads `AutoConfigURL` from the registry, fetches the PAC file, and extracts the first `PROXY host:port` directive (resolves to `sysproxy.wal-mart.com:8080` on Walmart machines); result cached in `_PROXY: str`. `_httpx_fetch(url, extra_headers, timeout)` — low-level httpx-based fetch using `_PROXY` (replaces old `_curl_fetch` subprocess approach — curl not available in Docker slim images). `_fetch_raw(url, send_rss_accept=True)` — text fetch + charset decode. `_parse_yt_html(html_text)` — BFS-walks `ytInitialData` JSON to extract video list from YouTube channel pages, handling both legacy `videoRenderer`/`gridVideoRenderer` (pre-2024) and modern `richItemRenderer → content → lockupViewModel` (2024+) formats; bypasses blocked `feeds/videos.xml` endpoint; inner helpers `_safe_get`, `_item_from_legacy`, `_item_from_lockup`. `_autodiscover_feed_url(html, base_url)` — scans `<link rel=alternate>` tags. `rss_proxy()` — orchestrates all of the above. See **🌐 Network & Proxy** section below. **Trash routes (commit `cbf98d7`):** `GET /home/pages/trash` — JSON list of trashed pages; `POST /home/pages/trash/empty` — hard-deletes all trash, returns sidebar HTML; `POST /home/pages/{id}/restore` — un-trashes page, returns sidebar HTML + `X-Restored-Page-Id` response header. **Private helper `_sidebar_ctx(uid, active_page_id=None)`** — returns `{pages, hp_trash_count}` used by all 5 sidebar-returning routes (DRY replacement for bare `get_home_pages()` calls). |
| `routers/home_db.py` | DB helpers for home_pages + home_widgets tables. Trash helpers (commit `cbf98d7`): `delete_home_page()` — now a **soft-delete** (`UPDATE SET deleted_at=datetime('now')`); `restore_home_page(page_id, user_id)` — clears `deleted_at`; `get_trashed_home_pages(user_id)` — returns trashed pages newest-first; `empty_home_page_trash(user_id)` — hard-deletes all trashed pages for a user; `purge_expired_home_pages()` — hard-deletes pages trashed >30 days (all users, called at startup). `PAGE_TYPES` frozenset includes: `'dashboard'`, `'rss'`, `'crm'`, `'uploads'`, `'subscriptions'` (commit `177a335`). Mobile widget order helpers: `reorder_widgets_mobile(page_id, user_id, order_ids)` — writes `mobile_widget_order` into `home_pages.config_json` (merges into existing config, never overwrites other keys); `_append_mobile_order(page_id, widget_id, db)` — appends a newly-created widget id to `mobile_widget_order` so it always shows up on phones; `_prune_mobile_order(page_id, widget_id, db)` — removes a deleted widget id from `mobile_widget_order`. |
| `routers/home_crm.py` | 9 endpoints under `/home/crm/{page_id}/…` — contacts CRUD + fields CRUD + field-value upsert. Ownership validated via `_get_crm_page()`. |
| `routers/home_crm_db.py` | DB helpers for CRM. Uses single JOIN in `_attach_field_values()` to avoid N+1. |
| `routers/uploads_db.py` | paginated merged query with embedded tags (GROUP_CONCAT) + workspace_id; MIME-group counts inline in `get_uploads_page()`; `delete_page_upload()` (sweeps tags); 6 tag CRUD helpers; `get_all_user_tags()` |
| `routers/home_uploads.py` | Uploads page API: list files (50/page), standalone upload (`webp: bool = True` query param), auth-gated download, delete, 4 tag endpoints |
| `routers/home_uploads_docs.py` | **Document Studio API** (Phase 4). 5 endpoints under `/home/uploads/{pid}`: read content (text/DOCX-as-HTML), save edited text (max 1 MB), combine PDFs / join text (2–20 files), convert (docx/txt→pdf, docx/pdf→txt), sign (stamp drawn PNG signature onto PDF page). Phase 6 (commit `801ee6a`) adds `GET /{pid}/files/page/{fid}/wopi-token` — issues an `itsdangerous` WOPI token; returns `{collabora_disabled: true}` when `BW_COLLABORA_URL` is unset. Phase 7 / B2 (commit `95ea1dd`) adds `PUT /{pid}/files/page/{fid}/spreadsheet` — receives `SpreadsheetBody(content_b64: str, format: str)` (base64-encoded XLSX or UTF-8 CSV bytes, ≤10 MB guard `MAX_SPREADSHEET_BYTES`), auth-gated, `_demo_guard` on entry, uses existing `base64` import + `get_page_upload_owned` + `update_page_upload_size`. Kept separate from `home_uploads.py` for cohesion. |
| `routers/wopi.py` | **WOPI host router** (Phase 6, commit `801ee6a`). Prefix `/wopi`. Endpoints: `GET /wopi/files/{file_id}` (CheckFileInfo), `GET /wopi/files/{file_id}/contents` (GetFile), `POST /wopi/files/{file_id}/contents` (PutFile — saves bytes back), `POST /wopi/files/{file_id}` (LOCK stub — always 200, Phase 7 TODO). Token auth via `?access_token=` query param using `itsdangerous.URLSafeTimedSerializer` (salt `wopi-token-v1`). No session cookie — purely token-auth. Reads/writes via `UPLOAD_DIR`. Exports: `issue_token()`, `get_editor_url()`, `WOPI_MIMES` (frozenset), `_COLLABORA_URL`, `_WOPI_BASE_URL`. Collabora discovery XML cached in `_discovery_cache` dict to avoid repeated HTTP fetches. |
| `routers/uploads_docs_db.py` | DB helpers for Document Studio. `update_page_upload_size(id, uid, size)` — UPDATE size after edit/sign. `get_page_upload_owned_bulk(ids, uid)` — single IN-clause query for multiple owned rows (combine/merge flow). Phase 8 adds: `get_annotations`, `create_annotation`, `update_annotation` (updates position/content only — page_num and type are immutable after creation), `delete_annotation`. |
| `routers/account.py` | User profile / password change / admin user management |
| `routers/totp.py` | 2FA (TOTP) setup + verify routes |
| `routers/totp_db.py` | DB helpers for TOTP |
| `templates/index.html` | Main SPA shell (~208 KB — massive) |
| `templates/base.html` | Base layout (~52 KB) |
| `templates/partials/home_page.html` | All home widget macros + grid render (~117 KB — read in chunks). **Mobile-aware data attributes (2026-05-25):** `card` + `bare_card` macros now emit `data-mobile-col-span` (from `config.mobile_col_span`, defaults to `col_span`). Widget grid `<div>` emits `data-mobile-col-count` (from `page.config.mobile_col_count`) and `data-mobile-order` (JSON array of widget IDs, from `page.config.mobile_widget_order`). `render_divider` also emits `data-mobile-col-span`. |
| `templates/partials/home_page_crm.html` | CRM page shell — `#crm-page-root`, `#crm-main`, modal container. No inline script blocks. |
| `templates/partials/home_page_trip.html` | Trip Planning page shell (~48 KB) — spots board, day lanes, plans tabs, panels sidebar. |
| `templates/partials/home_page_grid.html` | Grid homespace page shell (~17 KB) — masonry/grid cell layout for photo boards. |
| `templates/partials/note_form.html` | Note editor (huge — ~165 KB) |
| `static/js/home-page-uploads.js` | Uploads page JS module (1333 lines). State: `_uplGrouped` (grouped-by-MIME display toggle). Detail panel (image/video/audio/embed/text preview), filter tabs, tag rendering, `_uplJsStr()` / `_uplEsc()` escaping helpers. Tags CRUD delegates to `home-page-uploads-tags.js`. Two defensive hooks at end of `_uplRenderDetail` and `_uplRender` call `_uplDocStudioInit(f)` and `_uplDocAfterRender()` when present. **View-mode-aware detail panel (2026-05-25):** `_uplShowDetailPanel()` reads `localStorage.getItem('bw-view-mode')` and positions the panel as: `panel` = fixed right side-slide (22rem wide, z:40) with transparent click-outside backdrop; `center` = floating card (36rem, centered, blurred opaque backdrop, z:39/38); `fullscreen` = `inset:0` covering entire viewport. `_uplRemoveDetailBackdrop()` tears down the `#_upl-detail-backdrop` div on close. `_uplCloseDetail()` now removes the backdrop and uses `.hidden` class instead of `translate-x-full` — panel is fully detached from layout when closed. ESC handler in `initUploadsPage` also calls `_uplCloseDetail()` when a file is open. Detail-content div uses `flex:1; min-height:0` so panel header stays pinned and content scrolls independently in all three modes. |
| `static/js/home-page-uploads-docs.js` | **Document Studio companion** (440 lines, Phase 4). Called via hooks in main uploads JS. `_uplDocStudioInit(f)` renders the studio panel inside `#upl-doc-studio` after detail panel HTML is written. `_uplDocAfterRender()` injects the ☐ Select button for multi-select mode. Operations: view full text, inline edit + save, → PDF, → TXT, Sign (drawn signature → PDF), Merge PDFs / Join Text (floating toolbar). Eligibility by file type: note-src = read-only label; page-src text/JSON = view/edit/→PDF; page-src PDF = sign/→TXT; page-src DOCX = view/→PDF/→TXT. Also checks `_uplWopiEnabled()` (defined by the wopi companion below) to gate the "✏️ Edit in Collabora" button. |
| `static/js/home-page-uploads-wopi.js` | **WOPI modal companion** (Phase 6, commit `801ee6a`). Loaded in `base.html` after `home-page-uploads-docs.js` and before `home-page-uploads-spreadsheet.js` — `_uplWopiEnabled()` must be defined before `_uplDocStudioInit` calls it. API: `_uplWopiOpen(f)` fetches `/wopi-token`, injects Collabora editor URL into `#upl-wopi-frame`, shows `#upl-wopi-modal`; `_uplWopiClose()` clears iframe src + hides modal; `_uplWopiFrameLoaded()` removes loading spinner; `_uplWopiEnabled()` returns bool (true when Collabora is configured); `_uplWopiPageId()` returns current page id; `_uplWopiBindPostMessage()` listens for Collabora PostMessage events (save complete → refresh file list). `_WOPI_MIMES` JS array must stay in sync with `WOPI_MIMES` frozenset in `routers/wopi.py`. |
| `routers/home_uploads_annot.py` | PDF annotation REST endpoints (`GET`/`POST`/`PUT`/`DELETE` `/home/uploads/{pid}/files/page/{fid}/annotations[/{aid}]`). Router registered in `main.py`. Separate from `home_uploads_docs.py` (which was already 798 lines). |
| `static/js/home-page-uploads-annot.js` | PDF Annotations module. Lazy CDN loader for PDF.js 3.11.174. Functions: `_uplAnnotOpen`, `_uplAnnotClose`, `_uplAnnotRenderPage`, `_uplAnnotSetPage`, `_uplAnnotDrawOverlay`, `_uplAnnotMakeDiv`, `_uplAnnotAddMode`, `_uplAnnotHandleOverlayClick`, `_uplAnnotSave`, `_uplAnnotDelete`. State: `_uplAnnotState` (page, total, tool, annots, busy). Loaded after `home-page-uploads-spreadsheet.js` in `base.html`. |
| `static/js/home-page-uploads-spreadsheet.js` | **Jspreadsheet CE spreadsheet editor** (Phase 7 / B2, commit `95ea1dd`). Loaded LAST in `base.html` via `<script defer>` with `?v={{ static_v }}`. All-`var`, no `let`/`const`. Lazy CDN loader — injects Jsuites JS → Jsuites CSS → Jspreadsheet CE JS → Jspreadsheet CE CSS → SheetJS in that exact order (Jspreadsheet has a hard runtime dep on Jsuites; reversing order = `jsuites is not defined`). Promise cached in `_uplSsLibsPromise` — re-opening the editor skips re-injection. CDN URLs pinned to major versions (not `latest`). Module state: `_uplSsFile`, `_uplSsGridEl`, `_uplSsLibsLoaded`, `_uplSsLibsPromise`, `_uplSsBusy`. Key functions: `_uplSsOpen(f)` — public entry point; `_uplSsRender(f)` — fetch + parse + mount Jspreadsheet grid; `_uplSsClose()` — destroy grid + hide modal; `_uplSsSave()` — SheetJS serialise to XLSX/CSV → base64 → `PUT /{pid}/files/page/{fid}/spreadsheet`; `_uplSsInstance()` — returns `el.jspreadsheet ?? el.jexcel` (v4/v5 compat helper). Depends on: `_uplPid`, `_uplFiles`, `_uplDocCurrentFile`, `_uplEsc`, `_uplShowToast`. |
| `static/js/home-page-uploads-tags.js` | **Companion to `home-page-uploads.js`** (loaded after it). Tags CRUD (add/remove/filter pills) + `_uplFetchTextPreview()`. Upload modal `#upl-webp-toggle` wired here. |
| `static/js/home-widgets.js` | Home nav + widget CRUD core; `_initSwappedPage()` dispatches HTMX page boots to 4 page types: rss (`#rss-page-root` → `initRssPage`), crm (`#crm-page-root` → `initCrmPage`), subs (`#subs-page-root` → `initSubsPage`), dashboard (fallback → `initHomeWidgets`). **Trash drag/modal (commit `cbf98d7`):** `_pgDragStart`, `_trashDragOver`, `_trashDragLeave`, `_trashDrop` — drag-to-trash sidebar zone handlers; `openHpTrashModal`, `closeHpTrashModal` — trash management modal; `_restoreHpPage` — un-trash a single page; `_emptyHpTrash` — hard-delete all trashed pages. **Mobile layout (2026-05-25):** `_applyWidgetGridColCap()` now reads `data-mobile-col-count` and `data-mobile-col-span` on phones (`window.innerWidth < 640`) so the grid uses the mobile-specific column count and per-widget mobile span instead of the desktop values. `_applyMobileWidgetOrder()` — new function; only runs on phones; reads `data-mobile-order` from the grid div and re-appends `.hw-card` children in that order (unlisted widgets appended at end). Both functions called from `initHomeWidgets()` and the debounced `resize` listener. **DnD reorder on phones** posts to `POST /home/pages/{id}/widgets/reorder-mobile` instead of `/reorder`, and updates `data-mobile-order` in-place so `_applyMobileWidgetOrder` stays consistent without a canvas reload. |
| `static/js/home-widgets-render.js` | Widget JS engines (weather, calendar, todo, reminder, etc.) |
| `static/js/home-page-crm.js` | CRM JS module. `initCrmPage(pid)` entry point called by `_initSwappedPage()`. Module-level state: `_crmPid, _crmContacts, _crmFields, _crmView, _crmQuery`. Views: table + gallery. Contact CRUD via modals. Fields management modal. View preference persisted to localStorage key `bw_crm_view`. |
| `static/js/home-page-crm-toolbar.js` | CRM Sort/Filter/Group toolbar. Module-level state: `_crmSortKey, _crmFilterField, _crmFilterValue, _crmGroupField`. `window.crmRenderToolbar` renders Sort/Filter/Group selects + Clear button + Columns panel. `window._crmProcessed()` — full pipeline: text search → field filter → sort → flat array (replaces `_crmFiltered()`, which now delegates to it). `window._crmGroupValue(c, field)` extracts sort/group key (JSON-parses multi_select). Setters: `crmSetSort`, `crmSetFilterField`, `crmSetFilterValue`, `crmSetGroup`, `crmClearFilters`. Loaded after `home-page-crm.js`. |
| `static/js/home-page-crm-fields.js` | CRM custom fields modal (add/edit/delete field definitions). Contains `_CRM_FIELD_TYPE_DEFS` (array of `{v,l}` objects for all 9 field types, defined at module top), `crmEditField()`, `crmSaveFieldEdit()`. |
| `static/js/home-widgets-settings.js` | Widget settings modal + size picker. **Mobile-aware (2026-05-25):** `_pageColCount(widgetId)` reads `data-mobile-col-count` on phones. `_buildSizePicker(widgetId, body)` reads `data-mobile-col-span` on phones for the current span. `_selectSize(widgetId, col, row)` saves to `mobile_col_span` key (phone) or `col_span` key (desktop) and updates the matching `data-*` attribute. `openPageLayout(pageId)` reads the correct column count per breakpoint and sets the `#pg-layout-device-badge` text to “📱 Mobile” or “🖥️ Desktop”. `selectPageLayout(cols)` saves to `mobile_col_count` (phone) or `col_count` (desktop). `saveWidgetSettings()` now preserves both `col_span` AND `mobile_col_span` from the existing card config when saving non-size widget settings. |
| `static/js/home-widgets-clock.js` | Clock widget engine (analog/digital) |
| `static/js/slash_commands.js` | `/` command palette in note editor |
| `static/js/timeline.js` | Timeline view logic |
| `static/js/timeline-render.js` | Timeline rendering |
| `static/js/timeline-ui.js` | Timeline UI interactions |
| `static/js/bw-spellcheck.js` | Spell-check integration |
| `static/js/home-widget-text.js` | Text/title widget editor |
| `static/js/home-widget-upload-preview.js` | **File Preview widget engine** (commit `92b68bc`). Public API: `_loadUploadPreview(el)` (entry point, called on widget boot), `_uplPrevOpenPicker(widgetId)`, `_uplPrevClosePicker()`, `_uplPrevFetchPages()`, `_uplPrevLoadFiles(pageId)`, `_uplPrevFetch()`, `_uplPrevRenderPickerGrid(files)`, `_uplPrevToggleFile(fileId)`, `_uplPrevPrevPage()`, `_uplPrevNextPage()`, `_uplPrevConfirm()` (async — saves config + reloads widget). All module state uses `var`. |
| `static/js/home-widget-buds.js` | **Buds widget engine** (animated flower sprites). Entry: `_budsInit(el)` called from `initHomeWidgets()`. Renders bud cards with animated species sprites (`static/img/buds/`), health bars, watering buttons. Manages add/edit/delete bud modals. Fertilize plan CRUD. All `var`. |
| `static/js/home-widget-events.js` | **Events widget engine** — countdown badges, recurring recurrence expansion, next-occurrence sort. Powered by `evt_prepare_items` Jinja2 filter on the server side for initial render; JS handles add/edit/delete CRUD. |
| `static/js/home-widget-rss.js` | **RSS feed widget engine**. Fetches items via `GET /home/rss?url=…` proxy. Renders card/compact/minimal views. `_rssRerender(el)` re-renders from cached `el._rssAllItems` without network fetch (used after settings-only changes). `_rssTextOnWhite(hex)` — luminance guard for light accent colours. |
| `static/js/home-widget-stack.js` | **Stack carousel widget engine**. `initStackCards()` — overrides inner card padding, wires prev/next/dots navigation. `min_height_px` applied from config as `min-height` CSS so stack never squashes children. |
| `static/js/home-widget-text-fmt.js` | **Text formatting toolbar** for the `text` and `sticky` widgets (bold/italic/link/etc.). Loaded before `bw-block-menu.js` in `base.html`. |
| `static/js/home-page-trip.js` | **Trip Planning page JS module** (~63 KB). Entry: `initTripPage(pid)`. Manages spots board, day lanes, drag-to-day-lane assignment. |
| `static/js/home-page-trip-plan.js` | Trip plan tabs + plan CRUD (~93 KB). |
| `static/js/home-page-trip-panels.js` | Trip plan panels (side-cards: packing, budget, documents, settle) (~138 KB). |
| `static/js/home-page-trip-panels-people.js` | People management inside trip panels (~21 KB). |
| `static/js/home-page-trip-filters.js` | Trip spot filters/search/sort (~45 KB). |
| `static/js/home-page-trip-chart.js` | Trip budget chart (Chart.js) (~46 KB). |
| `static/js/home-page-trip-chart-drill.js` | Trip chart drill-down detail (~21 KB). |
| `static/js/home-page-trip-locs.js` | Trip locations research layer (~29 KB). |
| `static/js/home-page-grid.js` | **Grid homespace page JS module** (~29 KB). Entry: `initGridPage(pid)`. Manages `home_grid_cells` — drag-to-position images, aspect-ratio picker, caption editor. Key fn: `_gridApplyLayout()` — drives all CSS grid layout. **Layout rules (commit `437b88b`):** On mobile (`window.innerWidth < 640`) fixed-column presets always use `repeat(N, 1fr)` regardless of the stored zoom value (zoom slider hidden on mobile; px-mode centering would create dark side-gaps). Desktop zoom < 100% uses explicit `px` column widths + `justify-content: center`. Desktop zoom = 100% or mobile always uses `1fr` + `justify-content: ''`. All paths explicitly set `canvas.style.width = '100%'`. Auto-fill path uses `repeat(auto-fill, minmax(Npx, 1fr))` so last-row cells stretch to fill. |
| `static/js/home-page-grid-actions.js` | Grid cell action toolbar (delete, move, lightbox) (~15 KB). |
| `static/js/home-page-grid-lightbox.js` | Grid lightbox fullscreen viewer (~4 KB). |
| `static/js/home-page-crm-bulk.js` | CRM bulk select + multi-action toolbar (~11 KB). |
| `static/js/home-page-crm-calendar.js` | CRM calendar view — contact events on a monthly calendar (~14 KB). |
| `static/js/home-page-crm-detail.js` | CRM contact detail/profile panel (~10 KB). |
| `static/js/home-page-crm-gallery.js` | CRM gallery (card grid) view renderer (~27 KB). |
| `static/js/home-page-crm-pipeline.js` | CRM kanban pipeline view — stages + deals drag-and-drop (~24 KB). |
| `static/js/home-page-crm-reminders.js` | CRM contact reminders — per-contact date/time reminders with recurrence (~26 KB). **Push ownership split (commit `7b081d3`):** `_checkCrmReminders()` checks `document.getElementById('bw-push-btn')?.dataset?.active === '1'` before calling advance/delete endpoints. When push is subscribed, client shows the toast but skips all DB cleanup (server `_widget_notif_loop` owns advance/delete after push delivers). When push is off, client falls back to the original self-cleanup behaviour. Dedup via `_crmRemFired` map prevents duplicate toasts within the same tab session. |
| `static/js/home-page-crm-slash.js` | CRM slash commands for inline field entry in contact notes (~9 KB). |
| `static/js/home-page-crm-table.js` | CRM table view renderer — sortable columns, inline cell edit (~9 KB). |
| `static/js/home-page-uploads-sign.js` | **PDF signature drawing module**. Canvas-based signature pad + ghost drag-to-place flow. `_uplSigConfirmGhost()` stamps the drawn PNG at chosen coords. `_uplSigGhostActive` reset-before-guard (Quirk #23). |
| `static/js/sharing.js` | **Public share link UI** (~13 KB). `shareOpenModal(type, id)`, `shareCreateLink()`, `shareRevokeLink()`, `shareCopyLink()`. Wired from share buttons in note detail and DB card panels. |
| `routers/home_subscriptions.py` | **Subscriptions page API** (Phase 1, commit `177a335`). 5 JSON endpoints under `/home/subscriptions/{page_id}/…`: list (`GET /`), summary (`GET /summary`), add (`POST /`), update (`PUT /{sub_id}`), delete (`DELETE /{sub_id}`). Auth via `_uid()` + `_get_subs_page()` (ownership + page-type guard). |
| `routers/home_settle.py` | **Settle Up widget API** (Settle Up feature). Prefix `/home`. Cascade picker endpoints (read-only, no demo guard): `GET /settle-up/trip-pages` — trip pages for current user; `GET /settle-up/trip-plans?page_id=N` — plans for a trip page (validates ownership + page_type); `GET /settle-up/settle-panels?page_id=N&plan_id=N` — `settle`-type panels for a plan. Standalone data write: `PUT /pages/{page_id}/widgets/{widget_id}/settle` — demo-guarded + ownership double-check on both page and widget; sanitises `currency`, `people`, `expenses`; merges into existing config (preserves sync keys). |
| `routers/home_buds.py` | **Buds widget API.** Endpoints under `/home/buds/{widget_id}/`: list buds, add bud, update bud (health, watered, name, species, notes), delete bud, add/complete/delete fertilize plans. Auth via `_uid()` + widget ownership check. |
| `routers/home_buds_db.py` | DB helpers for the Buds widget (`buds` + `bud_fertilize_plans` tables). |
| `routers/home_grid.py` | **Grid homespace page API.** Manages `home_grid_cells` (position, cell_type, upload_id, aspect, caption). |
| `routers/home_grid_db.py` | DB helpers for Grid page cells. |
| `routers/home_trip.py` | **Trip Planning homespace page API** (~26 KB). Endpoints for trip spots, day lanes, day-spot assignments, day blocks. Ownership gated via `_get_trip_page()`. |
| `routers/home_trip_db.py` | DB helpers for trip planning (~47 KB) — spots CRUD, days CRUD, blocks CRUD, all location + attrs queries. |
| `routers/home_trip_panels.py` | **Trip plan panels API** — side-card CRUD for documents/packing/budget/settle panels. Also handles Settle Up sync writes. |
| `routers/home_uploads_catalogs.py` | **Upload catalogs API** — label-tree CRUD for grouping uploads. Endpoints under `/home/uploads/{pid}/catalogs/`. |
| `routers/home_uploads_folders.py` | **Upload folders API** — virtual folder tree CRUD. Endpoints under `/home/uploads/{pid}/folders/`. |
| `routers/uploads_catalogs_db.py` | DB helpers for upload catalogs (`upload_catalogs` + `upload_catalog_files`). |
| `routers/uploads_folders_db.py` | DB helpers for upload folders (`upload_folders` table). |
| `routers/sharing.py` | **Public share links** — create/revoke shareable tokens for notes and DB cards. Serves public view pages under `/share/view/{token}`. Auth bypassed via prefix check. |
| `routers/sharing_db.py` | DB helpers for `public_share_links` table. |
| `routers/workspace_databases.py` | **Workspace Database node API** — manages database-type workspaces (`ws_type='database'`). |
| `routers/workspace_db_cards.py` | **DB card CRUD API** — create/read/update/delete `db_cards` + `db_card_attrs`; card cover upload/unlink. |
| `routers/note_reminders.py` | **Note reminders API** — CRUD for `note_reminders` (reminders set via `/reminder` slash command in note editor). |
| `routers/seed_uploads.py` | Dev/demo helper — seeds sample upload files; not exposed in prod. |
| `routers/home_subscriptions_db.py` | **Subscriptions DB helpers + business logic** (Phase 1). Key fns: `get_price_per_month(cycle, frequency, amount)` — normalises any cycle to monthly cost; `get_subscription_progress(cycle, frequency, next_payment_date)` — returns 0.0–1.0 progress float through current billing period; `get_subscriptions`, `add_subscription`, `update_subscription`, `delete_subscription`, `get_summary_data` (totals + per-category breakdown, active-only). |
| `routers/push.py` | **Web Push API router** (prefix `/push`). Endpoints: `GET /push/vapid-public-key` — returns `{public_key}` (public; also in `<meta>` tag); `POST /push/subscribe` — upserts a browser push subscription (`endpoint`, `p256dh`, `auth`) for the current user; `DELETE /push/unsubscribe` — removes it; `POST /push/test` — sends a test push to the current user’s device (dev helper). Push is disabled (no-op) when `BW_VAPID_PRIVATE_KEY` is empty. |
| `routers/push_db.py` | DB helpers for `push_subscriptions` table. `upsert_push_subscription(user_id, endpoint, p256dh, auth)` — `INSERT OR REPLACE`; `delete_push_subscription(user_id, endpoint)` — remove one device; `get_push_subscriptions(user_id)` — all devices for a user. |
| `gen_vapid_keys.py` | **Standalone helper script.** Run `python gen_vapid_keys.py` to generate a fresh VAPID key pair and print the two env var lines to paste into `.env`. Uses `cryptography` library (already in requirements as a transitive dep). |
| `bw_pwa_icons.py` | **PWA icon generator.** Run `python bw_pwa_icons.py` (or call `generate_icons(force=True)`) to regenerate all icons into `static/img/icons/`. Produces 5 files: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (all RGBA→RGB on green bg, full-colour), `apple-touch-icon.png` (180×180), and `badge-96.png` (96×96 **RGBA with full transparency** — monochrome white worm silhouette for Android push status-bar badge). **Critical:** `badge-96.png` MUST stay RGBA (not flattened to RGB) — Android uses only the alpha channel to render the badge shape in white. Files skipped if they already exist unless `force=True`. |
| `static/js/bw-push.js` | **Web Push client module.** Loaded in `base.html` (deferred). `_bwPushInit()` — reads `<meta name="bw-vapid-key">` content; if empty, hides all push UI and exits. `_bwPushRegister()` — `navigator.serviceWorker.ready` → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey})` → `POST /push/subscribe`. `_bwPushUnregister()` — `pushManager.getSubscription()` → unsubscribe + `DELETE /push/unsubscribe`. `_bwPushToggle()` — wired to the 🔔 bell button in the sidebar; toggles between subscribed/unsubscribed state. Bell button state persisted in `localStorage` key `bw-push-on`. `sw.js` `push` event handler: shows notification with title/body/icon from `event.data.json()`; `notificationclick` focuses existing tab or opens `/`. **Badge field:** all notification payloads (in `main.py`, `routers/push.py`, and `sw.js` fallback) use `badge: '/static/img/icons/badge-96.png'` — the 96×96 RGBA monochrome icon. Do NOT change badge back to `icon-192.png`; that file has a solid green background (all pixels fully opaque) which Android renders as a solid white square in the status bar. |
| `templates/partials/home_page_subscriptions.html` | **Subscriptions page shell** (Phase 1). Two-panel layout. Root: `#subs-page-root[data-page-id]`. Left panel: `#subs-filter-bar`, `#subs-list`, add button. Right panel: `#subs-summary-cards`, `#subs-donut-chart`, `#subs-bar-chart` (both in fixed-height divs), `#subs-upcoming`. Modals: `#subs-modal` (add/edit), `#subs-del-modal` (delete confirm). No inline `<script>` blocks. |
| `static/js/home-page-subscriptions.js` | **Subscriptions JS module** (Phase 1). All `var`. Entry: `initSubsPage(pid)` called by `_initSwappedPage()`. Key fns: `_subsLoadAll`, `_subsRenderList`, `_subsRenderSummaryCards`, `_subsLoadCharts` (lazy-loads `chart.umd.min.js`), `_subsRenderDonut`, `_subsRenderBar`, `_subsRenderUpcoming`, `subsOpenAddModal`, `subsCloseModal`, `_subsEdit`, `_subsSubmitForm`, `_subsDeletePrompt`. Inactive subscriptions excluded from all analytics totals. |
| `static/js/vendor/chart.umd.min.js` | **Bundled Chart.js 4.4.4** (~200 KB). Loaded lazily by `_subsLoadCharts()` on subscriptions pages only — not in `base.html`. Stored in `static/js/vendor/` and served as a regular static file with `?v={{ static_v }}` cache-busting. No CDN dependency. |
| `static/js/bw-block-menu.js` | **Shared block context-menu engine** (commit `7eebe64`). All `var`. Exposes `window._bwBlockMenu(gripEl, blockEl, opts)` — opens a 4-item block menu via `_bwRowMenu`: **Turn into** (10 types: p/h1/h2/h3/ul/ol/todo/quote/code/callout, ✓ marks current), **Color** (custom floating palette — 9 text colors + 9 highlights, circle swatches, ESC/outside-click dismiss), **Duplicate** (clone + strip stale grips + insertAfter + sync), **Delete** (danger). Used by DB card notes (`workspace-database.js` → `_dbGripUp` click path, `gripAttr:'data-db-grip'`) and workspace note editor (`note_form.html` → `initPreviewDnD._onMouseUp` click path, `gripAttr:'data-preview-grip'`). Loaded in `base.html` after `home-widget-text-fmt.js` and before `workspace-database.js`. Depends on `window._bwRowMenu` from `home-widgets.js`. **Color in workspace notes:** inline `style` on CE preview — Turndown strips styles on MD serialization, so colors don't persist to saved markdown (DB card notes: colors persist correctly as HTML). |
| `static/js/workspace-database.js` | **DB card grid + detail panel** (all `var`). Module state: `_dbWsId`, `_dbCards`, `_dbSaveTimers`, `_dbDetailId`, `_dbDelTarget`, `_dbPanelClickHandler`. Grip DnD state: `_dbGrip*` (9 vars). Key functions: `initDatabaseView(wsId)`, `_dbRenderGrid`, `_dbRenderDetailPanel`, `_dbAttachNoteTools` (wires slash palette + paste-as + `_dbInjectGrips`), `_dbInjectGrips(noteEl)` / `_dbAddGrip(el)` — stamps `⠿` grip spans with `data-db-grip` + `data-db-transient` (auto-stripped by `_dbNoteHtml`); `_dbGripDown/Move/Up` — DnD engine: drag→reorder+save, click→`window._bwBlockMenu`. |

---

## 🗄️ Database Schema

### Tables (as of current migration state)

**`users`**
- `id, username, password_hash, role (user/superadmin), created_at`
- `totp_secret, totp_enabled` — added via migration
- `unlimited_uploads INTEGER NOT NULL DEFAULT 0` — added via migration (bypasses per-user upload cap when 1)
- First created user is auto-promoted to `superadmin`

**`workspaces`**
- `id, user_id, name, emoji, created_at`
- `is_open, parent_id, is_favorite, deleted_at, sort_order` — added via migration
- Supports nested hierarchy (`parent_id → workspaces.id`)
- Soft-delete via `deleted_at`; `purge_expired_trash()` removes >30 days old on boot

**`notes`**
- `id, workspace_id, title, content, meeting_date, created_at, updated_at, icon`
- `updated_at` maintained by SQLite trigger `notes_updated_at`

**`categories`** — global tag pool with color
**`attr_definitions`** — custom field definitions (type: text/select/etc.)
**`note_categories`** — M2M: notes ↔ categories
**`note_attributes`** — per-note custom field values
**`note_attachments`** — file metadata (actual files in `UPLOAD_DIR`)
**`workspace_categories`** — M2M: workspaces ↔ categories (which tags are available per WS)
**`home_pages`** — personal dashboard pages (`user_id, name, emoji, sort_order, config_json, page_type`)
- `deleted_at DATETIME DEFAULT NULL` — added via migration (commit `cbf98d7`); soft-delete trash column
- Active-page queries filter `AND deleted_at IS NULL`; trash queries filter `AND deleted_at IS NOT NULL`
- Soft-delete via `deleted_at`; `purge_expired_home_pages()` hard-deletes pages trashed >30 days on server startup

**`home_widgets`** — widgets on a page (`page_id, widget_type, style, config_json, sort_order`)
- `group_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL` — added via migration; non-NULL = child slide of a `stack` widget. ON DELETE SET NULL frees children when the stack container is deleted.

**`rss_page_feeds`**
- `id, page_id, user_id, url, label, color, sort_order, created_at`
- `category` — added via migration (feed category tag for pill filter UI)
- `source_widget_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL` — added via migration
  - `NULL` = manually added feed; non-NULL = synced from that RSS widget on the home page
  - FK enforced by `get_db()` (`PRAGMA foreign_keys = ON`)
  - Widget deleted → FK `ON DELETE SET NULL` auto-clears the link; feed is kept, badge disappears
  - `UNIQUE(page_id, url)` — first-writer wins if two widgets sync the same URL (known limitation)

**`rss_read_items`** — per-user persistent read state (`user_id, page_id, item_guid, read_at`; PK = all three)
**`site_settings`** — admin-toggleable runtime flags (`key, value`); `registration_open` seeds from `BW_ALLOW_REGISTRATION` on first boot only

**`crm_contacts`** — contact records scoped per CRM page
- `id, page_id, user_id, name, email, phone, company, tags` (comma-sep), `avatar_emoji, sort_order, created_at, updated_at`
- `updated_at` maintained by SQLite trigger `crm_contacts_updated_at`
- `profile_pic TEXT NOT NULL DEFAULT ''` — added via migration (base64 or URL)
- `birthday TEXT NOT NULL DEFAULT ''` — added via migration (ISO date)
- `first_met_date TEXT NOT NULL DEFAULT ''` — added via migration (ISO date)
- `relationship TEXT NOT NULL DEFAULT ''` — added via migration (free-text relationship label)

**`crm_custom_fields`** — field definitions per CRM page
- `id, page_id, user_id, label, field_type`, `options` (pipe-sep for select/multi_select), `sort_order, created_at`
- `field_type` supports 9 values: `text`, `select`, `multi_select`, `checkbox`, `url`, `email`, `date`, `number`, `file_links`

**`crm_contact_field_values`** — per-contact custom field values
- `id, contact_id` (→`crm_contacts` CASCADE), `field_id` (→`crm_custom_fields` CASCADE), `value`
- `UNIQUE(contact_id, field_id)` — upsert-safe
- **Value encoding by field type:** `checkbox` → `'1'`/`'0'`; `multi_select` + `file_links` → JSON array string (e.g. `'["a","b"]'`); all others → plain text

**`crm_stages`** — pipeline kanban stages per CRM page (grouped by project)
- `id, page_id, user_id, name, color, sort_order, created_at`
- `project_id` (→`crm_projects` ON DELETE SET NULL) — added via migration

**`crm_deals`** — deal cards in the kanban pipeline
- `id, page_id, user_id, contact_id` (→`crm_contacts` SET NULL), `stage_id` (→`crm_stages` SET NULL), `title, value REAL, sort_order, created_at, updated_at`
- `updated_at` maintained by SQLite trigger `crm_deals_updated_at`

**`crm_contact_reminders`** — per-contact date/time reminders
- `id, contact_id` (→`crm_contacts` CASCADE), `field_id` (→`crm_custom_fields` CASCADE), `user_id` (→`users` CASCADE), `label, reminder_date, reminder_time, created_at`
- `message, recurrence` — added via migration (`recurrence`: `none|day|week|month|year`)
- Index: `idx_crm_reminders_user_date ON crm_contact_reminders(user_id, reminder_date)`

**`crm_projects`** — named groups of pipeline stages per CRM page
- `id, page_id, user_id, name, color, sort_order, created_at`

**`page_uploads`** — standalone files dropped directly on an Uploads homespace page
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `filename, original_name, mime_type, size, created_at`
- `folder_id INTEGER REFERENCES upload_folders(id) ON DELETE SET NULL` — added via migration (virtual folder assignment)
- `db_card_id INTEGER REFERENCES db_cards(id) ON DELETE SET NULL` — added via migration (links upload to a DB card)
- `db_card_attr_id INTEGER REFERENCES db_card_attrs(id) ON DELETE SET NULL` — added via migration (links to specific attr)
- Index: `idx_page_uploads_user ON page_uploads(user_id, created_at)`

**`page_upload_tags`** — user-defined tags applied to any file (note attachment or standalone upload)
- `id, upload_src TEXT CHECK(IN 'note','page'), upload_id INTEGER, user_id` (→`users` CASCADE), `tag TEXT, created_at`
- `UNIQUE(upload_src, upload_id, user_id, tag)` — idempotent `INSERT OR IGNORE`
- Index: `idx_page_upload_tags_user ON page_upload_tags(user_id, tag)`
- **No FK** to `note_attachments` or `page_uploads` — polymorphic source (intentional; avoids multi-target FK awkwardness)
- Orphaned rows (file deleted) are harmless; user `ON DELETE CASCADE` handles account cleanup
- `delete_page_upload()` manually sweeps tags before deleting the file row

**`pdf_annotations`** — overlay annotations on uploaded PDFs (Phase 8 / B2)
- `id, user_id` (→`users` CASCADE), `file_id` (→`page_uploads` CASCADE), `page_num` (0-indexed), `type` (`'highlight'`|`'sticky'`|`'textbox'`), `x_pct, y_pct, width_pct, height_pct, color, content, created_at`
- Index: `idx_pdf_annot_file ON pdf_annotations(file_id, user_id)`
- Coordinates are 0.0–1.0 fractions of page width/height. PDF on disk is NEVER modified.
- `content` = empty string for highlights; text for sticky/textbox

**`subscriptions`** — recurring cost tracker per Subscriptions homespace page (Phase 1, commit `177a335`)
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `page_id INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE`
- `name TEXT NOT NULL`
- `amount REAL NOT NULL DEFAULT 0`
- `currency TEXT NOT NULL DEFAULT 'USD'`
- `cycle INTEGER NOT NULL DEFAULT 3` — billing cycle: 1=daily 2=weekly 3=monthly 4=yearly
- `frequency INTEGER NOT NULL DEFAULT 1` — multiplier for the cycle (e.g. cycle=3 + frequency=3 = every 3 months)
- `category TEXT NOT NULL DEFAULT ''`
- `color TEXT NOT NULL DEFAULT '#0053e2'`
- `next_payment_date TEXT` — nullable ISO date `YYYY-MM-DD`
- `active INTEGER NOT NULL DEFAULT 1` — 0=inactive; inactive rows excluded from all analytics totals
- `notes TEXT NOT NULL DEFAULT ''`
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- Indexes: `idx_subscriptions_page(page_id)`, `idx_subscriptions_next_payment(page_id, next_payment_date)`
- `website_url TEXT NOT NULL DEFAULT ''` — added via migration (icon/link display)
- `reminder_days INTEGER NOT NULL DEFAULT 0` — added via migration (0 = no reminder; shows banner N days before due date)
- `start_date TEXT` — added via migration (ISO date `YYYY-MM-DD`, nullable; when the subscription began)

**`upload_folders`** — virtual folder tree scoped to an Uploads homespace page
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `name, parent_id` (→`upload_folders` SET NULL), `sort_order, created_at`
- `deleted_at DATETIME DEFAULT NULL` — added via migration (soft-delete)
- Index: `idx_upload_folders_page ON upload_folders(page_id, user_id, parent_id, sort_order)`

**`upload_catalogs`** — many-to-many label tree for Uploads pages (tags groups of files)
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `name, parent_id` (→`upload_catalogs` SET NULL), `sort_order, created_at`
- `deleted_at DATETIME DEFAULT NULL` — added via migration (soft-delete)
- Index: `idx_upload_catalogs_page ON upload_catalogs(page_id, user_id, parent_id, sort_order)`

**`upload_catalog_files`** — M2M junction: catalogs ↔ page_uploads
- `catalog_id` (→`upload_catalogs` CASCADE), `upload_id` (→`page_uploads` CASCADE), `user_id` (→`users` CASCADE), `added_at`
- `PRIMARY KEY (catalog_id, upload_id)`
- Index: `idx_ucf_upload ON upload_catalog_files(upload_id, user_id)`

**`buds`** — plant-care / relationship tracker entries per widget
- `id, widget_id` (→`home_widgets` CASCADE), `user_id` (→`users` CASCADE), `name, flower_species TEXT DEFAULT 'daisy'`
- `see_every_days INTEGER DEFAULT 7` — target watering interval
- `health REAL DEFAULT 100.0` — 0–100 score, degrades when overdue
- `health_updated_at DATE DEFAULT date('now')`, `last_watered_week TEXT`
- `crm_contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL` — optional CRM link
- `notes TEXT, sort_order, created_at`
- Indexes: `idx_buds_widget(widget_id, sort_order)`, `idx_buds_user(user_id)`, `idx_buds_crm(crm_contact_id)`

**`bud_fertilize_plans`** — scheduled check-in/fertilize events per bud
- `id, bud_id` (→`buds` CASCADE), `user_id` (→`users` CASCADE), `planned_date DATE, note TEXT, completed_at DATETIME, created_at`

**`home_grid_cells`** — grid layout cells for Grid-type homespace pages
- `id, page_id` (→`home_pages` CASCADE), `position INTEGER DEFAULT 0`
- `cell_type TEXT DEFAULT 'empty'`, `upload_id INTEGER REFERENCES page_uploads(id) ON DELETE SET NULL`
- `aspect TEXT DEFAULT '1:1'`, `caption TEXT DEFAULT ''`, `config_json TEXT DEFAULT '{}'`, `created_at`
- Index: `idx_grid_cells_page ON home_grid_cells(page_id, position)`

**`trip_spots`** — researched destinations / points of interest per Trip page
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `name, spot_type TEXT DEFAULT 'Other'`
- `cover_url, map_url, notes TEXT, priority INTEGER DEFAULT 3, estimated_cost REAL DEFAULT 0, currency TEXT DEFAULT 'USD'`
- `sort_order, created_at, updated_at` — `updated_at` maintained by trigger `trip_spots_updated_at`
- `location_id INTEGER REFERENCES trip_locations(id) ON DELETE SET NULL` — added via migration
- Index: `idx_trip_spots_page ON trip_spots(page_id, user_id)`

**`trip_days`** — day lanes inside a trip plan
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `day_label TEXT, day_date TEXT, sort_order, created_at`
- `plan_id INTEGER REFERENCES trip_plans(id) ON DELETE CASCADE` — added via migration (nullable for pre-existing rows)
- Index: `idx_trip_days_page ON trip_days(page_id, user_id)`

**`trip_day_spots`** — M2M: spots assigned to specific day lanes
- `id, day_id` (→`trip_days` CASCADE), `spot_id` (→`trip_spots` CASCADE), `time_label TEXT, sort_order`
- `UNIQUE(day_id, spot_id)`
- Index: `idx_trip_day_spots_day ON trip_day_spots(day_id)`

**`trip_day_blocks`** — flexible block content inside day lanes (notes, checklists, etc.)
- `id, day_id` (→`trip_days` CASCADE), `block_type TEXT DEFAULT 'note'`, `order_idx INTEGER DEFAULT 0`
- `time_label TEXT, content TEXT DEFAULT '{}'`
- Index: `idx_trip_day_blocks_day ON trip_day_blocks(day_id)`

**`trip_locations`** — research-layer locations (parent of spots) per Trip page
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `name, priority INTEGER DEFAULT 3`
- `notes TEXT, cover_url TEXT, sort_order, created_at`
- Index: `idx_trip_locations_page ON trip_locations(page_id, user_id, sort_order)`

**`trip_location_attrs`** — user-defined key/value attributes per location
- `id, location_id` (→`trip_locations` CASCADE), `attr_key TEXT, attr_value TEXT, sort_order`
- Index: `idx_trip_loc_attrs_loc ON trip_location_attrs(location_id)`

**`trip_spot_attrs`** — user-defined key/value attributes per spot
- `id, spot_id` (→`trip_spots` CASCADE), `attr_key TEXT, attr_value TEXT, sort_order`
- Index: `idx_trip_spot_attrs_spot ON trip_spot_attrs(spot_id)`

**`trip_plans`** — itinerary segments (named trips with date ranges) per Trip page
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE)`
- `plan_name TEXT DEFAULT 'Trip'`, `plan_desc TEXT`, `start_date TEXT, end_date TEXT, sort_order, created_at`
- `cover_url TEXT NOT NULL DEFAULT ''` — added via migration
- Index: `idx_trip_plans_page ON trip_plans(page_id, user_id)`

**`trip_plan_panels`** — utility side-cards per plan (documents, packing, budget, emergency info, settle-up)
- `id, page_id` (→`home_pages` CASCADE), `user_id` (→`users` CASCADE), `plan_id` (→`trip_plans` CASCADE)
- `panel_type TEXT NOT NULL`, `title TEXT, content TEXT DEFAULT '{}', sort_order, created_at`
- Index: `idx_trip_plan_panels_plan ON trip_plan_panels(plan_id)`
- `panel_type='settle'` rows are read/written by the Settle Up widget in sync mode

**`db_cards`** — kanban/grid cards inside a Database-type workspace node
- `id, db_id` (→`workspaces` CASCADE), `user_id` (→`users` CASCADE)
- `title TEXT DEFAULT 'Untitled'`, `cover_url TEXT, note_content TEXT, note_box_height INTEGER DEFAULT 200`
- `sort_order, created_at, updated_at` — `updated_at` by trigger `db_cards_updated_at`
- `cover_upload_id INTEGER REFERENCES page_uploads(id)` — added via migration; `page_uploads_cover_unlink` BEFORE DELETE trigger auto-clears on upload delete
- Index: `idx_db_cards_db ON db_cards(db_id, sort_order)`

**`db_card_attrs`** — user-defined attribute fields per DB card
- `id, card_id` (→`db_cards` CASCADE), `attr_key TEXT, attr_value TEXT, attr_type TEXT DEFAULT 'text'`
- `attr_options TEXT DEFAULT ''`, `sort_order`
- `visibility TEXT NOT NULL DEFAULT 'always'` — added via migration
- Index: `idx_db_card_attrs_card ON db_card_attrs(card_id, sort_order)`

**`note_reminders`** — inline reminders set via the `/reminder` slash command in notes
- `id, user_id` (→`users` CASCADE), `note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL`
- `label TEXT, reminder_date TEXT NOT NULL, reminder_time TEXT DEFAULT '09:00'`
- `message TEXT DEFAULT ''` — also added via additive migration for existing DBs
- `fired INTEGER DEFAULT 0`, `created_at`
- Index: `idx_note_reminders_user_date ON note_reminders(user_id, reminder_date)`

**`public_share_links`** — shareable tokens for notes and DB cards
- `id, token TEXT NOT NULL UNIQUE`
- `object_type TEXT CHECK(IN 'note', 'db_card')`, `object_id INTEGER NOT NULL`
- `owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `created_at DATETIME, expires_at DATETIME DEFAULT NULL`
- Indexes: `idx_pub_share_token(token)`, `UNIQUE idx_pub_share_object(object_type, object_id, owner_id)`
- Routes served under `/share/view/` prefix — bypassed by auth middleware (prefix check, NOT in `_PUBLIC`)

**`push_subscriptions`** — browser Web Push subscriptions per user
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `endpoint TEXT NOT NULL` — browser-provided push endpoint URL
- `p256dh TEXT NOT NULL` — browser public key (base64url)
- `auth TEXT NOT NULL` — browser auth secret (base64url)
- `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- `UNIQUE(user_id, endpoint)` — one row per device per user; `upsert_push_subscription` uses `INSERT OR REPLACE`
- Index: `idx_push_subs_user ON push_subscriptions(user_id)`
- Push is entirely opt-in: table only populated when user clicks the 🔔 bell toggle. Empty when `BW_VAPID_PRIVATE_KEY` not set.

---

## 🧩 Home Widget System

Each widget has a `widget_type` (string) and a `style` (string variant). Config stored as JSON.

| widget_type | Available Styles | Notes |
|---|---|---|
| `stack` | *(none — container type)* | Carousel wrapper that combines 2+ widgets into swipeable slides. Config: `{active_index, col_span, row_span, child_order: [id,…], min_height_px?}`. Chrome: `h-7` top gradient overlay (label + prev/next/gear) + dots bar at bottom when >1 child. `min_height_px` stored at creation time from JS `offsetHeight` measurement — template uses it as `min-height` directly so the stack matches the pre-stack visual size exactly. Inner cards have padding overridden by `initStackCards()` in `home-widget-stack.js`: `padding:0; paddingTop:1.75rem; paddingLeft/Right:0.5rem; paddingBottom:1.25rem (multi) or 0.25rem (single)`. **Never auto-inflate `row_span`** — size via `min_height_px` only. Child slide order stored in `child_order` array (drop-target = index 0). |
| `clock` | `digital`, `analog` | JS-driven; `home-widgets-clock.js` |
| `weather` | `default` | Server-side fetch via Walmart proxy → open-meteo API |
| `calendar` | `default` | JS mini-calendar |
| `todo` | `default`, `compact` | Checklist; compact = condensed rows |
| `reminder` | `default`, `agenda` | Date/time reminders; agenda = day-planner grouped view |
| `note_link` | `card`, `minimal` | **Multi-item link list** — pins any mix of notes and workspace databases to one card. Config (new shape): `{"items": [{"type": "note", "id": N, "title": "…", "snippet": "…"} \| {"type": "workspace", "id": N, "name": "…", "emoji": "…", "ws_type": "database"}], "open_mode": "popup"\|"tab"}`. **Legacy backward-compat:** old single-note shape `{"note_id": N, "note_title": "…", "note_snippet": "…", "open_mode": "…"}` is silently normalised to a one-item `items[]` list by both the Jinja2 macro (`render_note_link`) and the JS settings panel — no DB migration needed. Settings JS helpers (all in `home-widgets-settings.js`): `_nlWsCache`/`_nlItems` (module-level `var` state), `_nlRefreshEditor(widgetId)` — re-renders item rows + syncs hidden input, `_nlRefreshNotePicker()` — populates note picker from `all-notes-data` DOM tag, `_nlLoadWorkspaces(widgetId)` — fetches `GET /home/workspaces-for-picker` (result cached in `_nlWsCache`), `_nlRefreshWsPicker()`, `_nlPickNote(widgetId, sel)`, `_nlPickWorkspace(widgetId, sel)`, `_nlRemoveItem(widgetId, idx)`. |
| `timer` | `default` | Stopwatch |
| `countdown` | `default` | Countdown to a target date |
| `event` | `default` | Calendar event tracker with repeating-recurrence rules + countdown badges |
| `title` | `plain`, `ruled`, `badge`, `gradient`, `neon`, `typewriter`, `marquee`, `sticky`, `rainbow` | Section header text (banner style moved to its own widget) |
| `banner` | `cinema`, `oversize`, `slate`, `infrared`, `studio`, `editorial`, `dusk`, `amber` | Full-bleed banner header widget |
| `divider` | `default` | Visual separator |
| `text` | `default` | Rich text block |
| `sticky` | `paper`, `grid`, `kraft`, `chalk`, `memo` | Sticky note (editable text, distinct surface styles) |
| `quote` | `default` | Pull-quote block |
| `rss_feed` | `card`, `compact`, `minimal` | RSS feed widget; feeds auto-sync to linked RSS Reader pages |
| `upload_preview` | `grid`, `carousel` | **File Preview widget** — pinned uploads from any Uploads page rendered as a thumbnail grid or carousel. Config: `{upload_ids: [int], caption: "0"\|"1", style: "grid"\|"carousel"}`. No new DB tables — reads from existing `page_uploads` table. JS engine: `home-widget-upload-preview.js`. File picker calls `GET /home/pages` then `GET /home/uploads/{pid}/files?scoped=1`. |
| `settle_up` | `default`, `compact` | **Settle Up dashboard widget** — group expense splitter. Two modes: **standalone** (owns `{currency, people, expenses}` in `home_widgets.config_json`) and **sync** (reads/writes a Trip Planning `trip_plan_panels` row of `panel_type='settle'`). Config keys: `currency`, `people`, `expenses`, `synced_page_id`, `synced_plan_id`, `synced_panel_id`. JS engine: `home-widget-settle.js`. Sync-mode entry point: `_settleUpInit(el)` → `_suFetchSync` → `_suRender`; standalone seeds from `<script id="su-data-{wid}">` JSON blob. Settlement calc: `_suSettlementCalc(people, expenses)` — greedy debt simplification. Standalone write: `PUT /home/pages/{page_id}/widgets/{widget_id}/settle` (demo-guarded, ownership double-checked). Sync write: `PUT /home/trip/{page_id}/plans/{plan_id}/panels/{panel_id}`. Cascade picker endpoints (read-only, no demo guard): `GET /home/settle-up/trip-pages`, `GET /home/settle-up/trip-plans?page_id=N`, `GET /home/settle-up/settle-panels?page_id=N&plan_id=N`. Cascade helpers in `home-widgets.js`: `_suCascadePlans(tripPageSel)`, `_suCascadePanels(planSel)` — each repopulates its downstream select and restores saved value via `data-savedVal`. |
| `buds` | `default` | **Plant-care / relationship tracker widget.** Each "bud" is a person or virtual plant with a species (daisy/tulip/rose/etc.), a watering schedule (`see_every_days`), and a `health` score (0–100, degrades when overdue). Optional link to a CRM contact (`crm_contact_id`). DB: `buds` table + `bud_fertilize_plans` (scheduled check-ins). Router: `routers/home_buds.py` + `routers/home_buds_db.py`. JS engine: `home-widget-buds.js` (animated flower sprites from `static/img/buds/`). Entry point: `_budsInit(el)` called from `initHomeWidgets()`. |
| `subscriptions_summary` | `default` | **Subscriptions summary card** — compact read-only summary of active subscription costs (total monthly + count) that links to a Subscriptions homespace page. Config: `{linked_page_id}`. Data fetched from the `subscriptions` table via the Subscriptions page API. JS engine: inline via `home-widgets-render.js`. No standalone CRUD — purely a cross-page display widget. |

**Jinja2 filters used by widget templates** (all registered in `templates_env.py`):
- `fmt_bytes` — human-readable file sizes
- `fmt_reminder_date` — `'2025-01-06'` → `'Today'`, `'Tomorrow'`, `'Jan 6'`
- `sort_reminders` — sorts reminder items by date then time
- `evt_prepare_items` — sort/enrich event widget items with next-occurrence date, countdown badge, and repeat label
- `local_time` — UTC datetime string → server-local time string (e.g. `'6:19 PM'`)
- `local_date` — UTC datetime string → server-local date string (e.g. `'2025-04-07'`)
- `tojson` — JSON serialisation with `default=str`

> ⚠️ **Critical rule:** ALL new Jinja2 filters MUST be added to `templates_env.py`
> and registered on `_jinja_env` BEFORE the env is handed to `Jinja2Templates`.
> Starlette validates filter names at compile-time — missing filters = 500 on startup.

### 📦 Stack Widget — Sizing & Chrome Rules

The stack widget is a carousel container. Its sizing is tricky because slides are `absolute inset-0` — content cannot expand the grid row. Rules:

| Rule | Detail |
|---|---|
| **Never inflate `row_span`** | User said so explicitly. Row span stays as max of children's configured spans. |
| **Use `min_height_px` for visual height** | JS captures `card.offsetHeight` at drop time (capped at `rowSpan × 250px` to prevent sibling-grid inflation), sends as `height_px_hint`. Stored as `min_height_px` in `config_json`. Template applies it as `min-height: Npx` directly. |
| **Fallback for old stacks** | `min_height_px` absent → `calc(N * 7.5rem + 1.5rem)`. The `+1.5rem` compensates for 3rem of chrome vs 1.5rem of p-3 in standalone cards. |
| **Chrome heights** | Top: `h-7` = 28px (gradient, label, nav buttons). Bottom dots: `py-1` (4px×2) + `h-2` (8px) ≈ 16px. Total: ~44px. |
| **Inner card padding override** | `initStackCards()` in `home-widget-stack.js` overrides `p-3` via inline style: top=1.75rem, left/right=0.5rem, bottom=1.25rem (>1 child) / 0.25rem (1 child). |
| **Single-file fill** | `_uplPrevRender` in `home-widget-upload-preview.js` detects `files.length===1 && style!=='carousel'` and renders thumbnail with `w-full h-full` inside `flex-1 min-h-0` wrapper instead of the grid, so it fills the available card height exactly. |
| **Child ordering** | `child_order: [targetId, srcId]` stored at creation (drop-target = page 1). `stack_add_child` appends new widget id. `get_widgets()` re-sorts children by `child_order` on every read; falls back to `sort_order` for old stacks without `child_order`. |
| **Fixing an old squished stack** | Unstack it (stack mode → unstack button) and re-drag to re-stack. JS will re-measure and store `min_height_px` correctly. |

---

## 🔐 Auth System

- Session-based via `starlette.middleware.sessions` (30-day cookie TTL)
- `AuthMiddleware` in `auth_middleware.py` intercepts unauthenticated requests
- Public routes (bypass auth — `_PUBLIC` set in `auth_middleware.py`): `/login`, `/setup`, `/register`, `/favicon.ico`, `/2fa/verify`, `/demo/start`, `/demo/end`, `/demo/pre-end`, `/demo/cancel-end`, `/demo/alive`, `/health`, `/manifest.json`, `/sw.js`, `/offline`
  - PWA routes (`/manifest.json`, `/sw.js`, `/offline`) are public so browsers and the OS can fetch them without a session cookie (needed for installable PWA / offline page support)
- `/static/` prefix is allowed separately via path-prefix check, not via `_PUBLIC`
- `/wopi/` prefix is also bypassed via the same path-prefix check (alongside `/static/`) — **NOT added to `_PUBLIC`**. This lets Collabora’s server-to-server WOPI callbacks (CheckFileInfo, GetFile, PutFile) reach BookWorm without a session cookie; they carry a short-lived `itsdangerous` token in `?access_token=` instead.
- First-run: `/setup` creates the first user (role=`superadmin`). Blocked if any user exists.
- Optional **TOTP 2FA** per user (`routers/totp.py`). QR code setup + verify flow.
- Role system: `user` (regular) and `superadmin` (can manage all users via admin panel)
- Session secret: `BW_SECRET_KEY` env var, or loaded from `security.py` (`load_secret_key()`)

---

## 🏗️ Architecture Patterns

### HTMX + Partial Templates
- Routes that return HTML fragments live alongside full-page routes in the same router
- Partial templates live in `templates/partials/`
- HTMX swaps drive all dynamic updates (no full-page reloads)
- OOB swaps (`hx-swap-oob`) used for sidebar/breadcrumb updates after mutations

### Workspace Isolation
- Notes and workspaces are **per-user** — always filter by `user_id`
- `get_first_workspace_id(user_id)` used instead of hardcoded `ws=1` fallback
- The `GET /` route validates workspace ownership before rendering
- `search_notes()` **requires** `workspace_ids` list — never call without it (leaks all users' notes)

### Static Asset Cache-Busting
- `_static_version()` in `templates_env.py` computes max mtime of all `.js`/`.css` files
- Exposed as Jinja2 global `static_v` → used as `?v={{ static_v }}` query param on asset URLs
- Recomputed once at server startup — restart server after JS/CSS changes in production

### Confirmation / Info Modals — Standard Pattern
**Never use `window.confirm()` or `window.alert()`.** All confirmation dialogs must use the
consistent styled modal structure. Copy this pattern exactly:

```html
{# ── My action confirmation modal ────────────────────────────────── #}
<div id="my-action-modal"
     class="hidden fixed inset-0 z-50 flex items-center justify-center"
     role="dialog" aria-modal="true" aria-labelledby="my-action-title"
     onkeydown="if(event.key==='Escape')_myCancelFn()">
  <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"
       onclick="_myCancelFn()" aria-hidden="true"></div>
  <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
    <div class="flex items-center gap-3 mb-4">
      <span class="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30
                   flex items-center justify-center text-[#ea1100]" aria-hidden="true">
        <!-- SVG icon OR emoji -->
      </span>
      <h2 id="my-action-title" class="text-base font-bold text-gray-900 dark:text-zinc-100">Title?</h2>
    </div>
    <p class="text-sm text-gray-600 dark:text-zinc-400 mb-5">Body text explaining the action.</p>
    <div class="flex gap-3 justify-end">
      <button type="button" onclick="_myCancelFn()"
              class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-zinc-600
                     text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800
                     transition focus:outline-none focus:ring-2 focus:ring-gray-300">Cancel</button>
      <button id="my-action-confirm-btn" type="button" onclick="_myConfirmFn()"
              class="px-4 py-2 text-sm rounded-lg bg-[#ea1100] text-white font-semibold
                     hover:bg-red-700 transition focus:outline-none focus:ring-2 focus:ring-[#ea1100]">Confirm</button>
    </div>
  </div>
</div>
```

**Icon colour guide by action type:**
| Action | Icon bg | Icon colour | Button bg |
|---|---|---|---|
| Destructive (delete) | `bg-red-100 dark:bg-red-900/30` | `text-[#ea1100]` | `bg-[#ea1100]` |
| Warning (undo/revert) | `bg-amber-100 dark:bg-amber-900/30` | `text-amber-600` | `bg-[#ea1100]` |
| Neutral / info | `bg-blue-100 dark:bg-blue-900/30` | `text-[#0053e2]` | `bg-[#0053e2]` |
| Success / confirm | `bg-green-100 dark:bg-green-900/30` | `text-[#2a8703]` | `bg-[#2a8703]` |

**JS wiring pattern (always in the companion JS, never inline `<script>`):**
```javascript
var _myPendingItem = null;   // store the item needing confirmation

function _myOpenModal(item) { _myPendingItem = item; document.getElementById('my-action-modal').classList.remove('hidden'); }
function _myCancelFn()      { _myPendingItem = null; document.getElementById('my-action-modal').classList.add('hidden'); }
async function _myConfirmFn() {
  if (!_myPendingItem) return;
  var btn = document.getElementById('my-action-confirm-btn');
  if (btn) btn.disabled = true;
  try { /* do the action */ } catch(e) { /* toast error */ } finally { if (btn) btn.disabled = false; }
  _myCancelFn();
}
```
**Existing modals using this pattern:** `#upl-del-modal`, `#upl-remove-stamp-modal`,
`evt-del-confirm-modal`. Check those files if you need a real example.

---

## 🌐 Network & Proxy — RSS Fetching

All RSS and feed-related HTTP requests in BookWorm go through the helpers in `routers/home.py`, NOT `urllib` directly.
Walmart's network routes all outbound HTTPS through a **PAC-file-configured proxy** (`wmtpac.wal-mart.com/proxies/universal.pac`) which points to `sysproxy.wal-mart.com:8080`.
`urllib.request` does not support PAC files (only reads static registry proxy, which is disabled on Walmart machines).
We use **`httpx`** for all outbound fetches, configured with the proxy auto-detected by `_detect_proxy()` at module import time.

### Proxy auto-detection — `_detect_proxy()`

Runs **once** at module load; result cached in module-level `_PROXY: str`.

| Priority | Source | Example |
|---|---|---|
| 1 | `BW_HTTP_PROXY` env var | explicit operator override |
| 2 | `HTTPS_PROXY` / `HTTP_PROXY` env vars | Docker / CI |
| 3 | Windows registry `AutoConfigURL` → fetch PAC → first `PROXY host:port` | `http://sysproxy.wal-mart.com:8080` (Walmart machines) |
| 4 | `''` | direct connections (Linux without proxy env vars) |

On Walmart Eagle WiFi/VPN the registry holds `http://wmtpac.wal-mart.com/proxies/universal.pac`; `_detect_proxy()` fetches it at startup and extracts `sysproxy.wal-mart.com:8080` automatically — zero config needed.
For Docker deployments on non-Walmart networks, set `BW_HTTP_PROXY=http://sysproxy.wal-mart.com:8080` in `docker-compose.yml`.

### Key helpers

| Function | Signature | What it does |
|---|---|---|
| `_detect_proxy` | `() → str` | Auto-detects the outbound proxy at startup (see table above). Result stored in `_PROXY`. |
| `_httpx_fetch` | `(url, extra_headers=None, timeout=15) → (bytes, content_type_str)` | Fetches URL via `httpx.Client(proxy=_PROXY, follow_redirects=True)`. Raises `urllib.error.URLError` / `urllib.error.HTTPError` (re-wrapped from httpx exceptions) so callers don't need to change their except blocks. |
| `_fetch_raw` | `(url, send_rss_accept=True) → (text, content_type_bare)` | Wraps `_httpx_fetch`. `send_rss_accept=True` adds `Accept: application/rss+xml, application/atom+xml…` header. **Set `send_rss_accept=False` when following autodiscovered feed URLs** — some servers return 5xx if that header is present. Decodes bytes using charset from Content-Type (defaults to UTF-8). |
| `_fetch_bytes` | `(url) → (bytes, content_type)` | Binary variant (for images, etc.). No Accept header. |
| `_autodiscover_feed_url` | `(html, base_url) → str \| None` | Scans HTML for `<link rel="alternate" type="application/rss+xml">` in both attribute orderings. Returns `None` if nothing found. |
| `_parse_yt_html` | `(html_text) → dict \| None` | **YouTube HTML scraper.** Finds `var ytInitialData = {...}` in the page source, decodes it with `json.JSONDecoder().raw_decode()`, then BFS-walks the JSON tree collecting up to 20 video items. Handles **two renderer formats** (see below). Returns `{feed_title, items}` in the same shape as `_parse_rss()`, or `None` if no videos found. |
| `rss_proxy` | `GET /home/rss?url=…` | Main endpoint. (1) Fetches the URL via `_fetch_raw`. (2) If response is HTML and URL is `youtube.com`: calls `_parse_yt_html` on the page; if that returns nothing, retries on `{url}/videos` tab; returns 502 if both fail. (3) For non-YouTube HTML: runs `_autodiscover_feed_url`, follows discovered feed URL, or returns descriptive error JSON. (4) For XML/Atom: parses directly with `_parse_rss()`. |

### YouTube renderer formats — `_parse_yt_html`

YouTube changed their page JSON structure in 2024. `_parse_yt_html` handles both:

| Era | BFS target | Data path |
|---|---|---|
| **Legacy (≤2023)** | `videoRenderer` / `gridVideoRenderer` dict key | `videoId`, `title.simpleText`, `publishedTimeText.simpleText`, `viewCountText.simpleText` |
| **Modern (2024+)** | `richItemRenderer → content → lockupViewModel` | `rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId`, `metadata.lockupMetadataViewModel.title.content`, `metadataRows[0].metadataParts[-1].text.content` (pub date), `metadataParts[0].accessibilityLabel` (views) |

Helper functions inside `_parse_yt_html`:
- `_safe_get(obj, *keys, default='')` — safe chained dict.get
- `_item_from_legacy(vr)` — extracts item from old `videoRenderer` / `gridVideoRenderer`
- `_item_from_lockup(lvm)` — extracts item from new `lockupViewModel`; video ID falls back to `contentId`, then regex on thumbnail URL

### Why YouTube's RSS endpoint is bypassed

YouTube's `feeds/videos.xml?channel_id=UC…` endpoint is blocked through Walmart's corporate proxy. The YouTube channel *page* (`/@handle`) returns HTTP 200 fine. `_parse_yt_html` exploits the `ytInitialData` JSON blob YouTube embeds in every channel page.

> **Fallback strategy inside `rss_proxy`:**
> 1. Fetch `/@handle` → try `_parse_yt_html` (Home tab — may have `richItemRenderer` or `videoRenderer`)
> 2. If no items → fetch `/@handle/videos` tab → try `_parse_yt_html` (always has `richItemRenderer`)
> 3. If still no items → return 502 `"YouTube is temporarily unavailable — refresh to retry."`

### Critical network facts

- **Proxy (Walmart):** `http://sysproxy.wal-mart.com:8080` — auto-detected via PAC file; no manual config needed on Eagle WiFi/VPN
- **Proxy (Docker/other networks):** set `BW_HTTP_PROXY` in `docker-compose.yml` (or leave blank for direct connections)
- **Old `_curl_fetch` approach (removed):** Used `subprocess curl --proxy-negotiate -u :` with Windows SSPI Kerberos. Replaced because `curl` is not available in `python:3.13-slim-bookworm` Docker images.
- **YouTube `feeds/videos.xml`** → blocked through Walmart proxy
- **YouTube channel pages (`/@handle`)** → HTTP 200 fine; `_parse_yt_html` scrapes the embedded `ytInitialData`
- **`/videos` tab** is the most reliable fallback — always has `richItemRenderer` nodes in modern YouTube

### RSS debug quick-lookup (extended)

| Symptom | First file to read |
|---|---|
| YouTube feeds return "All Feeds failed" | `routers/home.py` → `_parse_yt_html()` then `rss_proxy()` YouTube branch |
| YouTube feeds return 502 "temporarily unavailable" | `_parse_yt_html` found no items — check renderer types: run a probe script looking for `richItemRenderer`/`lockupViewModel` in `ytInitialData`. YouTube may have changed page structure again. |
| All feeds fail with connection error | `_detect_proxy()` may have failed to detect the proxy. Check `_PROXY` at import time. On Walmart network, `wmtpac.wal-mart.com` must be reachable. For Docker, set `BW_HTTP_PROXY`. |
| Non-YouTube feeds: proxy/connection error | `_httpx_fetch()` — verify `_PROXY` is correct; check `BW_HTTP_PROXY` env var |
| Feed returns HTML instead of XML | `rss_proxy()` HTML-detection branch → `_autodiscover_feed_url()` → `<link rel=alternate>` absent from site |
| Feed rename / save fails | `static/js/home-page-rss.js` → `rssUpdateFeed()` then `routers/home_rss.py` → `update_feed` |
| Feed delete fails | `static/js/home-page-rss.js` → `rssDeleteFeed()` then `routers/home_rss.py` → `remove_feed` |
| Feeds not loading at all | `initRssPage()` in `home-page-rss.js`; `_initSwappedPage()` in `home-widgets.js` |
| RSS page blank after HTMX nav | `home-widgets.js` → `_initSwappedPage()` → `rss-page-root` guard |
| Session expiry triggers wrong error | `auth_middleware.py` `_bounce()` — fetch() gets 302→HTML; check `r.redirected` before `r.json()` |

---

## 🚧 In Progress / Last Session Work

> ⚠️ **This section requires human judgment to update — not auto-updated by docs-keeper.**
> Last recorded session: **2026-05-25** (Biometric/WebAuthn sign-in shipped; 6 account modal bugs fixed; WebAuthn proxy origin mismatch fixed; daily reminder double-fire fixed).

| Item | Status | Notes |
|---|---|---|
| Biometric / Passkey sign-in (WebAuthn) | ✅ Shipped (2026-05-25) | Full WebAuthn registration + authentication flow using `py-webauthn==2.7.1`. New table `webauthn_credentials` (auto-migrates). New files: `routers/webauthn.py` (6 endpoints: panel GET, register begin/complete, delete, auth begin/complete), `routers/webauthn_db.py` (DB helpers), `static/js/bw-webauthn.js` (browser API: `bwWaRegister`, `bwWaAuthenticate`, `bwWaInitVerifyPage`, `bwWaAvailable`, `bwWaDelete`), `templates/partials/webauthn_panel.html`, `templates/2fa_verify.html`. Biometric registered on a device = fingerprint prompt replaces TOTP code on that device at login. `routers/auth.py` checks `has_credentials()` to gate the 2FA step. Credentials stored as public key only — private key stays in OS secure enclave. Commits `c27cf90`. |
| Account modal: biometric section invisible | ✅ Fixed (2026-05-25) | Added biometric as its own top-level section `acct-s-wa` but `_acctNav()` only knew `['s1','s2','s3']` and L-mode CSS grid only positioned those three IDs. Section rendered off-grid and invisible. Fix: folded biometric loader directly inside `acct-s2-body` (Security section) where it semantically belongs — no nav or CSS changes needed. Commit `fbd6e4a`. |
| Account modal: stray `═══ #}` visible text | ✅ Fixed (2026-05-25) | Two separate files had orphaned Jinja2 comment closers rendering as literal text. (1) `2fa_panel.html` line 119: multi-line comment closed with `── #}` — dashes before `#}` rendered as visible text. Fixed by converting to two single-line `{# ... #}` comments. (2) `admin_users.html` line 110: stray `════ #}` between Site Settings and Registered Users sections — orphaned comment close with no matching open. Deleted the line. Commits `fbd6e4a`, `18cbfde`. |
| Account modal L-mode: cannot scroll up | ✅ Fixed (2026-05-25) | CSS Grid items default to `min-height:auto` which means they size to full content height and never shrink — `overflow-y:auto` never triggered. The `max-height:72vh` on the container clipped at the outer level. Fix: added `height:72vh` + `grid-template-rows:1fr` to grid container and `min-height:0` + `overflow-y:auto` to sidenav and all three section panels so each tab scrolls independently. Commit `18cbfde`. |
| Account modal: QR code off-screen on phone (M/L) | ✅ Fixed (2026-05-25) | M/L CSS grid placed QR in `grid-column:2` (right side) with no mobile override. On narrow phones the right column overflowed off-screen. Fix: added `@media (max-width:639px)` override in `2fa_panel.html` `<style>` block that reverts M and L to `flex-direction:column` on phones. Commit `fbd6e4a`. |
| Biometric register button overflow on mobile | ✅ Fixed (2026-05-25) | `flex-row` input + button overflowed on narrow screens. Changed to `flex-col` on mobile, `sm:flex-row` on ≥640px. Commit `18cbfde`. |
| WebAuthn origin mismatch behind TLS proxy | ✅ Fixed (2026-05-25) | `_rp_config()` read `request.url.scheme` which returns `http` on the internal side of a TLS-terminating proxy (Caddy/nginx). WebAuthn exact-match on origin caused `http://note.toramochie.com` expected vs `https://note.toramochie.com` from browser. Fix: scheme priority now `BW_WEBAUTHN_ORIGIN` env var → `BW_HTTPS=true` → `X-Forwarded-Proto` header → `request.url.scheme`. Also added `BW_WEBAUTHN_RP_ID`/`BW_WEBAUTHN_ORIGIN` to `docker-compose.yml` environment block (were documented in `.env` but never passed to container) and a `WARNING`-level startup log so effective config is always visible. Commits `9a83c38`, `1839769`, `bd836cb`. |
| Daily reminder widget: multiple push per day | ✅ Fixed (2026-05-25) | Two bugs causing re-fires. (1) Server: dedup key used `hash()` which is randomised per Python process (`PYTHONHASHSEED`). Every server restart produced a different `text_hash` — new key not in `widget_notif_sent` — push fired again. Fixed by replacing `hash()` with `hashlib.sha256().hexdigest()[:8]` (deterministic across all restarts and workers). (2) Client: `_checkReminderNotifications()` fired a browser/SW notification at the exact reminder minute even when push was already subscribed, causing a double-tap. Fixed with `pushActive` guard matching the existing CRM client pattern. Commit `2a753b2`. |
|---|---|---|
| Subscriptions Phase 1 | ✅ Shipped (2026-04-22) | 5 endpoints, Chart.js donut+bar, `subscriptions` table |
| Tailwind CDN → local bundle | ✅ Shipped (2026-04-22) | CLI v3.4.17, `static/css/tailwind.css` committed |
| Trip Planning homespace | ✅ Shipped | `trip_*` tables, panels, buds, grid all in DB |
| Buds widget | ✅ Shipped | `buds` + `bud_fertilize_plans` tables, widget type in dispatch |
| Grid homespace | ✅ Shipped | `home_grid_cells` table, `home-page-grid.js` |
| Public share links | ✅ Shipped | `public_share_links` table, `/share/view/` routes |
| Grid mobile layout | ✅ Fixed (2026-05-13) | Mobile always uses 1fr presets; explicit `width:100%`; auto-fill uses `minmax` |
| Subscriptions mobile layout | ✅ Fixed (2026-05-13) | Analytics stack below list on mobile; `<style>` media-query override |
| Trip Research mobile UX | ✅ Fixed (2026-05-13) | Add buttons shrink to `＋`; cover cards taller; tap card = edit; type pills hidden |
| Trip Chart tab mobile | ✅ Fixed (2026-05-20) | Selectors on one row (nowrap), label text hidden, max-width 38vw cap, bar alignment |
| Trip resource cards mobile | ✅ Fixed (2026-05-20) | Cards centered with even margins via `mx-auto` |
| Database page mobile | ✅ Fixed (2026-05-21) | Size slider hidden, Add card = icon-only, filter/fields panels clamp to right edge, card detail grip hidden |
| Timeline mobile | ✅ Fixed (2026-05-21) | Worm scales to 26px, 2D drag (axis-locked), smaller cards 145×60, landscape breakpoint |
| Widget settings modal mobile | ✅ Fixed (2026-05-21) | `max-height:85dvh`, `flex-col overflow-hidden` card, scrollable body, pinned header+footer |
| Login page mobile | ✅ Fixed (2026-05-21) | `overflow-y-auto` body, responsive padding, tighter logo/worm, demo button shrinks |
| Demo sessionStorage isolation | ✅ Fixed (2026-05-21) | 3-layer fix: `bw-uid` guard in `<head>`, `main.py` exposes `current_user_id`, catch clears stale `bw-hp` |
| Grid cells use `thumb_url` + onerror fallback | ✅ Fixed (2026-05-25) | `home-page-grid.js`: `_crmEsc(cell.thumb_url\|\|cell.url)` as `<img src>`; `onerror` swaps to full URL so broken thumbnails degrade gracefully. Commit `18c661e`. |
| CRM: Address default field | ✅ Shipped (2026-05-25) | Additive DB migration adds `address TEXT NOT NULL DEFAULT ''` to `crm_contacts`. Backend (`add_contact`/`update_contact` + both endpoints) + frontend textarea in 2-col default-fields grid (full-width, flat underline style). Commits `5f58a34`. |
| CRM: Mobile add-field button overflow | ✅ Fixed (2026-05-25) | `#crm-af-form` inner row changed from `flex-row` (clips off-screen on narrow phones) to `flex-col`: Field Name input full-width on first line; Type select (`flex-1`) + Add button (`flex-shrink-0`) share second line. Commit `5f58a34`. |
| CRM: Reminder custom field type | ✅ Shipped (2026-05-25) | New `reminder` field type end-to-end: DB layer `upsert_field_reminder()` (delete-then-insert on `contact_id+field_id` — no duplicates on re-save) + `clear_field_reminder()`; two new API endpoints (`POST /field-reminder`, `POST /field-reminder/{id}/clear`); frontend renders Date+Time+Repeat+Message sub-inputs inline in contact modal; `crmSyncRemVal()` keeps hidden JSON input live; `crmSaveContact()` upserts or clears the reminder row after saving field values; rows land in `crm_contact_reminders` so 30 s poll, top-bar missed-reminders banner and push all fire automatically. `VALID_TYPES` in both `create_field` and `edit_field` updated; bonus: `edit_field` was also missing `priority`. Commits `5f58a34`, `7f33586`. |
| CRM: Address autocomplete via Nominatim | ✅ Shipped (2026-05-25) | Replaced static `<textarea autocomplete=street-address>` with a live-search widget: 400 ms debounce, 4-char minimum, fetches from Nominatim (OSS, no API key), up to 6 suggestions in a `<ul>` dropdown, full keyboard nav (↑/↓/Enter/Esc), 200 ms onblur delay so mousedown on suggestion fires first. `_crmAddrFormat()` cleans every result before display and pick: abbreviates compass directions (longest-compound first: Northwest→NW etc.), strips county/parish/borough/township segments, joins bare house number to street name with a space (Nominatim sometimes emits `"123, Main St"`). Results stored as `item._fmt` — formatted once, used in both dropdown label and input fill (DRY). Commits `7f33586`, `c9eb9a6`, `234bcc9`. |
| Uploads detail panel — view-mode-aware | ✅ Fixed (2026-05-25) | `_uplShowDetailPanel()` / `_uplRemoveDetailBackdrop()` / `_uplCloseDetail()` rewritten; stray `}` SyntaxError at line 505 removed; 18 commits pushed to GitHub |
| PWA: manifest shortcuts + Safari banner + offline dark fix | ✅ Shipped (2026-05-25) | `shortcuts` in `pwa_manifest()`; `_isSafariDesktop()` + `#bw-pwa-safari` panel; `offline.html` reads `bw-theme` from localStorage before paint |
| Sidebar UX polish | ✅ Shipped (2026-05-25) | Homespace page names left-aligned (`text-left`); grip handle gap `0.5→2`; General folder header consistent with Workspace/Homespace (chevron left, whole label clickable) |
| Homespace grip handle hover + mouse DnD | ✅ Shipped (2026-05-25) | **6-round debugging saga.** Final solution: `home-widgets.js` `_injectStyle()` uses three-pronged `bw-touch` detection: (1) `matchMedia('(hover:none) and (pointer:coarse)')` for real mobile; (2) `sessionStorage.getItem('bw-touch')==='1'` — persists across hard-refresh/HTMX within same tab after first touch, cleared on tab close; (3) one-time `touchstart` listener that sets body class AND saves sessionStorage flag — fires on emulator click or real touch, never fires from laptop mouse. `maxTouchPoints` NOT used — Windows reports 0/1/2+ unpredictably based on drivers. Hover selector changed from `.group\/hpg:hover` (JS string escape inconsistent across browsers) te-list li:hover` in the injected `<style>`. Added `_initPageMouseDnd()` IIFE for desktop mouse drag-to-reorder — drag was touch-only before, `draggable=true` on `<li>` only handled trash drops. Mouse reorder delegates `dragstart/dragover/dragleave/drop/dragend` from document, shows blue indicator line, moves DOM instantly then POSTs to `/home/pages/reorder`. **Key lesson: always `rebuild_css.bat` → `restart.bat` after any Tailwind class changes** — `static_v` is computed once at server startup so browser caches old CSS until restart. |
| Separate mobile/desktop widget layouts | ✅ Shipped (2026-05-25) | **Option A — mobile order in `home_pages.config_json`.** New config keys per page: `mobile_widget_order` (JSON array of widget IDs — saved when user drags on a phone), `mobile_col_count` (phone-specific grid column count). Per-widget: `mobile_col_span` in `home_widgets.config_json`. New endpoint `POST /home/pages/{id}/widgets/reorder-mobile`. New DB helpers: `reorder_widgets_mobile`, `_append_mobile_order`, `_prune_mobile_order` in `home_db.py`. `_applyWidgetGridColCap()` extended to read mobile attrs on phones. New `_applyMobileWidgetOrder()` reorders DOM on phones. Settings modal shows 📱 Mobile / 🖥️ Desktop badge (`#pg-layout-device-badge`). `_buildSizePicker` / `_selectSize` / `openPageLayout` / `selectPageLayout` all breakpoint-aware. Stray `}` SyntaxError in `selectPageLayout` fixed same session (commit `94235f6`). |
| Web Push notifications (VAPID) | ✅ Shipped (2026-05-25) | VAPID P-256 key pair generahon gen_vapid_keys.py`. New table `push_subscriptions`. New router `routers/push.py` (4 endpoints: vapid-key GET, subscribe POST, unsubscribe DELETE, test POST). New JS `static/js/bw-push.js` (bell toggle, subscribe/unsubscribe, `sw.js` `push` + `notificationclick` handlers). Three new env vars: `BW_VAPID_PRIVATE_KEY`, `BW_VAPID_PUBLIC_KEY`, `BW_VAPID_SUBJECT`. Feature entirely disabled (no-op) when `BW_VAPID_PRIVATE_KEY` is empty — safe for Docker deployments without push. `bw_vapid_public_key` Jinja2 global + `<meta name="bw-vapid-key">` in `base.html`. |
| CRM push loop: `else` → `elif result` | ✅ Fixed (2026-05-25) | `_widget_notif_loop` CRM section used bare `else:` — a transient push failure (False) was treated the same as success and incorrectly added to `sent_keys`, preventing retries. Commit `ccac6c5`. |
| CRM push race condition — client vs server | ✅ Fixed (2026-05-25) | Client-side 30-second poll called DELETE / advance endpoints immediately after showing a toast, wiping the reminder from the DB before the 60-second server push loop could find it. Fix in `home-page-crm-reminders.js`: client checks `document.getElementById('bw-push-btn')?.dataset?.active === '1'` — if push is subscribed the client skips all DB cleanup (server owns it); otherwise falls back to old client-side behaviour. Commit `7b081d3`. |
| Push audit: `date_str` NameError in widget loop | ✅ Fixed (2026-05-25) | My debug log added `date_str` to `_widget_notif_loop` but the variable was never defined in that scope (`today_str` was defined later, after the CRM section). Caused a `NameError` every 60 seconds that crashed the loop body from the CRM section onward — both CRM push AND Home Reminder widget push were silently dead. Fix: added `date_str = today.isoformat()` at the very top of the loop body (before all sections). Commit `4911dae`. |
| Push audit: bud loops `else` → `elif result` | ✅ Fixed (2026-05-25) | `_bud_notif_loop` contact AND visit reminder sub-loops both used bare `else:` when handling `send_push` results — transient failures (False) marked the bud/plan as sent, blocking retries. Changed both to `elif result:`. Commit `4911dae`. |
| Push audit: bud contact query exact-minute match | ✅ Fixed (2026-05-25) | `get_due_bud_contact_reminders()` in `home_buds_db.py` compared `contact_reminder_time = ?` (exact equality). If `asyncio.sleep` drift caused the loop to wake at e.g. 09:01 when the reminder was set for 09:00, the minute would be missed permanently. Changed to `<=` — the `contact_reminder_last_sent != today` dedup in the same query prevents double-firing. Commit `4911dae`. |
| PWA reinstall — push subscription lost silently | ⚠️ Known UX gap | When a user uninstalls + reinstalls the PWA the browser wipes the push subscription. The 🔔 bell resets to “Off” with no in-app prompt. Root cause of the original “push not working” report was simply the user never re-enabling notifications after reinstall. All server-side code was correct. Potential fix: add a one-time hint banner on first load when VAPID is configured but no subscription is active. Not yet implemented. |
| PWA: Android push badge icon | ✅ Shipped (2026-05-25) | All 12 `badge` notification payload fields in `main.py` (11), `routers/push.py` (1), and `sw.js` fallback now use `/static/img/icons/badge-96.png` instead of `icon-192.png`. New `badge-96.png` is a 96×96 **RGBA** PNG (white worm silhouette on transparent background) generated by `_make_badge()` in `bw_pwa_icons.py`. Android only renders the alpha channel of the badge field — `icon-192.png` (solid green background = every pixel opaque) produced a solid white square in the status bar. `generate_icons()` now writes 5 files (was 4). Commit `4db3d88`. |
| PWA: Mac Safari install gap | ⚠️ Known limitation | Mac Safari desktop gets **no** install banner — `_isIos()` returns `false` (correct), but Safari also never fires `beforeinstallprompt`. Fix already shipped for this: `_isSafariDesktop()` branch in `_initInstallBanner()` shows the `#bw-pwa-safari` panel with "File → Add to Dock" instructions after 4 s. Mac Chrome/Edge = identical to Windows (both use `beforeinstallprompt`). Once installed via Safari, `_isInstalled()` detects it correctly via `display-mode: standalone`. |
| Next planned work | ❓ Unknown | Update this section at start of next session |

---

## ✅ Features Completed (as of 2026-04-22)

- [x] Multi-user auth (login/logout/register/setup) with session management
- [x] Optional per-user TOTP 2FA
- [x] Superadmin user management panel
- [x] Hierarchical workspaces (nested folders, drag-drop reorder, soft-delete trash with 30-day purge)
- [x] Workspace favorites + pinned "open" tabs
- [x] Rich note editor (Markdown-style, slash commands `/`, attachments)
- [x] File attachments per note (upload/download/delete)
- [x] Categories (global colour-tagged) + custom attribute definitions per workspace
- [x] Timeline view (JS-driven, keyboard shortcut `T`)
- [x] Spell-check integration
- [x] Dark mode
- [x] Personal home pages with drag-drop widget grid
- [x] Home widgets: clock, weather, calendar, todo, note_link, timer, countdown, title, divider, text
- [x] Todo widget — `default` + `compact` style variants
- [x] Reminder widget — `default` + `agenda` (day-planner) style variants
- [x] `sort_reminders` Jinja2 filter + `fmt_reminder_date` filter
- [x] Browser notification support for reminders (in progress — last session)
- [x] **RSS widget → RSS Reader page one-way sync** — widget feeds auto-pushed to all `rss` pages on widget create / settings save / page load. Each synced feed now stores `source_widget_id` (FK to `home_widgets`) so the reader knows which widget it came from. Widget deleted → `source_widget_id` SET NULL automatically (FK cascade), feed retained as "Manual". Direct reader-page feeds are independent. `INSERT OR IGNORE` = first-writer wins if two widgets share a URL (known limitation).
- [x] **RSS Reader: category filter top bar** — `<div id="rss-top-cat-bar">` full-width bar between page title and 3-column layout; `_renderTopCatBar()` called at end of `_renderFeedList()` and early-return path. Hidden when no categories exist. (Supersedes sidebar `#rss-cat-pills` + `_renderCatPills()`, which were removed.)
- [x] **RSS Reader: widget source badge** — each feed row shows a 📌 `PageName › WidgetLabel` badge when `source_widget_id` is set. Badge data injected via `window._rssWidgetSources` (built server-side by `_build_widget_sources()` in `routers/home.py`; short-circuits to `{}` when no feeds have a source widget). Widget deleted → badge disappears automatically (FK SET NULL).
- [x] **4 BookWorm-specific Code Puppy skills created** — `bookworm-widget-scaffolder`, `bookworm-pre-commit`, `bookworm-db-migration`, `bookworm-template-audit` (see 🐾 Skills section below)
- [x] **CRM Homespace page (Phase 1)** — per-page contact database with table + gallery view, custom field definitions (text/select/url/date/number), full CRUD for contacts and fields, field-value upsert (`UNIQUE(contact_id, field_id)`), authz ownership checks via `_get_crm_page()`. Router: `routers/home_crm.py` (9 endpoints). DB: `crm_contacts` + `crm_custom_fields` + `crm_contact_field_values`. JS: `home-page-crm.js` (`initCrmPage`). Template: `home_page_crm.html`.
- [x] **CRM Phase 3 Feature B — New Field Types: checkbox, multi_select, file_links (complete, verified 2026-04-11 by bookworm-qa — 100% green)** — `crm_custom_fields.field_type` now supports 9 values (`text`, `select`, `multi_select`, `checkbox`, `url`, `email`, `date`, `number`, `file_links`). Value encoding: `'1'`/`'0'` for checkbox; JSON array string for multi_select and file_links; plain text for others. `_CRM_FIELD_TYPE_DEFS` constant (array of `{v,l}` objects) defined at top of `home-page-crm-fields.js`. Gallery cards have inline `crmQuickCheckbox()` toggle for checkbox fields (no modal needed).
- [x] **CRM Phase 3 Feature A — Sort/Filter/Group toolbar (complete, in home-page-crm-toolbar.js)** — New module-level state: `_crmSortKey`, `_crmFilterField`, `_crmFilterValue`, `_crmGroupField`. `window.crmRenderToolbar` renders the toolbar UI. `window._crmProcessed()` implements the full pipeline (text search → field filter → sort → flat array); `_crmFiltered()` is a thin wrapper calling `_crmProcessed()`. `window._crmGroupValue(c, field)` extracts sort/group key including JSON-parse for multi_select. Setters: `crmSetSort`, `crmSetFilterField`, `crmSetFilterValue`, `crmSetGroup`, `crmClearFilters` all on `window`.
- [x] **Uploads Homespace page (Phase 3 complete)** — paginated merged file list (note attachments + standalone, 50/page), type filter tabs (Photos/Videos/Audio/Documents/Other), auth-gated download via `/home/uploads/{pid}/files/{src}/{id}/download`, standalone upload with demo guard. Phase 2 shipped (731c733): standalone file delete (page-src only; note-src shows "Open in Note" link), global filter counts (full-dataset MIME aggregation — **inline in `get_uploads_page()`, no separate `get_file_counts()` function**), slide-in detail panel (image preview, download, delete, note link, tags), custom tags (`page_upload_tags`, 4 endpoints, embedded in list via `GROUP_CONCAT`, group tag filter pills), WebP conversion on upload (Pillow≥10.0.0, graceful fallback), `_uplJsStr()` for JS-string onclick escaping. Phase 3: tags CRUD + `_uplFetchTextPreview` extracted to companion `home-page-uploads-tags.js` (loaded after main file); `_uplGrouped` state variable for grouped-by-MIME-type display mode; detail panel renders native `<video>` / `<audio>` / `<embed>` / text preview for non-image types; upload modal gains `#upl-webp-toggle` checkbox; `upload_file()` accepts `webp: bool = True` query param; `cookies.txt` added to `.gitignore` (security fix). Router: `routers/home_uploads.py`. DB: `page_uploads` + `page_upload_tags`. Helpers: `uploads_db.py`. JS: `home-page-uploads.js` + `home-page-uploads-tags.js`. Template: `home_page_uploads.html`.
- [x] **Document Studio — Uploads Phase 4 (complete 2026-04-14)** — in-panel file operations for eligible file types on Uploads homespace pages. New router: `routers/home_uploads_docs.py` (350 lines, prefix `/home/uploads`). New DB helpers: `routers/uploads_docs_db.py` (`update_page_upload_size`, `get_page_upload_owned_bulk`). New JS: `static/js/home-page-uploads-docs.js` (440 lines). New Python deps: `pypdf>=4.0.0`, `python-docx>=1.1.0`, `reportlab>=4.0.0`, `lxml==6.0.4` (transitive). Template changes: `#upl-combine-modal` + `#upl-sig-modal` added to `home_page_uploads.html`; `home-page-uploads-docs.js` script tag added to `base.html`. Endpoints: GET content (text or DOCX-as-HTML), PUT save edited text (1 MB guard), POST combine (PDF merge / text join, 2–20 files), POST convert (docx/txt→pdf, docx/pdf→txt), POST sign (drawn PNG signature stamp onto PDF). Eligibility matrix: note-src = read-only; page-src text/JSON = view/edit/→PDF; page-src PDF = sign/→TXT; page-src DOCX = view/→PDF/→TXT. Multi-select mode: ☐ Select button injected into filter bar → floating toolbar for Merge PDFs / Join Text. YAGNI (v1): no LibreOffice, no PKI signing, no PDF.js CDN, no rich DOCX editing, no version history, no collaborative editing. Commit: `06bb6d8`.
- [x] **Ghost Signature drag-to-place / B1 (complete 2026-04-15, commit `95ea1dd`)** — Users can drag-position a drawn signature ghost onto any PDF page before committing it. Ghost PNG follows the cursor, snaps into place on click, then `_uplSigConfirmGhost()` stamps it at the chosen coordinates. Ghost-state race fix shipped same commit (39cc0c2 follow-on): `_uplSigGhostActive` reset before early-return guard (see Quirk #23).
- [x] **Document Studio — Phase 7 / B2: Jspreadsheet CE in-browser spreadsheet editor (complete 2026-04-15, commit `95ea1dd`)** — XLSX and CSV files on Uploads pages gain a 📊 Edit Spreadsheet button. Fullscreen `#upl-spreadsheet-modal` (mirrors `#upl-wopi-modal` structure). Jspreadsheet CE + Jsuites + SheetJS all loaded lazily from CDN (pinned major versions). SheetJS handles XLSX↔JS-array round-tripping; Jspreadsheet CE renders the live editable grid. Save: `PUT /{pid}/files/page/{fid}/spreadsheet` (base64 body, ≤10 MB). New file: `static/js/home-page-uploads-spreadsheet.js` (all-var, loaded last in `base.html` after wopi.js). `base.html` load order: uploads-docs.js → uploads-sign.js → uploads-wopi.js → uploads-spreadsheet.js (last).
- [x] **PDF Annotations overlay (Phase 8 / B2)** — non-destructive, DB-overlay approach. `pdf_annotations` table stores percentage-based coordinates. PDF.js 3.11.174 renders to `<canvas>`; absolutely-positioned `<div>`s render on top. 3 annotation types: highlight (semi-transparent yellow band), sticky (editable yellow card), textbox (editable white box with blue border). Committed `86ed485` (2026-04-11).
- [x] **Document Studio — Phase 6: Collabora Online WOPI integration (complete 2026-04-15, commit `801ee6a`)** — BookWorm acts as a WOPI host so Collabora Online (`collabora/code` Docker service) can open DOCX, DOC, ODT, TXT, XLSX, CSV, and PPTX files in a full LibreOffice editor embedded in an `<iframe>`. PDF stays with the existing sign/annotate viewer — NOT WOPI-eligible. New files: `routers/wopi.py` (WOPI host router, prefix `/wopi`; CheckFileInfo / GetFile / PutFile / LOCK stub; stateless token auth via `itsdangerous.URLSafeTimedSerializer`, salt `wopi-token-v1`; discovery XML cached in `_discovery_cache`). `static/js/home-page-uploads-wopi.js` (WOPI modal JS: `_uplWopiOpen`, `_uplWopiClose`, `_uplWopiFrameLoaded`, `_uplWopiEnabled`, `_uplWopiPageId`, `_uplWopiBindPostMessage`; `_WOPI_MIMES` array must stay in sync with Python frozenset). New endpoint: `GET /home/uploads/{pid}/files/page/{fid}/wopi-token` in `home_uploads_docs.py`. New env vars: `BW_COLLABORA_URL`, `BW_WOPI_BASE_URL`, `BW_WOPI_TOKEN_EXPIRY` (all optional — feature disabled when empty). Auth middleware change: `/wopi/` prefix bypassed alongside `/static/` (prefix check, NOT `_PUBLIC`). Docker: `collabora` service added (`collabora/code:latest`; no host ports by default; `extra_params` sets SSL off + WOPI allowed hosts). `base.html` load order: `home-page-uploads-docs.js` → `hage-uploads-sign.js` → `home-page-uploads-wopi.js` (LAST — `_uplWopiEnabled` must exist before `_uplDocStudioInit` calls it). Known limitation (Phase 7): WOPI LOCK/UNLOCK not implemented — stub returns 200; acceptable for single-user editing.
- [x] **Page Trash feature shipped (commit `cbf98d7`).** Soft-delete home pages with 30-day retention, drag-to-trash sidebar drop zone, and trash modal with Restore + Empty Trash actions. DB: `home_pages.deleted_at DATETIME DEFAULT NULL` (additive migration). `delete_home_page()` changed from hard-delete to `UPDATE SET deleted_at=datetime('now')`. New helpers in `routers/home_db.py`: `restore_home_page`, `get_trashed_home_pages`, `empty_home_page_trash`, `purge_expired_home_pages` (called at startup, hard-deletes >30-day-old trash across all users). New routes: `GET /home/pages/trash`, `POST /home/pages/trash/empty`, `POST /home/pages/{id}/restore` (returns `X-Restored-Page-Id` header). Private helper `_sidebar_ctx(uid, active_page_id=None)` returns `{pages, hp_trash_count}` — shared by all 5 sidebar-returning routes (DRY). JS in `home-widgets.js`: `_pgDragStart`, `_trashDragOver`, `_trashDragLeave`, `_trashDrop`, `openHpTrashModal`, `closeHpTrashModal`, `_restoreHpPage`, `_emptyHpTrash`.
- [x] **Subscriptions Homespace page — Phase 1 (commit `177a335`, 2026-04-22).** New page type for tracking recurring costs (Wallos-inspired). Two-panel layout: subscription list with filter/sort on the left, analytics (summary cards + Chart.js donut + bar chart + upcoming renewals) on the right. Full CRUD via 5 new JSON endpoints. New DB table: `subscriptions` (12 columns, 2 indexes). `PAGE_TYPES` frozenset in `home_db.py` updated. `_initSwappedPage()` in `home-widgets.js` now dispatches `subs-page-root` → `initSubsPage(pid)`. Chart.js 4.4.4 bundled locally in `static/js/vendor/chart.umd.min.js` (no CDN dependency); loaded lazily on subscriptions pages only. Inactive subscriptions excluded from all analytics totals. New files: `routers/home_subscriptions.py`, `routers/home_subscriptions_db.py`, `templates/partials/home_page_subscriptions.html`, `static/js/home-page-subscriptions.js`, `static/js/vendor/chart.umd.min.js`.

---

## 🚀 Phase 7 / B1+B2 Complete (2026-04-15)

Last commits: **`95ea1dd`** — Ghost Signature drag-to-place (B1) + Jspreadsheet CE editor (B2) | **`39cc0c2`** — fix: ghost-state race in `_uplSigConfirmGhost`

**Document Studio Phase 6 (Feature A) also shipped this session:**

- `routers/wopi.py` (new) — WOPI host router, prefix `/wopi`; CheckFileInfo / GetFile / PutFile / LOCK stub; `itsdangerous` token auth (salt `wopi-token-v1`); discovery XML in `_discovery_cache`; exports `issue_token()`, `get_editor_url()`, `WOPI_MIMES`, `_COLLABORA_URL`, `_WOPI_BASE_URL`
- `static/js/home-page-uploads-wopi.js` (new) — WOPI modal JS; `_WOPI_MIMES` array must stay in sync with Python frozenset
- `routers/home_uploads_docs.py` — added `GET /{pid}/files/page/{fid}/wopi-token` endpoint
- `auth_middleware.py` — `/wopi/` prefix now bypassed alongside `/static/` (prefix check, NOT `_PUBLIC`)
- `docker-compose.yml` — `collabora` service added (`collabora/code:latest`; internal only by default)
- `.env.example` / `docker-compose.yml` — three new `BW_*` env vars: `BW_COLLABORA_URL`, `BW_WOPI_BASE_URL`, `BW_WOPI_TOKEN_EXPIRY`
- WOPI-eligible MIME types: DOCX, DOC, ODT, TXT, XLSX, CSV, PPTX. PDF is **NOT** eligible — stays with sign/annotate viewer.
- Known limitation: WOPI LOCK/UNLOCK stub — always 200; fine for single-user editing

**Document Studio Phase 7 / B1+B2 shipped this session:**

- `static/js/home-page-uploads-sign.js` — Ghost Signature drag-to-place; `_uplSigGhostActive` reset-before-guard fix (Quirk #23)
- `static/js/home-page-uploads-spreadsheet.js` (new) — all-var lazy CDN loader for Jsuites + Jspreadsheet CE + SheetJS; key fns: `_uplSsOpen`, `_uplSsRender`, `_uplSsClose`, `_uplSsSave`, `_uplSsInstance`
- `routers/home_uploads_docs.py` — `PUT /{pid}/files/page/{fid}/spreadsheet` + `SpreadsheetBody` model
- `templates/partials/home_page_uploads.html` — `#upl-spreadsheet-modal` block
- `base.html` load order: `uploads-docs.js` → `uploads-sign.js` → `uploads-wopi.js` → `uploads-spreadsheet.js` (last)

**Current status:** App healthy. Phase 6 Feature A + Phase 7 B1+B2 all working. Tailwind CDN debt resolved (2026-04-22). CODEPUPPY_NOTES in sync.

---

## 🚀 2026-04-22 Session — Subscriptions Phase 1

| Date | Change |
|---|---|
| 2026-04-22 | **Sidebar workspace drag-handle click → options menu (commit `05f57f1`).** The `⠿` drag handle in the workspace sidebar tree now serves dual purpose: **hold+drag** = nest/reorder/trash (unchanged); **click** = opens the existing `_wsRowMenuOpen` context menu (Add sub-ws, Add database, Duplicate, Rename, Delete, Visibility). Implementation: 4 state/code changes in `index.html` DnD engine (`_handleEl` state var, capture at mousedown, save before cancel(), menu in click path of mouseup) + 4 new `data-dnd-ws-*` attributes on the `<span>` in `sidebar_workspace_list.html` (`name`, `emoji`, `parent`, `type`) + `role="button"`, `aria-haspopup="menu"`, clearer title. Synthetic event `{currentTarget: hEl, stopPropagation: noop}` passed to `_wsRowMenuOpen` for correct dropdown positioning. |
| 2026-04-22 | **Block-grip DnD handles + click-for-menu in DB card notes + workspace note editor (commit `7eebe64`).** New file `static/js/bw-block-menu.js` (all `var`) exposes `window._bwBlockMenu(gripEl, blockEl, opts)`. DB card note area: fresh `_dbInjectGrips` DnD engine in `workspace-database.js` (9 state vars + 7 functions); grips tagged `data-db-grip`+`data-db-transient` (auto-stripped by `_dbNoteHtml`); gutter padding on note div (`padding-left:1.6rem;margin-left:-1.6rem`). Workspace note editor: `_gripEl` state + click path added to `initPreviewDnD._onMouseUp` in `note_form.html`. Menu items: **Turn into** (10 block types, ✓ marks current type), **Color** (custom palette — 9 text + 9 highlight swatches), **Duplicate**, **Delete**. Script tag added to `base.html` with `?v={{ static_v }}`. |
| 2026-04-22 | **Subscriptions Homespace page — Phase 1 (commit `177a335`).**** New page type for tracking recurring costs, inspired by Wallos. Two-panel layout: subscription list with filter/sort on the left, analytics panel on the right. Full CRUD via 5 new JSON endpoints under `/home/subscriptions/{page_id}/…`. New DB table `subscriptions` (12 columns + 2 indexes; `cycle` codes: 1=daily, 2=weekly, 3=monthly, 4=yearly; `active=0` rows excluded from all analytics). `PAGE_TYPES` frozenset updated in `routers/home_db.py`. `_initSwappedPage()` in `home-widgets.js` gains a `subs-page-root` dispatch block (after CRM, before Grid fallback). Chart.js 4.4.4 bundled locally as `static/js/vendor/chart.umd.min.js` (≈200 KB); loaded lazily by `_subsLoadCharts()` — not in `base.html`. New files: `routers/home_subscriptions.py` (5 endpoints, `_get_subs_page()` ownership guard), `routers/home_subscriptions_db.py` (key fns: `get_price_per_month`, `get_subscription_progress`, `get_summary_data`), `templates/partials/home_page_subscriptions.html` (root `#subs-page-root[data-page-id]`), `static/js/home-page-subscriptions.js` (entry `initSubsPage(pid)`, all `var`). |

---

## 🚀 2026-04-22 Session — Tailwind CDN Debt Resolved

| Date | Change |
|---|---|
| 2026-04-22 | **Tailwind CDN → local bundled CSS (commit `28e14a9`).** Resolved longstanding tech debt. Downloaded Tailwind CLI v3.4.17 standalone binary (no npm/Node required). Created `tailwind.config.js` mirroring the inline `tailwind.config = {...}` blocks previously in templates (custom colors: `wblue`, `wspark`, `wred`, `wgreen`; `darkMode: 'class'`). Content paths scan `templates/**/*.html` + `static/js/**/*.js` — JS files build full HTML string literals with embedded Tailwind classes, all captured by static scan. Dynamic colors (RSS feeds, CRM stages) use inline `style=` attributes, not Tailwind classes — no purge risk. Generated `static/css/tailwind.css` (75,937 bytes minified). Replaced `<script src="https://cdn.tailwindcss.com">` with `<link rel="stylesheet" href="/static/css/tailwind.css?v={{ static_v }}">` in all 5 templates: `base.html`, `login.html`, `register.html`, `setup.html`, `2fa_verify.html`. Removed now-unnecessary inline `tailwind.config = {...}` script blocks from `base.html` and `setup.html`. Added `rebuild_css.bat` (run after adding new Tailwind classes; uses Walmart Artifactory proxy URL for binary download). `tailwindcss.exe` added to `.gitignore` + `.dockerignore`. `static/css/tailwind.css` committed to git — Docker build copies it automatically. QA: 100% green, all templates pass, CSS served as `text/css`, zero CDN references remain. |

---

## 🐾 Code Puppy Skills (BookWorm-specific)

Skills live at `C:\Users\t0n003c\.claude\skills\` — **user-global, not in the BookWorm project folder**.
They are available from any project but won't auto-trigger on non-BookWorm work (BookWorm-prefixed names + scoped descriptions keep them isolated).

| Skill | When to use |
|---|---|
| `bookworm-widget-scaffolder` | Adding a new home widget type. Touches all 9 required files in order. |
| `bookworm-pre-commit` | Before any git commit or PR. Runs 10-phase BookWorm-specific safety checklist. |
| `bookworm-db-migration` | Adding/changing tables or columns in `bookworm.db`. Generates idempotent SQL + dry-run. |
| `bookworm-template-audit` | After adding templates or JS. Catches HTMX/Jinja2 bugs specific to this codebase. |

**Invoke with**: `activate_skill('bookworm-widget-scaffolder')` etc., or just ask Eddie to scaffold a widget / run pre-commit checks.

---

## 🤖 Code Puppy Agents (BookWorm-specific)

Agents live at `C:\Users\t0n003c\.code_puppy\agents\` — **user-global, not in the BookWorm project folder**.
All have `bookworm-` prefix so they won't auto-trigger on other projects.

### Orchestrator

| Agent | Role |
|---|---|
| `bookworm-dev` 🎼 | Single entry point for ALL BookWorm tasks. Routes to the right agent or skill, chains/parallelizes them, falls back to Eddie if out of scope. |

### Specialist Agents

| Agent | When to use |
|---|---|
| `bookworm-feature-planner` 📋 | Before writing any code. Reads codebase → produces PLAN.md with files to touch, DB migrations, gotchas flagged. |
| `bookworm-qa` 🧪 | After changes or before committing. Hits real endpoints, scans error logs, runs `_health_check.py`. Reports 🟢/🟡/🔴 status. |
| `bookworm-perf-detective` 🔍 | When something feels slow. Hunts N+1 queries, missing indexes, aggressive HTMX polling, expensive template loops. |
| `bookworm-docs-keeper` 📝 | Anytime. Compares CODEPUPPY_NOTES.md against live code and auto-updates stale sections (schema, filters, widgets, routes). |

### How They Chain

```
"ready to commit"     → pre-commit skill + docs-keeper agent (parallel)
"full health check"   → bookworm-qa + bookworm-perf-detective (parallel)
"add a new widget"    → widget-scaffolder skill → template-audit skill
"plan a new feature"  → feature-planner agent → lists skills needed
```

### Fallback Rule
bookworm-dev always hands back to Eddie if the request isn't BookWorm-related or no specialist matches.
Eddie is always the outermost layer — agents supplement, not replace.

---

## 🐛 Known Quirks & Gotchas

1. **`home.py` ≠ `routers/home.py`** — there's no root-level `home.py`; always use `routers/home.py`.
2. **Git not in PATH** on this machine. Git binary not found in standard locations. Use `restart.bat` for server management. Track changes by file `LastWriteTime` if needed.
3. **Inline Python `-c` scripts** don't flush stdout reliably in Windows cmd — use a `.py` file instead.
4. **Template filter test trap:** Testing Jinja2 templates with a vanilla `jinja2.Environment()` will always fail for BookWorm's custom filters. Always import from `templates_env` to get the properly configured environment.
5. **`note_form.html` is ~165 KB** — avoid reading the whole thing at once; use `start_line`/`num_lines`.
6. **`home_page.html` is ~117 KB** — same deal.
7. **HTMX OOB swaps** — if a partial response needs to update the sidebar, it must return OOB fragments with correct IDs.
8. **Port conflict** — Teams uses 8080. Never kill that. BookWorm is on 8000 (local dev via `restart.bat`) or 8001 (Docker). **Confirmed 2026-04-10: server is currently running via `python main.py` on port 8001.** `restart.bat` targets port 8000 via uvicorn directly — these two startup paths are mismatched. The `python main.py` path uses `uvicorn.run(..., reload=True)` so file changes auto-reload, but the DB migration only runs on cold startup. **Workaround:** When a new DB migration is needed that the reload didn't pick up, run `_migrate_once.py` directly against `bookworm.db` using `.venv\Scripts\python.exe`. The running process holds a read lock but SQLite allows `ALTER TABLE` from a second connection as long as no write transaction is active.
9. **`netstat` may show ghost PIDs on port 8001** — PID entries are real but invisible to `Get-Process`/`wmic`/`Get-CimInstance`. These are likely Windows port-forwarding entries from Docker/WSL2 NAT. The actual Python server process is not killable via normal Windows process tools when started this way. To restart: use the uvicorn file-watcher (`reload=True`) for Python changes; touch static JS files to bump their mtime for cache-busting.
10. **`_hpCache` client-side cache (5-min TTL)** — `home-widgets.js` caches each `/home/pages/{id}` response in a JS `Map`. After any server-side change to a page's *type, layout, or template* (not widget data), the browser still serves the stale HTML until either: (a) `Ctrl+Shift+R` hard refresh (nukes JS memory entirely), or (b) 5 minutes elapse and the stale-while-revalidate kicks in. `invalidateHomePageCache(pageId)` only helps if called from JS in the same tab. **Rule: always hard-refresh after fixing page_type values in the DB or changing the page's template routing.**
11. **Uploads** — `UPLOAD_DIR` is set in `routers/attachments_db.py`, not a top-level constant. Files go next to the DB.
12. **Session invalidation on restart** — in dev (no `BW_SECRET_KEY` env var), the secret key is randomly generated each start, invalidating all sessions. Normal and expected.
13. **HTMX re-injection `let`/`const` trap** — any `<script>` block inside a partial template (e.g. `note_form.html`) gets re-executed by HTMX every time the partial is swapped in. Top-level `let`/`const` declarations will throw `SyntaxError: already declared` on the second injection. **Rule: use `var` for any state variables declared at the top level of partial `<script>` blocks.** Variables inside function bodies or IIFEs are fine as-is.
14. **`restart.bat` is safe for both Eddie and humans.** The `pause` that used to block non-interactive runs has been removed. It now calls `_start_server.py` (which fully detaches uvicorn via `STARTUPINFO.SW_HIDE` + `CREATE_NEW_PROCESS_GROUP`) and then polls `/health` with `timeout=2` for up to 30 s before exiting. **Eddie MUST always use `cmd /c restart.bat` to start or restart the server — never manually chain `start /MIN uvicorn && ping && urlopen`.** `cmd /c restart.bat` blocks for at most ~30 s then cleanly exits — well within the 60 s shell-tool timeout. See also Quirk #15 (why `start /B` freezes) and Quirk #19 (why `urlopen` without timeout freezes).
15. **`start /B` in `cmd.exe` freezes the shell tool.** `start /B someprocess` looks like a background launch but the child inherits the parent cmd's stdout/stderr handles. The Code Puppy shell tool captures those handles and waits for them to close before returning — uvicorn never closes them (it runs forever), so the tool hangs indefinitely. The server actually starts fine; the tool just never gets its exit signal. **Rule: NEVER use `start /B` or `cmd /c "start /B ..."` to launch uvicorn. Always use PowerShell `Start-Process` with explicit `-RedirectStandardOutput`/`-RedirectStandardError` to separate log files:**
    ```powershell
    Start-Process -FilePath '.venv\Scripts\uvicorn.exe' `
      -ArgumentList 'main:app','--host','127.0.0.1','--port','8000' `
      -NoNewWindow `
      -RedirectStandardOutput 'bookworm.log' `
      -RedirectStandardError  'bookworm_err.log'
    ```
    This fully detaches uvicorn's handles from the tool's capture pipe.
16. **`| tojson` inside `<script>` tags MUST have `| safe`** — Jinja2 autoescape is enabled globally. The custom `_tojson` filter returns a plain Python string, so without `| safe`, every `"` in the JSON gets HTML-escaped to `&quot;` in the rendered source. Browsers treat `<script>` body as raw text (no HTML entity decoding), so `JSON.parse()` will silently fail and return `[]`. **Rule: always write `{{ data | tojson | safe }}` for `<script type="application/json">` blocks. For HTML attributes use `{{ data | tojson | e }}` (the `| e` HTML-escapes for safe attribute embedding).**
17. **`_build_widget_sources()` in `routers/home.py` is an N+1 query pattern** — it loops over distinct `source_widget_id` values from the feed list and issues one `get_widget_by_id` + `get_home_page_by_id` call per unique widget. At typical RSS reader feed counts (≤20 feeds, ≤5 unique widgets) this is acceptable. If a user accumulates many widgets with large feed sets this will degrade. Tracked as tech debt. Do not copy this pattern to new code — prefer a JOIN or a single IN-clause query instead.
18. **StaticFiles `/uploads/<uuid>` mount is unguarded** — anyone with the UUID filename can download the file directly without a session. Auth-gated download via `/home/uploads/{pid}/files/{src}/{id}/download` exists for the Uploads page UI, but the raw `StaticFiles` mount remains open. Tracked as Phase 2 hardening. Do not serve sensitive attachments without noting this risk.
19. **`urllib.request.urlopen` with no timeout freezes the shell tool indefinitely.** If the server isn't ready (slow OneDrive path startup, port conflict, crash), `urlopen` blocks forever — no exception, no timeout, just silence. Code Puppy's shell runner waits for the subprocess to exit, which never happens. **Rule: NEVER call `urlopen` without `timeout=N`. NEVER chain a server-start command with an inline `urlopen` health check in a single shell command.** Always: (1) start the server, (2) wait, (3) run `_health_check.py` as a completely separate shell call. The `_health_check.py` script already uses `timeout=5` on all its HTTP calls — use it exclusively.
    ```
    # ✅ CORRECT — two separate steps
    powershell -Command "...Start-Process uvicorn..."   ← step 1: start
    Start-Sleep 5                                        ← step 2: wait
    .venv\Scripts\python.exe _health_check.py           ← step 3: verify

    # ❌ WRONG — chained in one command, urlopen has no timeout = freeze
    start "bw8000" /MIN uvicorn... && ping -n 5 ... && python -c "urlopen('...').read()"
    ```
26. **☠️ Killing ALL `python.exe` processes KILLS CODE PUPPY ITSELF.** Code Puppy runs as a Python process. Any command that mass-kills every process named `python` or `python.exe` is a self-destruct command — Eddie's own session dies immediately. **This has happened TWICE across two separate sessions.** Both the PowerShell and CMD (`taskkill`) variants are equally fatal. ABSOLUTELY FORBIDDEN.
    - **Rule: NEVER mass-kill `python` / `python.exe` by name — PowerShell OR CMD.**
    - To stop the BookWorm server: use `restart.bat` (handles stop internally), kill by **port**, or kill by **specific PID only**.
    - **✅ Safe — kill only what's on a specific port (surgical):**
    ```powershell
    # Kill whatever is listening on port 8000 (BookWorm dev server)
    $p = (netstat -ano | Select-String ':8000 ') | ForEach-Object { ($_.ToString().Trim() -split '\s+')[-1] } | Select-Object -First 1
    if ($p) { Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue }
    ```
    - **✅ Safe — kill uvicorn specifically (not all of python):**
    ```powershell
    Get-Process -Name uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force
    ```
    ```bat
    taskkill /F /IM uvicorn.exe /T 2>nul
    ```
    - **❌ FORBIDDEN — kills Code Puppy, ends the session immediately (PowerShell variant):**
    ```powershell
    Get-Process -Name python | Stop-Process -Force   # ← SELF-DESTRUCT. DO NOT EVER RUN.
    ```
    - **❌ FORBIDDEN — kills Code Puppy, ends the session immediately (CMD/taskkill variant — the one that killed session #2):**
    ```bat
    taskkill /F /IM python.exe /T   # ← SELF-DESTRUCT. DO NOT EVER RUN.
    taskkill /F /IM python.exe /T 2>nul & taskkill /F /IM uvicorn.exe /T 2>nul   # ← ALSO FORBIDDEN — first half kills Code Puppy
    ```
    - **The only safe process name to taskkill by name is `uvicorn.exe` — never `python.exe`.**
20. **`_uplJsStr(s)` in `home-page-uploads.js` — JS-string onclick escaping.** Backslash-escapes `\` and `'` so a value can be safely embedded inside a single-quoted JS string literal inside an `onclick` attribute (e.g. `onclick="fn('${_uplJsStr(name)}')"`). Use this instead of `_uplEsc` when the value goes into a JS string context (not an HTML attribute context). `_uplEsc` HTML-encodes for HTML attribute safety; `_uplJsStr` JS-escapes for JS string-literal safety. Mixing them causes either broken JS or XSS.
21. **WOPI LOCK/UNLOCK not implemented (Phase 7 TODO).** `routers/wopi.py` handles `POST /wopi/files/{file_id}` (the LOCK action) with a stub that returns HTTP 200. Collabora sends lock requests for collaborative multi-user editing — not a scenario we support. Single-user editing works fine without real locking. Do NOT implement a real LOCK table until Phase 7; adding one now would add DB state (lock tokens, expiry) with no corresponding unlock cleanup path.
22. **`_WOPI_MIMES` JS array in `home-page-uploads-wopi.js` must stay in sync with `WOPI_MIMES` frozenset in `routers/wopi.py`.** These two lists are intentionally separate (server = frozenset, client = array for fast `.includes()` checks) but must contain identical MIME types. If you add a new WOPI-eligible type, update both. Current set: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), `application/msword` (DOC), `application/vnd.oasis.opendocument.text` (ODT), `text/plain` (TXT), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX), `text/csv` (CSV), `application/vnd.openxmlformats-officedocument.presentationml.presentation` (PPTX). PDF is explicitly excluded.
23. **Ghost Signature `_uplSigGhostActive` MUST be reset BEFORE the early-return guard in `_uplSigConfirmGhost()`** (`home-page-uploads-sign.js`, commit `39cc0c2`). The function places a ghost PNG onto the PDF canvas. If the DOM race fires between the ghost being activated and `_uplSigConfirmGhost` executing, `ghost` or `wrap` may be null — the function must bail early. However, if `_uplSigGhostActive` is still `true` at that point, the entire ghost-signature state is soft-locked for the session: the user can no longer trigger ghost placement because the guard at the top of `_uplSigStartGhost()` sees `_uplSigGhostActive == true` and returns immediately. **Rule: always reset `_uplSigGhostActive = false` on the very first line of `_uplSigConfirmGhost()`, before ANY `if (!ghost || !wrap) return` check.**
24. **PDF.js CDN URLs — worker version MUST match main script version exactly** (`home-page-uploads-annot.js`, Phase 8). Current pinned version: **3.11.174**.
    - Main script: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js`
    - Worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`
    - If the worker URL is on a different version than the main script, `getDocument()` silently hangs — no error thrown, no timeout, spinner never resolves. Always update **both** URLs together when upgrading PDF.js. (G3 in `home-page-uploads-annot.js` guards this with an inline comment.)
25. **`GET /home/pages` is a shared dependency for two pickers in `routers/home.py`** (commit `92b68bc`). Both the add-widget modal's **CRM pages** `<select>` field (`select-crm-pages`) AND the **upload-preview file picker** call `GET /home/pages` to populate their page-selector dropdowns. If this endpoint is ever removed, renamed, or placed **after** `/pages/{page_id}` in the router, both pickers silently break with an empty dropdown — no JS error, just nothing to select. Rule: keep `list_pages_json` as the first route under the `/pages` prefix in `routers/home.py`.
26. **`_fetch_raw(send_rss_accept=True)` MUST be `False` when following autodiscovered YouTube feed URLs.** The initial fetch of a YouTube channel page uses `send_rss_accept=True` (adds `Accept: application/rss+xml…` to help generic sites serve the feed directly). However, if you then call `_fetch_raw(feed_url, True)` on the *discovered* `feeds/videos.xml` URL, YouTube returns HTTP 500 (not 404) when that Accept header is present — the server interprets it as an API call and fails. The fix is `_fetch_raw(feed_url, False)` for any URL returned by `_autodiscover_feed_url()`. This is already wired correctly in `rss_proxy()` (`partial(_fetch_raw, feed_url, False)`) — do NOT change it to `True` when refactoring this code path. Same applies to the `/videos` tab fallback fetch.
27. **A stray `}` in an inline `<script>` block silently kills every function in that block — and `typeof` guards make it harder to notice.** A single extra closing brace anywhere in a large `<script>` causes a `SyntaxError` that prevents the browser from registering **every** function in that block. The symptom is buttons that do nothing silently — no console error. The problem is made worse when `typeof fn==='function'&&fn()` onclick guards are used: the guard catches the undefined-function case and short-circuits, swallowing all evidence of the crash. Root case: commit `9971f5f` accidentally left a duplicate `}` after `wsDoubleClick()`, nuking all 78 functions in the 1 700-line main `<script>` block. Fixed in commit `656ebf3` (1-line deletion). **Rule: after editing any inline `<script>` block in `index.html`, run the brace-balance checker:**
    ```
    .venv\Scripts\python.exe _check_js3.py
    # All three must read net: +0
    #   {} net: +0  ✅
    #   [] net:  +0  ✅
    #   () net:  +0  ✅
    ```
    `_check_js3.py` strips Jinja2 `{{ }}` / `{% %}`, then block comments, line comments, template literals, double-quoted strings, and single-quoted strings (all with `re.DOTALL`) before counting bracket balance. A `net: -1` on `{}` means a real syntax error — do NOT paper over it with more `typeof` guards; find and delete the stray brace.

---

## 🧪 How to Test / Health Check

```bash
# Full health check (templates + filters + live routes)
.venv\Scripts\python.exe _health_check.py

# Syntax check all Python files
.venv\Scripts\python.exe -m py_compile main.py routers/home.py routers/notes.py ...

# Tail the server log
type bookworm.log

# Hit the live server
powershell -Command "Invoke-WebRequest -Uri 'http://localhost:8000/login' -UseBasicParsing | Select-Object StatusCode"
```

---

## 🚀 How to Start the Server

```bat
# THE ONLY RIGHT WAY — for both Eddie and humans.
# Kills old uvicorn, starts fresh, polls /health (timeout=2 per attempt, max 30 s).
# Blocks ~5-30 s then cleanly exits. Well inside Eddie's 60 s shell-tool timeout.
cmd /c restart.bat
```

> ⚠️ **NEVER use any other pattern.** These all freeze Eddie's shell tool or leave stale processes:
> - `start /MIN uvicorn... && ping... && urlopen(url)` — no timeout on urlopen = hangs forever (Quirk #19)
> - `cmd /c "start /B uvicorn..."` — inherited stdout/stderr handles freeze the tool (Quirk #15)
> - `powershell ... Start-Process uvicorn ...` — only needed if `restart.bat` itself is broken; diagnose that first

**Emergency fallback** (only if `restart.bat` fails for some reason):
```powershell
# Step 1: kill + start (separate shell call — do NOT chain with Step 2)
powershell -Command "Get-Process uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2; Start-Process -FilePath '.venv\\Scripts\\uvicorn.exe' -ArgumentList 'main:app','--host','127.0.0.1','--port','8000' -NoNewWindow -RedirectStandardOutput 'bookworm.log' -RedirectStandardError 'bookworm_err.log'"

# Step 2: verify (separate shell call — never in the same && chain as Step 1)
.venv\Scripts\python.exe _health_check.py
```

> ⚠️ NEVER chain server start + health check in one `&&` command. In particular, NEVER use `start /MIN .venv\Scripts\uvicorn.exe ... && ping ... && urlopen(url)` with no timeout — if the server is slow (OneDrive I/O, cold disk), `urlopen` blocks forever (see Quirk #19).

Verify it started:
```powershell
# Wait for startup, then run the proper health check script
powershell -Command "Start-Sleep 5"
.venv\Scripts\python.exe _health_check.py
```

---

## 📝 Eddie's Session Log

| Date | What happened |
|---|---|
| 2026-05-25 | **Push notification full audit — 4 bugs fixed + root cause identified (commits `ccac6c5`, `7b081d3`, `4911dae`).** User reported CRM push notifications not working. Actual root cause: user never re-enabled the 🔔 bell after reinstalling the PWA (push subscription is silently wiped on reinstall). During investigation a full audit of all 5 background push loops was performed and 4 real bugs were found and fixed. **(1) CRM loop `else` → `elif result` (`ccac6c5`):** `_widget_notif_loop` CRM section used bare `else:` — a transient push failure (False) was treated as success and added to `sent_keys`, blocking retries next tick. Changed to `elif result:`. **(2) CRM client–server race condition (`7b081d3`):** Client-side 30 s poll (`_checkCrmReminders`) deleted or advanced reminders from the DB immediately after showing a toast, before the 60 s server push loop could find them. Fix: `home-page-crm-reminders.js` now checks `bw-push-btn[data-active='1']`; when push is subscribed the client skips all DB cleanup — the server loop owns advance/delete; client-only cleanup is the fallback when push is off. **(3) `date_str` NameError in `_widget_notif_loop` (`4911dae`):** A debug log line I added referenced `date_str` which was never defined in that scope. This caused a `NameError` every 60 seconds crashing the loop body from the CRM section onward — both CRM push AND Home Reminder widget push were silently dead every cycle. Fixed by defining `date_str = today.isoformat()` at the top of the loop body. Also removed per-row verbose CRM logging; kept only a summary line. **(4) Bud loops `else` → `elif result` (`4911dae`):** `_bud_notif_loop` contact-reminder AND visit-reminder sub-loops both used bare `else:` — transient push failures marked bud/plan IDs as sent, preventing retries. Both changed to `elif result:`. **(5) Bud contact query `=` → `<=` (`4911dae`):** `get_due_bud_contact_reminders()` matched on `contact_reminder_time = ?` (exact minute). `asyncio.sleep` drift could cause the loop to wake at 09:01 and permanently miss a 09:00 reminder. Changed to `<=`; the `contact_reminder_last_sent != today` dedup prevents double-firing. **Systems confirmed clean after audit:** note reminders (`_reminder_push_loop`), RSS (`_rss_notif_loop`), and all widget loop types — countdown/events/subscriptions/trip/home-reminder all already used `elif result:`. |
| 2026-05-25 | **Android push notification badge fixed + PWA platform analysis (commit `4db3d88`).** **(1) Badge icon fix:** Root cause: Android's status-bar badge ignores colour — it converts any non-transparent pixel to white (stencil model). `icon-192.png` has a solid green background (every pixel opaque) → Android rendered a solid white square. Fix: added `_make_badge(size=96)` to `bw_pwa_icons.py` — draws a white worm silhouette (head circle, body circle, two antennae with tip balls) on a fully transparent RGBA background; saved as `static/img/icons/badge-96.png`. Updated `generate_icons()` to produce 5 files (was 4); badge is NOT flattened to RGB — transparency must be preserved. Updated all 12 `badge` payload fields across `main.py` (11 sites), `routers/push.py` (1 site), and `static/js/sw.js` (fallback default) to use `badge-96.png`. The `icon` field (large notification image) continues to use `icon-192.png` — only the status-bar badge needed the monochrome treatment. **(2) PWA platform analysis (documentation only, no code change):** Documented Windows vs Mac install behaviour — Windows Chrome/Edge = Mac Chrome/Edge (identical; `beforeinstallprompt` fires on both). Mac Safari desktop: `_isIos()` correctly returns `false`, but Safari never fires `beforeinstallprompt` either — users had no banner. This gap was already closed by `_isSafariDesktop()` + `#bw-pwa-safari` panel (shipped 2026-05-25 earlier session). `navigator.standalone` is iOS-only; `_isInstalled()` relies on `display-mode: standalone` media query which works correctly on all platforms once installed. |
|---|---|
| 2026-05-25 | **PWA improvements — manifest shortcuts, Mac Safari install banner, offline dark mode fix (commit `a6317cb`).** Three PWA gaps closed. **(1) Manifest shortcuts:** `pwa_manifest()` in `main.py` now includes a `shortcuts` array with two entries — `New Note` (`/#bw=new-note`) and `My Files` (`/#bw=uploads`). URLs use hash fragments so they survive the server's `/?ws=N` redirect (browsers never send hashes to the server). A new shortcut action IIFE in `base.html` reads `#bw=<action>` from `window.location.hash`, strips it via `history.replaceState`, then polls every 250ms (max 10s) until the app is ready: `new-note` clicks `#btn-new-note` (waits for 'New' label = workspace active, not HomeSpace); `uploads` finds `[data-page-type=uploads]` in the sidebar and calls `openHomePage(id)`. **(2) Mac Safari install banner:** `_isSafariDesktop()` added — detects Safari UA without Chrome/Chromium/Edg/OPR/Firefox and without `_isIos()`. New `#bw-pwa-safari` HTML panel displays "File → Add to Dock (macOS Sonoma 14+)" instructions. `_showBanner()` updated to handle `'safari'` mode. `_initInstallBanner()` fires the safari banner after 4s on Mac Safari. `bw-pwa-safari-dismiss` added to the dismiss buttons array. **(3) Offline dark mode:** `offline.html` now has an inline `<script>` before paint that reads `localStorage.getItem('bw-theme')` and adds `html.dark` to `<html>` when set to `'dark'` — same pattern as `base.html`. CSS updated with `html.dark` rules alongside `@media(prefers-color-scheme:dark)` so users who manually set dark mode see a dark offline page instead of blinding white. |
| 2026-05-25 | **Uploads detail panel — view-mode-aware positioning + SyntaxError brace fix (commit `da8bbc5`).** Two related changes shipped together. **(1) View-mode-aware detail panel:** `_uplShowDetailPanel()` added — reads `localStorage.getItem('bw-view-mode')` and applies one of three positioning modes: `panel` (default) = fixed right side panel, 22rem wide, z-index:40, with a transparent `#_upl-detail-backdrop` div below it (z:39) that catches click-outside and calls `_uplCloseDetail()`; `center` = floating card centered via `translate(-50%,-50%)`, max 36rem wide, 90vh tall, blurred opaque backdrop (z:38); `fullscreen` = `inset:0` covering the entire viewport. `_uplRemoveDetailBackdrop()` helper removes `#_upl-detail-backdrop` on close. `_uplCloseDetail()` rewritten to call `_uplRemoveDetailBackdrop()` and use `.classList.add('hidden')` instead of `translate-x-full` — panel is fully detached from layout when closed. ESC handler in `initUploadsPage` now also calls `_uplCloseDetail()` when `_uplCurrentDetail` is set. Detail-content div layout changed to `flex:1; min-height:0` so the panel header stays pinned and content area scrolls independently in all three modes. Template: `#uploads-detail-panel` simplified from hardcoded `fixed inset-y-0 right-0 w-80 translate-x-full transition-transform` to just `hidden bg-white dark:bg-zinc-900` — JS drives all positioning. `#uploads-detail-content` no longer hard-codes `height:calc(100% - 3rem)`. **(2) SyntaxError fix:** Stray `}` immediately after `_uplShowDetailPanel()` closing brace caused `Uncaught SyntaxError: Unexpected token '}'` at line 505, preventing the entire JS file from parsing. Removed via 1-line deletion. Health check: 17 templates ✅ / 6 filters ✅ / 3 routes ✅. **Also: pushed 18 previously-local commits to GitHub** (`f0f6067..da8bbc5` on `main`). |
| 2026-05-13 | **Uploads page — `db-attr-files/` image previews returning 404 fixed (commit `9bddf42`).** Root cause discovered via DB audit: files uploaded as database card attribute files are stored on disk under `UPLOAD_DIR/db-attr-files/{uuid}.ext` and registered in `page_uploads` with `filename = "db-attr-files/{stored_name}"` (a two-segment relative path). The browser requests `/uploads/db-attr-files/{uuid}.png` — two path segments after `/uploads/` — but the old route was `@app.get("/uploads/{filename}")` whose bare `{filename}` parameter only captures a single path segment (no slashes). FastAPI never matched those URLs, silently falling through to a 404, which triggered the `onerror` handler and showed the emoji fallback instead of the actual image. Only 2 rows in the DB were affected (both `db-attr-files/` prefix), confirmed by querying `SELECT filename FROM page_uploads WHERE instr(filename,'/')>0`. **Fix:** changed the route decorator to `"/uploads/{filename:path}"` — the `:path` modifier tells FastAPI/Starlette to capture the full remainder of the URL including slashes. Security check updated: instead of blocking all `/` characters (which would break nested paths), the check now blocks `..` anywhere in the path, any leading `/` or `\`, and any backslash. Forward slashes mid-path are safe because `pathlib.Path(UPLOAD_DIR) / "db-attr-files/uuid.png"` resolves correctly without escaping the upload root. Pre-existing dedicated sub-routes (`/uploads/crm-pics/{f}` and `/uploads/trip-covers/{f}`) are registered before the wildcard and continue to match first — no conflict. Verified post-fix: unauthenticated requests to `/uploads/db-attr-files/xyz.png` now correctly hit the auth check and return 302→login (previously they returned 404 without touching auth at all). |
| 2026-05-21 | **Login page mobile sizing + demo sessionStorage user-isolation (commit `227fa42`).** Three fixes bundled in one commit. **(1) Widget settings modal mobile overflow:** `#ws-settings-modal` card gets `max-height:85dvh`/`max-height:85vh` (dvh→vh cascade); inner card wrapper gains `flex flex-col overflow-hidden`; `#ws-settings-body` gets `overflow-y-auto flex-1 min-h-0`; header and footer get `flex-shrink-0`. Previously the modal bled off-screen on small phones with many settings. **(2) Login page mobile layout:** `<body>` `overflow-hidden` → `overflow-x-hidden overflow-y-auto` so the page scrolls on short-viewport devices; card wrapper gains `py-8`; glow card `p-8` → `p-5 sm:p-8`; logo emoji `text-6xl mb-3` → `text-5xl sm:text-6xl mb-2 sm:mb-3`; worm track `h-9` → `h-8 sm:h-9`; demo button `top-4 right-4` → `top-3 right-3 sm:top-4 sm:right-4` with text hidden below `xs` breakpoint. **(3) Demo sessionStorage user-isolation:** 3-layer fix prevents stale `bw-hp` (last-open page ID) from surviving a login→demo switch or demo→login transition — which caused the home canvas to attempt fetching a page belonging to the other user (HTTP 404, then spinner stuck). Layer 1 — `main.py` now passes `current_user_id` to the template context. Layer 2 — `base.html` early-`<head>` script checks `sessionStorage.getItem('bw-uid')` against `{{ current_user_id | tojson }}`; mismatches cause immediate `sessionStorage.removeItem('bw-hp')` and re-stamp of `bw-uid` before the `bw-hp-restore` class check fires (zero-flash guarantee). Layer 3 — `home-widgets.js` catch handler: if the failing `pageId` matches the stored `bw-hp`, removes both the key and the `bw-hp-restore` class from `<html>` for clean recovery. |
| 2026-05-21 | **Timeline mobile — 2D drag + smaller cards + landscape guard (commits `80ae433`, `1abfbdd`, `10a8a52`, `3f6d91f`).** Four commits in sequence on `timeline.js`. **(1) Worm size:** `WORM_W` reduced from 42 px to 26 px on mobile (`window.innerWidth < 768`); `WORM_H` adjusted proportionally — prevents the worm from eating half the card real-estate on a phone. **(2) Smaller cards:** `CARD_W` 200→145 px, `CARD_H` 80→60 px on mobile; reduces horizontal scroll distance and improves at-a-glance legibility. **(3) 2D drag with vertical pan:** `contentWrap` gets `translateY` manipulation when the user drags vertically while holding a card, so card repositioning and page scrolling no longer compete on touch devices. Pointer capture acquired lazily (only after a 150 ms threshold to distinguish tap vs drag); axis locked after movement > 10 px so the gesture resolves to either H-scroll or V-pan, not both. **(4) Vertical pan geometry fix + landscape breakpoint:** Corrected `translateY` math (was accumulating from the wrong origin). Landscape breakpoint changed from `width < 768` to `width < 768 && height < 500` so the compact layout doesn't wrongly activate on a small tablet held in portrait. |
| 2026-05-21 | **Database homespace page — mobile UX (commits `40fd3b2`, `caad50c`, `37b3cc9`).** Three mobile fixes for `home-page-database.js` and `home_page_database.html`. **(1) Size slider hidden + Add card = icon-only:** On `window.innerWidth < 768` the column-width slider is hidden and the `+ Add card` button renders as `＋` (with `title`/`aria-label` for screen readers). **(2) Filter/Fields panels clamp to right edge:** `_dbShowFilterPanel()` and `_dbShowFieldsPanel()` now set `right:0; left:auto` on mobile so panels slide into view from the right rather than overflowing the viewport. **(3) Card detail grip hidden:** Drag-handle grip column hidden on mobile via inline `@media` rule; label column slimmed from `9rem` to `5.5rem` to shift the value column left on narrow screens. |
| 2026-05-21 | **Trip Chart tab mobile — final alignment polish (commits `fd18310`, `21add30`, `23e908d`).** Three follow-up commits carrying over from the 2026-05-20 session. **(1) Shared label column:** `Plan:` / `View:` / `Person:` labels share a fixed-width CSS-grid label column so all selects left-align identically. **(2) `View:` bar hidden on mobile:** Middle bar hidden on `<640px` — its value is implied by context and removing it saves a row. **(3) `'View by person'` → `'Person:'`:** Shortened label to fit the fixed column width; `aria-label` updated to match. |
| 2026-05-20 | **Trip Chart tab + resource cards — mobile layout (commits `0fae089`, `7040705`, `f2852a6`, `881071b`, `5eefc0c`).** Five commits making the Chart tab usable on phones. **(1) Resource cards centered (`0fae089`):** `mx-auto` added so cards center within their column on narrow screens. **(2) Plan + Currency on one row (`f2852a6`):** `flex-nowrap` + `min-width:0` keeps both dropdowns on a single row instead of stacking. **(3) Label text hidden (`881071b`):** `'Showing stats for'` and `'Display in'` spans hidden below 640 px so only the `<select>` elements remain. **(4) Select max-width capped (`5eefc0c`):** Both selects capped at `max-width:38vw` so they fit side-by-side even on a 320 px phone. **(5) Info lines hidden (`7040705`):** `'Showing stats for'` + `'FX rates approximate'` text-only lines removed from mobile toolbar via `@media` rule. |
| 2026-05-13 | **Trip Plan tab — mobile UX (commit `26e307c`).** Three improvements for the Plan tab on small screens. **(1) `＋ Add Day` / `＋ Add Trip` buttons shrink to `＋` on mobile (< 768 px):** `_tripRenderTopbarControls()` already used `_sm` for the Research tab buttons; same pattern now applied to the Plan tab branches (`_tripActivePlanId` truthy = Add Day; falsy = Add Trip). Both keep `title` + `aria-label` so screen readers announce the full name. **(2) Day lane cards become full-width on mobile:** `@media (max-width:767px)` rules add `#trip-days-row { flex-direction: column }` so lanes stack vertically, and `.trip-day-lane-card { width: 100% !important }` overrides the JS-injected inline pixel width. **(3) Card-width slider hidden on mobile:** `#trip-day-size-wrap { display: none !important }` — the slider is meaningless when lanes are full-width. Also extended the viewport-cage release rules to include `#trip-plans-view`, `#trip-days-view`, `#trip-days-container` so trip cards and day lanes flow naturally instead of being squeezed. |
| 2026-05-13 | **Trip Research view — mobile viewport cage fix (commit `662dbaf`).** Root cause of cards being invisible on mobile: `#trip-page-root` has `height:calc(100vh-3.5rem); overflow:hidden` and every nested panel uses `flex-1 overflow-hidden`, trapping the spot-card grid in whatever vertical pixels remain after the topbar + filter bar. On a phone where the filter bar wraps to multiple lines, the grid area can collapse to near-zero, making every card invisible. Fix mirrors the subscriptions page approach: `@media (max-width:767px)` CSS block releases the cage — `#trip-page-root` becomes `height:auto; overflow:visible`; `#trip-panel-research`, `#trip-locs-view`, `#trip-spots-view`, `#trip-locs-grid`, `#trip-spots-grid`, `#trip-plans-grid` all become `overflow:visible; flex:none` so they grow to their full content height. Outer `#main-content` scroll container handles page navigation. `#trip-topbar` becomes `position:sticky; top:0; z-index:30` so tab buttons stay accessible while scrolling. Spot card cover bumped to `13rem !important` (covers win over Tailwind’s `h-40`). Add-button mobile breakpoint updated from 640 → 768 px to match the new CSS boundary. Desktop (`≥ 768px`) layout is entirely unchanged. |
| 2026-05-13 | **RSS feeds fixed on Walmart Eagle WiFi/VPN — three-layer bug (commits `d6497c7`, `1af3994`).** Root causes and fixes: **(1) Docker — no curl binary:** `python:3.13-slim-bookworm` doesn’t ship curl. Old `_curl_fetch()` threw `FileNotFoundError` on every feed request inside Docker. Fix: replaced with `_httpx_fetch()` using the `httpx` library. **(2) Walmart proxy — PAC file not env vars:** httpx only reads `HTTP_PROXY`/`HTTPS_PROXY` env vars, which are empty on Walmart machines. Walmart configures the proxy via a PAC file (`AutoConfigURL` in the Windows registry pointing to `wmtpac.wal-mart.com/proxies/universal.pac`) — invisible to Python. Fix: new `_detect_proxy()` function reads the registry, fetches the PAC file at startup, and extracts the first `PROXY` directive (`sysproxy.wal-mart.com:8080`); result cached in `_PROXY` module global. httpx is then configured with that proxy. Zero config needed on Walmart machines; Docker users set `BW_HTTP_PROXY`. **(3) YouTube renderer format change (root cause — feeds never worked):** In 2024 YouTube migrated channel pages from `videoRenderer`/`gridVideoRenderer` to `richItemRenderer → content → lockupViewModel`. The BFS in `_parse_yt_html` only looked for the old keys — zero matches on every channel, returning `None`, triggering "YouTube is temporarily unavailable" 502 every time. Fix: added `_item_from_lockup(lvm)` that walks the new path map (`rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId` for ID, `metadata.lockupMetadataViewModel.title.content` for title, `metadataRows[0].metadataParts[-1].text.content` for pub date). Old `_item_from_legacy(vr)` kept for backward compat. Verified live: `@StephanieSoo`, `@DBTechYT`, `@SmartHomeSolver` all return 20 items. |
| 2026-05-13 | **Subscriptions page — mobile layout fix (commit `d63f498`).** On screens < 768 px the analytics panel (Spend by Category, Monthly Cost per Subscription, Upcoming Renewals) was hidden behind the subscription list because the two-panel wrapper used `overflow: hidden` with a fixed `height: calc(100vh - 3.5rem)`. Fix: added a `<style>` block with `@media (max-width: 767px)` overrides — `#subs-page-root` height becomes `auto`; `#subs-two-panel` switches to `flex-direction: column; overflow: visible`; `#subs-list` and `#subs-analytics-panel` revert to `overflow-y: visible` so the outer `#main-content` scroll container handles paging; analytics panel becomes full-width (`width: 100%`). A border-bottom replaces the border-right on `#subs-left-panel` as the visual divider between list and charts. Desktop layout (`md+`) is unchanged. Added IDs `subs-two-panel`, `subs-left-panel` to the layout wrappers (previously anonymous divs). |
| 2026-05-13 | **Grid homespace — mobile layout fix: preset columns always fill full width (commit `437b88b`).** Two compounding bugs caused visible dark gaps on the left and right sides of the grid on mobile. **Bug 1 — `canvas.style.width = ''` race:** `_gridApplyLayout()` cleared the inline width style entirely, leaving the canvas to resolve `w-full` from Tailwind. On some mobile browsers the class hadn’t resolved against the correct containing block at paint time, so the canvas would size itself to content instead of filling 100%. **Bug 2 — saved zoom < 100% triggers pixel-mode centering on mobile:** When the user had previously zoomed below 100% on desktop, that value persists to `config_json`. On mobile the zoom slider is hidden (YAGNI) but the code still entered the pixel-width path and applied `justify-content: center` to centre narrow `px` columns — creating symmetric dark-background gaps on both sides. **Fix (`_gridApplyLayout` in `home-page-grid.js`):** (1) Added `isMobileGrid = window.innerWidth < 640` guard — on mobile, fixed-column presets always use `repeat(N, 1fr)` regardless of zoom level. (2) All layout paths now explicitly set `canvas.style.width = '100%'` instead of clearing it. (3) Auto-fill path changed from `repeat(auto-fill, Npx)` to `repeat(auto-fill, minmax(Npx, 1fr))` so cells in the last row stretch to fill leftover space rather than leaving a partial-row gap. (4) `justify-content` cleared (`''`) on all `1fr` paths so no stale centering value from a previous render lingers. |
| 2026-05-13 | **Root-cause fix: stray `}` after `wsDoubleClick` silently killed all 78 main-script functions (commit `656ebf3`).** Symptom: workspace and homespace collapse/expand buttons did nothing. Initial investigation added `typeof fn==='function'&&fn()` onclick guards (commit `035a4eb`) to prevent `ReferenceError`, but that masked the deeper crash. Root cause found via a Python brace-balance scanner (`_check_js3.py`) on the extracted main `<script>` block: `{} net: -1` revealed one extra closing `}` after `wsDoubleClick()` (inserted in commit `9971f5f`). The stray brace caused a `SyntaxError` that prevented the browser from parsing the entire 1 700-line block, leaving all 78 functions undefined. Fix: remove the duplicate `}` (1-line deletion). Lesson documented as Quirk #27. |
| 2026-04-22 | **Subscriptions Homespace page — Phase 1 (commit `177a335`).** New page type for tracking recurring costs (Wallos-inspired). New DB table: `subscriptions` (12 columns, 2 indexes; cycle codes 1=daily/2=weekly/3=monthly/4=yearly; `active=0` excluded from analytics). `PAGE_TYPES` frozenset in `routers/home_db.py` updated. `_initSwappedPage()` in `home-widgets.js` dispatches `#subs-page-root` → `initSubsPage(pid)` (inserted after CRM block, before Grid fallback). Chart.js 4.4.4 bundled locally as `static/js/vendor/chart.umd.min.js` (≈200 KB); loaded lazily by `_subsLoadCharts()` on first render — not in `base.html`. New router: `routers/home_subscriptions.py` (5 JSON endpoints: list, summary, add, update, delete; `_get_subs_page()` handles ownership+type guard). New DB helpers: `routers/home_subscriptions_db.py` (`get_price_per_month`, `get_subscription_progress`, `get_subscriptions`, `add_subscription`, `update_subscription`, `delete_subscription`, `get_summary_data`). New template: `templates/partials/home_page_subscriptions.html` (two-panel shell; root `#subs-page-root[data-page-id]`; left: `#subs-filter-bar`, `#subs-list`; right: `#subs-summary-cards`, `#subs-donut-chart`, `#subs-bar-chart`, `#subs-upcoming`; modals `#subs-modal` + `#subs-del-modal`). New JS module: `static/js/home-page-subscriptions.js` (all `var`; entry `initSubsPage(pid)`; key fns: `_subsLoadAll`, `_subsRenderList`, `_subsRenderSummaryCards`, `_subsLoadCharts`, `_subsRenderDonut`, `_subsRenderBar`, `_subsRenderUpcoming`, `subsOpenAddModal`, `subsCloseModal`, `_subsEdit`, `_subsSubmitForm`, `_subsDeletePrompt`). |
| 2026-04-22 | **Stack widget sizing + File Preview scroll fixes (5 commits, `cbae523` final).** Four separate bugs squashed: **(1) File Preview thumbnails invisible in grid style** — `#upl-prev-{id}` had `overflow-hidden` (clipping) and the grid had `h-full` (no overflow to scroll). Fixed: `overflow-y-auto` on container, `h-full` removed from grid so content grows naturally. **(2) Single-file preview squished in stack** — new single-file branch in `_uplPrevRender` skips the grid entirely; renders thumbnail with `w-full h-full` inside `flex-col h-full` wrapper. `_uplThumbHtml` gained `sizeClass` param (default `'aspect-square'`; pass `'w-full h-full'` for fill layout). **(3) Stack child page order ignored drag direction** — `create_stack_widget` now stores `child_order:[targetId,srcId]` in config. `stack_add_child` appends new child to `child_order`. `get_widgets()` re-sorts children by `child_order` on read; backwards-compat seeds from `sort_order` when key absent. **(4) Stack content squished (root cause: `grid-auto-rows:auto` magic)** — standalone widgets expand rows to fit content; stacked widgets can’t (slides are `absolute inset-0`). Previous attempts at chrome math all missed the real height. Real fix: JS `_stackHeightHint(card)` captures `card.offsetHeight` at drop time (capped `rowSpan×250px` to prevent sibling-grid inflation), sends as `height_px_hint` form field. `create_stack_widget` / `stack_add_child` store it as `min_height_px` in config. Template applies `min-height: Npx` directly when present; formula fallback for old stacks. Row span is **never auto-inflated** (user requirement). Old squished stacks: unstack + re-stack to re-measure. Files: `home-widget-upload-preview.js`, `home-widget-stack.js`, `home-widgets.js`, `home.py`, `home_db.py`, `home_page.html`. |
| 2026-04-20 | **YouTube RSS scraper + Walmart proxy fix shipped.** Root cause of YouTube feed failures: Walmart's McAfee Web Gateway (`sysproxy.wal-mart.com:8080`) requires Kerberos/NTLM proxy auth; `urllib.request.ProxyHandler` cannot negotiate this → 407 on all outbound feeds. Fix: (1) **`_curl_fetch()`** replaces urllib — runs `curl --proxy-negotiate -u :` (Windows SSPI Kerberos, no password) via `subprocess.run` with a tempfile for the response body; returns `(bytes, content_type_str)`. (2) **`_fetch_raw(url, send_rss_accept=True)`** — `send_rss_accept=False` flag added for autodiscovered feed URLs (YouTube RSS returns 500 with the Accept header). (3) **`_parse_yt_html(html_text)`** — NEW: BFS-walks `ytInitialData` JSON embedded in YouTube channel HTML. Collects `gridVideoRenderer` (channel Videos tab) + `videoRenderer` (Home/search) nodes; returns `{feed_title, items}` matching `_parse_rss()` shape, or `None` if no videos. Bypasses `feeds/videos.xml` entirely (blocked by McAfee egress IP rate-limit). (4) **`rss_proxy()`** YouTube branch: `_parse_yt_html` on Home page → fallback to `/videos` tab → 502 if both fail. (5) **`_autodiscover_feed_url()`** — YouTube-specific extraction from `ytInitialData` (`externalChannelId`, `channelId` patterns) before generic `<link>` tag scan. File changed: `routers/home.py`. See **🌐 Network & Proxy** section above. |
| 2026-04-20 | **`upload_preview` widget shipped (commit `92b68bc`).** New widget type "File Preview" — pinned uploads from any Uploads page rendered as a thumbnail grid or carousel. Config stored in `home_widgets.config_json` as `{upload_ids, caption, style}`. No new DB tables — uses existing `page_uploads` table. New JS engine: `static/js/home-widget-upload-preview.js` (all-`var`; key fns: `_loadUploadPreview`, `_uplPrevOpenPicker`, `_uplPrevFetchPages`, `_uplPrevLoadFiles`, `_uplPrevConfirm`). **Also fixed latent bug:** `GET /home/pages` (`list_pages_json`) was missing from `routers/home.py` — both the add-widget CRM pages picker AND the new upload-preview file picker were silently failing (empty dropdown). Fixed by adding the endpoint; must be declared **before** `/pages/{page_id}` so Starlette matches it correctly. Auth-gated (not in `_PUBLIC`). |
| 2026-04-20 | **Page trash feature shipped (commit `cbf98d7`).** Soft-delete home pages with 30-day retention, drag-to-trash sidebar zone, trash modal with Restore + Empty Trash. DB: `home_pages.deleted_at DATETIME DEFAULT NULL` added via additive migration. `delete_home_page()` changed from hard-delete to `UPDATE SET deleted_at=datetime('now')`. New `home_db.py` helpers: `restore_home_page`, `get_trashed_home_pages`, `empty_home_page_trash`, `purge_expired_home_pages` (all-users startup purge for >30-day trash). New routes in `routers/home.py`: `GET /home/pages/trash` (JSON list), `POST /home/pages/trash/empty` (returns sidebar HTML), `POST /home/pages/{id}/restore` (returns sidebar HTML + `X-Restored-Page-Id` header). Private `_sidebar_ctx(uid, active_page_id=None)` replaces bare `get_home_pages()` calls across all 5 sidebar-returning routes — now returns `{pages, hp_trash_count}`. JS additions to `home-widgets.js`: `_pgDragStart`, `_trashDragOver`, `_trashDragLeave`, `_trashDrop` (drag-to-trash zone), `openHpTrashModal`, `closeHpTrashModal`, `_restoreHpPage`, `_emptyHpTrash` (trash modal). |
| 2026-04-11 | **Phase 8 / B2 PDF Annotations shipped (commit `86ed485`).** New router `home_uploads_annot.py` (not added to `home_uploads_docs.py` — already 798 lines over limit). DB migration: `pdf_annotations` table + `idx_pdf_annot_file`. JS: `home-page-uploads-annot.js` (286 lines). Template: `#upl-annot-modal`. Template-audit 5/5 green, QA 100% green, pre-commit 0 blockers. Manual smoke test step 9 pending. |
| 2026-04-11 | **CRM Phase 3 (Feature A + B) verified complete by bookworm-qa sweep. PLAN_CRM_PHASE3.md checklist marked done. Both features were already fully implemented; this session confirmed correctness.** Feature B (New Field Types): `crm_custom_fields.field_type` expanded to 9 values (`text`, `select`, `multi_select`, `checkbox`, `url`, `email`, `date`, `number`, `file_links`); `_CRM_FIELD_TYPE_DEFS` constant in `home-page-crm-fields.js`; checkbox quick-toggle `crmQuickCheckbox()` on gallery cards; value encoding documented (checkbox=`'1'`/`'0'`, multi_select+file_links=JSON array string). Feature A (Sort/Filter/Group toolbar): `home-page-crm-toolbar.js` (new module) — state vars `_crmSortKey/_crmFilterField/_crmFilterValue/_crmGroupField`; `window.crmRenderToolbar`; `window._crmProcessed()` (replaces `_crmFiltered()` which now wraps it); `window._crmGroupValue()`; setters `crmSetSort/crmSetFilterField/crmSetFilterValue/crmSetGroup/crmClearFilters`. |
| 2026-04-15 | **Phase 7 / B2 — Jspreadsheet CE in-browser spreadsheet editor shipped (commit `95ea1dd`).** New file: `static/js/home-page-uploads-spreadsheet.js` — all-`var`, lazy CDN loader for Jsuites + Jspreadsheet CE + SheetJS (pinned major versions; load order is mandatory: Jsuites JS → Jsuites CSS → Jspreadsheet JS → Jspreadsheet CSS → SheetJS). Promise cached in `_uplSsLibsPromise` to avoid re-injection on re-open. New endpoint: `PUT /home/uploads/{pid}/files/page/{fid}/spreadsheet` in `home_uploads_docs.py`; model: `SpreadsheetBody(content_b64, format)`; ≤10 MB guard `MAX_SPREADSHEET_BYTES`; auth-gated + `_demo_guard`. New HTML: `#upl-spreadsheet-modal` in `home_page_uploads.html`. `base.html` load order: uploads-docs.js → uploads-sign.js → uploads-wopi.js → uploads-spreadsheet.js (last, `<script defer>`). `_uplSsInstance()` helper returns `el.jspreadsheet ?? el.jexcel` for v4/v5 compat. |
| 2026-04-15 | **Phase 7 / B1 — Ghost Signature drag-to-place shipped (commit `95ea1dd`); race fix shipped (commit `39cc0c2`).** Ghost PNG follows cursor over the PDF canvas after "Place Signature" is clicked; single-click commits placement by calling `_uplSigConfirmGhost()`. Race fix: `_uplSigGhostActive = false` is now reset on the **first line** of `_uplSigConfirmGhost()`, before the `!ghost || !wrap` early-return guard — prevents DOM timing race from soft-locking ghost state for the session (see Quirk #23). |
| 2026-04-15 | **Phase 6 — Collabora Online WOPI integration shipped (commit `801ee6a`).** BookWorm is now a WOPI host. New: `routers/wopi.py` (CheckFileInfo / GetFile / PutFile / LOCK stub; `itsdangerous` token auth, salt `wopi-token-v1`; discovery XML cached in `_discovery_cache`). New: `static/js/home-page-uploads-wopi.js` (`_uplWopiOpen`, `_uplWopiClose`, `_uplWopiFrameLoaded`, `_uplWopiEnabled`, `_uplWopiPageId`, `_uplWopiBindPostMessage`; `_WOPI_MIMES` array). New endpoint: `GET /home/uploads/{pid}/files/page/{fid}/wopi-token` in `home_uploads_docs.py` (returns `{collabora_disabled:true}` when `BW_COLLABORA_URL` unset). Auth middleware: `/wopi/` prefix bypassed alongside `/static/` — NOT added to `_PUBLIC`. Docker: `collabora` service added (`collabora/code:latest`, internal only, `extra_params` disables SSL + allows WOPI hosts). Three new opt-in env vars: `BW_COLLABORA_URL`, `BW_WOPI_BASE_URL`, `BW_WOPI_TOKEN_EXPIRY`. WOPI-eligible MIMEs: DOCX, DOC, ODT, TXT, XLSX, CSV, PPTX — PDF excluded (stays with sign/annotate). `base.html` load order: uploads-docs.js → uploads-sign.js → uploads-wopi.js (last; `_uplWopiEnabled` must exist before `_uplDocStudioInit` calls it). Known limitation (Phase 7): LOCK/UNLOCK stub always 200. |
| 2026-04-06 | **Fixed event widget losing events on refresh — race condition in `_hpFetch` (stale-flight bug).** Root cause: `showHomePage()` on SPA navigation triggers a background revalidation fetch (`_hpFetch silent=true`) when the cache entry is older than 5 min. If the user then saved a new event (which calls `invalidateHomePageCache`), the in-flight fetch completed AFTER the cache was deleted and re-inserted stale HTML containing no events — overwriting both `_hpCache` and `hc.innerHTML`. Fix: added `_hpMutVer` Map (per-page mutation counter). `invalidateHomePageCache` now increments the counter. `_hpFetch` snapshots `verAtStart` before the fetch; on completion, if `verNow !== verAtStart`, the result is discarded and a fresh fetch is kicked off. This prevents any stale in-flight response from clobbering a mutation that happened mid-flight. File: `static/js/home-widgets.js`. Server restarted as PID 80980. |
| 2026-04-06 | **Fixed event widget losing events on SPA navigation (cache bug).** Root cause: `_evtSaveItems` in `home-widget-events.js` correctly POSTed to the server (204 OK, DB updated), but never called `invalidateHomePageCache`. So within the 5-min `_hpCache` TTL, navigating away and back served stale HTML with no events. Fix: added `invalidateHomePageCache(pageId)` call after the successful fetch, reading `pageId` from `sessionStorage.getItem('bw-hp')` — same pattern used in `home-widgets-settings.js`. |
| 2026-04-05 | Eddie brought server online (was down). Health-checked everything. All green. Last session was mid-feature on reminder widget browser notifications — committed clean. Created this notes file. |
| 2026-04-05 | Fixed two text widget bugs in `home-widget-text.js`: (1) **DnD vs text-selection conflict** — `openTextEdit` now sets `card.draggable = false` while editing and restores it in `_exitEditMode`; (2) **Tab/Shift+Tab list indent/dedent** — added `_handleTabIndent` keydown listener attached on edit-open and removed on exit. Only fires when caret is inside a `<li>`; all other Tab presses fall through to browser default. |
| 2026-04-05 | Fixed JS SyntaxError: `Identifier '_savedLinkRange' has already been declared` in `templates/partials/note_form.html` lines 997+999. Root cause: HTMX re-injects the note form `<script>` block every time a note is opened; `let` throws on re-declaration but `var` is safe. Changed both `let _savedLinkRange` and `let _editingLinkEl` to `var`. See "Known Quirks" #11 below. |
| 2026-04-06 | **Fixed event widget losing events on refresh.** Root cause: `evt_prepare_items` Jinja2 filter was in `templates_env.py` but running process was stale → every home page render 500'd → HTMX showed error div → events looked gone (DB was fine all along). Fix: kill old BookWorm PIDs, restart with `cmd /c "start /B .venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000 >> bookworm.log 2>&1"`. Gotcha: `restart.bat` has `pause` at end — breaks when run non-interactively. **Note: server drifted stale again on same day at 11:31–11:34 (errors logged in `bw_error.log`). Re-killed PID 64892, fresh restart gave PID 28108 — clean from 11:44 onwards.** |
| 2026-04-06 | **Added standalone Banner widget.** Removed `banner` style from the Title widget style list. Created new `banner` widget type with 4 styles: `solid` (Walmart blue), `gradient` (blue→purple), `dark` (zinc-900), `spark` (Walmart yellow #ffc220). Config fields: text, subtitle, emoji, align — same as title. Changes: `static/js/home-widgets.js` (WIDGET_STYLES + WIDGET_CONFIG_FIELDS), `templates/partials/home_add_widget_modal.html` (added to type picker), `templates/partials/home_page.html` (removed banner from render_title, added render_banner macro + dispatch). All templates pass health check. |
| 2026-04-06 | **Added event delete confirmation + calendar day popup.** (1) The × button on event cards now shows a styled warning modal (`evt-del-confirm-modal` in `home-widget-events.js`) matching `del-widget-modal` style, with cancel + confirm buttons, before permanently deleting. (2) Calendar date cells (month & mini) are now clickable — `cal-day-modal` lists events (Edit ✏️ + Delete) and reminders (Delete) for that day. "Add Event" button in the footer pre-fills the target date. Modal built once in JS and reused. `id` field added to `_bwEventStore` entries for reliable index lookups. |
| 2026-04-06 | **Deep-dive investigation of event widget (11:44 session).** User reported events disappearing on page refresh. Full trace performed: DB query confirmed Widget 33 has event `{text:"dfsdf", target_date:"2026-04-15"}` saved correctly. `bw_error.log` revealed the actual failure: `TemplateAssertionError: No filter named 'evt_prepare_items'` for all page 1 renders between 11:32–11:34 — the stale server (PID 64892) that hadn't seen the filter registration. Server was restarted at 11:44 (PID 28108). E2E render test `_test_event_render.py` confirms the CURRENT server renders `evt-json-33` with clean unescaped JSON (`"` not `&quot;`) and 1 item. All code fixes from earlier sessions are correctly in place. Root cause of user-visible symptom: stale server → 500 on `/home/pages/1` → `home_page_view` error handler returned error div → JS could never read the event blob → events appeared gone. **Resolution: server restart + the two code fixes already applied (see row below) = fully working. ⚠️ NOTE: Do NOT treat this entry as closed proof. Always ask the user to confirm events are persisting before concluding the bug is resolved.** |
| 2026-04-14 | **Phase 4 Document Studio — COMPLETE.** Added in-panel file operations for the Uploads homespace page. New files: `routers/home_uploads_docs.py` (350 lines, 5 endpoints — read content, save text, combine, convert, sign), `routers/uploads_docs_db.py` (43 lines — `update_page_upload_size`, `get_page_upload_owned_bulk`), `static/js/home-page-uploads-docs.js` (440 lines — `_uplDocStudioInit`, `_uplDocAfterRender`, multi-select toolbar). New Python deps added to `requirements.txt`: `pypdf>=4.0.0`, `python-docx>=1.1.0`, `reportlab>=4.0.0` (installed versions: 6.10.1, 1.2.0, 4.4.10; `lxml==6.0.4` transitive). Template additions: `#upl-combine-modal` + `#upl-sig-modal` in `home_page_uploads.html`; `home-page-uploads-docs.js` script tag in `base.html` (load order: uploads.js → uploads-tags.js → uploads-docs.js). `home-page-uploads.js` gained two defensive hooks calling `_uplDocStudioInit`/`_uplDocAfterRender` when present; `_uplFmtSize`/`_uplFmtDate` moved to `home-page-uploads-tags.js`. Commit: `06bb6d8`. |
| 2026-04-06 | **Fixed: event widget items not persisting after page refresh (two bugs).** Bug 1 (primary — events always blank on reload): `{{ raw_items | tojson }}` in `home_page.html` line 512 was missing `| safe`. Jinja2 autoescape converted every `"` to `&quot;` inside the `<script type="application/json">` tag. Browsers treat script content as raw text — no entity decoding — so `JSON.parse()` in `_evtReadItems` silently returned `[]` on every page reload. Events saved to DB fine but could never be read back. Fix: `{{ raw_items | tojson | safe }}`. Bug 2 (secondary — resize wipes events): `_evtSaveItems()` posted only `{ items }`, nuking `col_span`/`row_span` from the config. Also never updated `data-widget-config` on the card element, so a subsequent widget resize read stale config (no items) and overwrote the DB. Fix: `_evtSaveItems` now reads full card config via `data-widget-config`, merges `items` in, POSTs the complete merged config, updates the attribute, and checks `res.ok`. Files: `templates/partials/home_page.html`, `static/js/home-widget-events.js`. Verified with `_test_evt_json.py` — zero HTML entities in output. |
| 2026-04-06 | **Performance: Homespace page switching + scroll jank.** (1) `showHomePage()` now uses a client-side in-memory cache (`_hpCache` Map, 5 min TTL, stale-while-revalidate) — second visit to any page is instant. Cache invalidated by all mutation paths: `_saveWidgetConfig`, `_saveWidgetFullConfig`, `_doDeleteWidget`, `addWidget`, drag-reorder, page layout save. (2) Sidebar home page tab buttons get `onmouseenter=prefetchHomePage(id)` to warm the cache before the click lands. (3) `#home-content` CSS `transition: opacity 120ms ease-out` for smooth fade instead of flicker on cache-miss loads. (4) `overscroll-behavior-y: contain` on `.main-scroll` / `.panel-scroll`. (5) `contain: layout style` on `.hw-card` isolates per-card layout. (6) Passive scroll listener adds `.bw-scrolling` to `#main-content`; CSS rule `.bw-scrolling .hw-card { transition: none !important }` eliminates box-shadow repaints while scrolling (removed 150 ms after scroll stops). (7) `wsSingleClick` debounce 350 ms → 150 ms. |
| 2026-04-07 | **Cleaned up duplicate BookWorm instances.** User had two servers: port 8000 (good, uvicorn) and port 8001 (stale `python main.py`). Also two orphaned processes. Killed PIDs 8344 (port 8001), 16972 (its fork), 33512 (stale orphan), 24388 (duplicate port 8000 that lost the bind race). Survivor: PID 37256 — `uvicorn main:app --host 127.0.0.1 --port 8000`, HTTP 200 confirmed. Port 8001 fully dead. |
| 2026-04-07 | **Added proactive demo-deletion detection + admin-ended modal.** Added `GET /demo/alive` public endpoint to `routers/demo.py` (returns `{alive:true/false}` from DB; no auth required so it survives account deletion). Added it to `_PUBLIC` in `auth_middleware.py`. Added client-side poller (every 20 s via `setInterval`) inside the demo banner IIFE in `index.html` — when `alive==false`, an `alertdialog` overlay appears: 'Demo Session Ended', explains the admin ended it, 10-second auto-redirect countdown, 'Go to Login →' button. Button and auto-redirect both call local `_doExit()` which sends the `/demo/end` beacon (idempotent) then `window.location.replace('/login')`. Modal is zero-dependency inline JS/CSS (no Tailwind classes — avoids CDN loading race). Added `/demo/alive` to Known Quirks of the `_PUBLIC` list. |
| 2026-04-07 | **Fixed all four demo-deletion UI bugs with one server-side fix.** Root cause: all four symptoms (broken half-page login, sidebar still open, login box not centred, both Exit Demo + Try Demo buttons showing) were from the same bug — when a demo user was deleted mid-session, HTMX followed the 302 redirect to /login silently (XHR auto-redirect), lost the redirect headers, then tried to swap the entire login page HTML into a content div. `window.location.replace()` in the JS interceptor doesn't halt JS execution synchronously, so HTMX completed the swap first and the navigation raced it. Fix: auth middleware now detects `HX-Request` header and returns `200 + HX-Redirect:/login` instead of `302`. HTMX’s native `HX-Redirect` handling does a full-page navigation BEFORE any swap runs — login HTML never lands in a partial div. The old `htmx:beforeSwap` JS interceptor kept as belt-and-suspenders fallback. Also noted: the `home-widgets-settings.js:185 SyntaxError` from the first session was a stale cached version (v=1775577458); current file (v=1775599006) is valid — hard-refresh clears it. |
| 2026-04-07 | **Diagnosed previous session freeze + documented root cause.** Server was healthy the whole time (PID 7736, `/health` 200 OK, clean logs). The freeze was in the Code Puppy shell tool, not BookWorm. Root cause: `taskkill ... & timeout ... & start /B uvicorn ...` — `start /B` in `cmd.exe` launches the child but it **inherits the parent cmd's stdout/stderr handles**. The shell tool captures those handles and waits for them to close before returning its result. Uvicorn never closes them (runs forever) → tool hangs indefinitely. Server runs fine; tool is just stuck. Fix: always use PowerShell `Start-Process` with explicit `-RedirectStandardOutput`/`-RedirectStandardError` (which we’d already switched to). Documented as Known Quirk #13. Updated Known Quirk #12 (restart.bat) to point to #13. Updated "How to Start the Server" section with the correct PowerShell command and an explicit warning against `start /B`. |
| 2026-04-07 | **Reduced demo user TTL from 24 h → 2 h.** Root cause of accumulation: demo session cookies are `session-only` (no `expires_at`), so they die the moment a user closes their browser tab — but the DB row was kept alive for a full 24 hours. With frequent testing, this quickly piles up (12 ghost users observed). Fix: changed `datetime('now', '-24 hours')` → `datetime('now', '-2 hours')` in `purge_old_demo_users()`. Ran immediate one-shot purge — 8 stale users removed, 4 legitimately fresh ones kept. |
| 2026-04-08 | **Superadmin can now toggle new-user registration on/off at runtime.** (1) **`site_settings` DB table** added to `database.py` `init_db()` — key/value store for persistent admin-toggleable flags. `registration_open` seeds its value from `BW_ALLOW_REGISTRATION` env var on first boot only; after that the DB is authoritative and no restart is needed. (2) **`auth_db.py`** — added `get_registration_open()` (reads `site_settings`, falls back to env if row absent) and `set_registration_open(bool)` (INSERT OR REPLACE). (3) **`auth.py`** — removed static `_REGISTRATION_OPEN` module-level constant; `GET /register`, `POST /register`, and `GET /login` now call `await get_registration_open()` per-request. (4) **`account.py`** — added `POST /account/settings/registration` (superadmin-only; reads `enabled` checkbox field, persists, re-renders `admin_users.html`); all 5 handlers that re-render that partial now pass `registration_open` ctx. `GET /account/users` also passes it. (5) **`admin_users.html`** — new "🌐 Site Settings" card section at the top with a Tailwind toggle switch for Public Registration. Flips state instantly on change via `requestSubmit()` + `adminPost()`. Description text updates on re-render to reflect the new state. (6) **`.env.example`** updated to note that env var is seed-only. |
| 2026-04-08 | **Fixed mention title + dark/light mode theming for mention/bookmark/embed.** (1) **Mention title never showed** — root cause: server-side `urllib` couldn't get through Walmart's NTLM proxy, always returned `""`. Fix: switched to browser-native `fetch()` for YouTube/Vimeo via their oEmbed APIs (CORS-open, browser proxy handles auth automatically). Server `/notes/url-title` retained as fallback for other URLs; SSL verification disabled via `ssl.CERT_NONE` ctx to bypass Walmart corporate CA inspection. Added `bwMentionTitle` Turndown rule so `<span class="bw-mn-ttl">` survives the CE→TA→CE round-trip. Title appended after pill only if `pill.isConnected` (guards against detached DOM). (2) **Mention/Bookmark/Embed colours frozen at insertion time** — inline styles set at paste time never responded to `toggleTheme()`. Fix: stripped ALL theme-sensitive colours from `_mentionHtml`, `_bookmarkHtml`, `_embedFallbackHtml`; moved to CSS rules in `base.html` keyed on `[data-bw-mention]`, `[data-bw-bookmark]`, `[data-bw-embed]` + `.dark` selectors. CSS classes `bw-mn-lbl`, `bw-mn-tld`, `bw-mn-ttl`, `bw-bm-label`, `bw-bm-url`, `bw-emb-head`, `bw-emb-icon`, `bw-emb-title`, `bw-emb-path` carry all colour rules. Only brand-avatar bg/fg (dynamic per domain) remain inline. Removed `isDark` param from all three generators and from `_choose()`. |
| 2026-04-07 | **Added permanent "Docker & GitHub Deployment Rules" section to CODEPUPPY_NOTES.md.** Covers 10 rule categories Eddie checks before every change: env-var-only config (with full table of `BW_*` vars), file paths through `BW_DATA_DIR`, always using `get_db()` (never raw connects), additive-only idempotent migrations, secrets never in code, `requirements.txt`-only deps, keeping `_PUBLIC` in `auth_middleware.py` current, global vs per-user table guard rules, static asset cache-busting and Tailwind CDN tech-debt note, Docker image hygiene, port conventions, and a PR checklist. |
| 2026-04-07 | **Production-readiness hardening for Docker/GitHub release (7 changes).** (1) **WAL mode + busy_timeout in `get_db()`** — added `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` so concurrent async tasks and multiple uvicorn workers don't immediately fail on write contention. (2) **`home_db.py` bypassed `get_db()` entirely** — all 8 functions used raw `aiosqlite.connect()` and never received the WAL/FK/timeout pragmas. Rewrote to use `get_db()` throughout; dropped the `aiosqlite` and `DB_PATH` direct imports. (3) **`BW_HTTPS` env var** — `https_only` was hardcoded `False`. Now reads `os.getenv("BW_HTTPS", "false")` so operators behind nginx/Caddy can enable Secure cookies without touching code. (4) **`BW_ALLOW_REGISTRATION` env var** — registration was wide-open to anyone with the URL. `GET/POST /register` now return 302→/login when `BW_ALLOW_REGISTRATION=false`. Login page hides the "Create an account" link. (5) **`BW_DEMO_ENABLED` env var** — demo mode now off-able. `POST /demo/start` returns 302→/login when disabled; login template hides the Try Demo button via Jinja2 `{% if demo_enabled %}`. (6) **`/health` endpoint** — previous healthcheck hit `GET /` which triggered a session redirect chain. New `GET /health` returns `{"status":"ok"}` with 200, no auth, no DB, added to `_PUBLIC` in `auth_middleware.py`. `docker-compose.yml` healthcheck updated. (7) **`docker-compose.yml` + `.env.example`** — replaced hardcoded `BW_SECRET_KEY` placeholder (security trap) with `${BW_SECRET_KEY:?...}` which fails loudly on startup if not set. Added all 5 env vars with docs. Added backup one-liner in comments. Created `.env.example` for GitHub. `Dockerfile` CMD now reads `${WORKERS:-1}` so worker count is configurable without image rebuilds. |
| 2026-04-07 | **Demo mode audit + data hygiene fixes (3 issues found and resolved).**(1) **Critical — demo users could pollute global `categories` and `attr_definitions` tables.** These are shared across ALL users; a demo session's garbage (e.g. "DoggoCat", "Tesing ting g") was visible to real users. Fix: added `_demo_guard(request)` helper in `routers/categories.py` that returns HTTP 204 + `HX-Reswap: none` for any write from `is_demo` sessions. Applied to 7 routes: `POST /categories`, `DELETE /categories/{id}`, `POST /categories/{id}/rename`, `POST /categories/panel/add`, `POST /categories/{id}/panel-remove`, `POST /attr-defs`, `DELETE /attr-defs/{id}`. (2) **`_seed_demo` was not populating `workspace_categories`**.  The `init_db()` backfill cross-join only runs at startup for existing rows; demo workspaces created afterward had 0 category links. Fix: added explicit `INSERT OR IGNORE INTO workspace_categories SELECT w.id, c.id FROM workspaces CROSS JOIN categories WHERE w.user_id = ?` after workspace creation in `_seed_demo`. All 33 demo workspaces now show 6 category links each. (3) **3 zombie demo users** (ids 4–6, created before the UNIQUE fix where seeding crashed) had 0 workspaces/notes/widgets. Purged via one-shot cleanup script (now deleted). Also purged 2 demo-polluted categories: "DoggoCat" (id 387), "Tesing ting g" (id 449). "Expansion" (id 331) preserved — real-user note link confirmed. DB is clean. |
| 2026-04-07 | **Fixed Demo mode Internal Server Error.** Root cause: `workspaces.name` had a legacy global `UNIQUE` constraint from the original single-user schema — not `UNIQUE(user_id, name)`. A second demo session inserting "Team Notes" triggered `sqlite3.IntegrityError: UNIQUE constraint failed: workspaces.name`. Fix: added migration in `init_db()` (`database.py`) that reads `sqlite_master` DDL, detects `"name TEXT NOT NULL UNIQUE"`, then rebuilds the table (full SQLite table-swap: `PRAGMA fk=OFF` → `CREATE workspaces_new` → `INSERT INTO ... SELECT FROM workspaces` → `DROP TABLE workspaces` → `RENAME TO workspaces` → `CREATE INDEX idx_ws_sort` → `PRAGMA fk=ON`). Also replaced seed-workspace `INSERT OR IGNORE` (which relied on the now-removed constraint) with an explicit `SELECT`-before-insert guard. Verified: two back-to-back `POST /demo/start` both return `302 Found` with no error. |
| 2026-04-07 | **Added Callout slash commands (Info, Warning, Tip, Danger).** 4 new entries in `SLASH_COMMANDS` in `static/js/slash_commands.js`. Each inserts a `<div class="bw-callout bw-callout-{type}">` block with an icon div and body div. CSS for all 4 types + dark mode added to `templates/base.html` after `.bw-col` (lines 450–488). Turndown `keep` rule updated to preserve `.bw-callout`, `.bw-callout-icon`, `.bw-callout-body` divs. Trigger: type `/callout` in the palette. Palette shows emoji icons (💡⚠️✅🚨). Server restarted, HTTP 200. |
| 2026-04-07 | **Fixed JS SyntaxError, demo modal, 2FA demo guard, account modal M/L layouts + click-outside.** (1) **SyntaxError `home-widgets-settings.js:151`** — was a stale browser cache (`v=1775577030`). The file was already fixed last session. Hard refresh (`Ctrl+Shift+R`) clears it. New `static_v` served on restart. (2) **Demo modal** — `console.debug` calls were filtered by DevTools default log level; changed to `console.log`. Poller interval reduced 3 s → 2 s. Redirect countdown increased 10 s → 30 s. IIFE log now says `test any time: bwShowAdminEndedModal()`. (3) **2FA disabled for demo users** — added `is_demo` check at the start of `GET /account/2fa`, `POST /account/2fa/enable`, `POST /account/2fa/disable` in `routers/totp.py`. Demo users see a friendly amber notice box instead of the setup flow. (4) **Account modal M/L layouts** — S=unchanged (single-column `max-w-md`), M=two-column CSS Grid (`max-w-2xl`, 260px credentials left / security+admin right, each pane scrolls independently), L=sidebar nav (`max-w-3xl`, 160px `#acct-l-sidenav` left with mini profile card + nav buttons, content area right shows one section at a time via `_acctNav()`). Default restored to S. CSS `<style>` block inside the modal drives the grid. `acct-l-navbtn` base styles defined there (active class `acct-nav-active`). (5) **Click-outside-to-close** — added `onclick="hideAccountModal()"` directly to the blur overlay `<div>` (the backdrop intercepts backdrop clicks; inner modal is rendered on top so no stopPropagation needed). |
| 2026-04-07 | **Fixed demo-deletion modal only firing once + custom note-delete confirmation modal.** (1) **Admin panel stale state (modal fires once, never again):** After the first demo deletion, `admin-users-loader` showed "No demo users" and was never refreshed when a new incognito session created a new demo user. Root cause: `showAccountModal()` called `_loadPanel` once and stopped. Fix: added `_adminPollTimer = setInterval(...)` (8 s) in `showAccountModal()` that re-calls `_loadPanel('/account/users', 'admin-users-loader')` — skipping the refresh if the user is actively typing in an `INPUT` inside the panel (avoids clearing form fields mid-type). Timer cleared in `hideAccountModal()`. Now the admin sees new demo sessions appear in real-time without reloading anything. (2) **Note delete uses ugly browser `confirm()`:** Replaced `hx-confirm` + `hx-delete` on the Delete button in `note_detail.html` with `onclick="openDeleteNoteModal(...)"`. Added `#delete-note-modal` to `index.html` styled identically to the existing `#delete-ws-modal` (red icon, backdrop blur, Cancel + "Delete permanently" buttons). JS: `openDeleteNoteModal(noteId, noteTitle)` → stores pending ID, fills `#delete-note-label`, shows modal. `_confirmDeleteNote()` calls `htmx.ajax('DELETE', '/notes/'+noteId, {values:{workspace_id}})` + `closePanel()`. Note title passed via `{{ note.title | tojson }}` to safely handle quotes/emoji. Also added `dark:hover:bg-red-900/20` on the delete button for dark-mode polish (was missing). |
| 2026-04-07 | **Fixed demo modal never showing + note delete scoping bug (root causes found).** (1) **Demo modal root cause:** `HX-Redirect: /login` (returned by auth middleware for HX-Request sessions) does NOT change `xhr.responseURL` — it stays as the original endpoint URL. Both existing interceptors checked `responseURL` and both missed it. HTMX reads `HX-Redirect` in its own load listener and calls `window.location = '/login'` before the modal can appear. Fix: in the XHR `open()` patch, added a **Case B** check: read `getResponseHeader('HX-Redirect')` in our load listener (which fires first, before HTMX's). If it points to `/login`, show demo modal AND monkey-patch `this.getResponseHeader` on the XHR instance to return `null` for `HX-Redirect` — so when HTMX's listener runs next, it reads `null` and skips `window.location`. Belt-and-suspenders Case A (classic 302→/login via `responseURL`) preserved. (2) **Note delete workspace scope bug:** `htmx.ajax('DELETE', url, {values: {workspace_id}})` sends `values` in the **request body**, but FastAPI's `workspace_id: Optional[int] = None` reads from the **query string** for DELETE requests. So `workspace_id` was always `None` → `search_notes(workspace_i→ all notes from all workspaces returned. Fix: build URL explicitly — `'/notes/' + noteId + '?workspace_id=' + encodeURIComponent(wsId)` — guaranteeing it's in QS. Comment added explaining the FastAPI/htmx.ajax body-vs-QS difference so this never bites again. |
| 2026-04-07 | **Demo modal STILL not showing + account window size options + demo list scroll.** (1) **Real root cause of demo modal failure:** The `getResponseHeader` instance-patching approach from the previous session was unreliable — HTMX may capture references to the original method before our override runs, and browser internals can bypass instance-level overrides for native XHR methods. **Definitive fix:** Changed `auth_middleware.py` Phase 2 for deleted demo HTMX requests to return `200 + X-BW-Demo-Ended:1 + HX-Reswap:none` instead of `HX-Redirect:/login`. No redirect means no HTMX navigation. The XHR interceptor now simply reads `getResponseHeader('X-BW-Demo-Ended') === '1'` (no patching needed), calls `bwShowAdminEndedModal()`, and returns. `HX-Reswap:none` prevents HTMX from trying to swap the empty body. Non-HTMX deleted-demo navigations still get `302→/login?admin_ended=1`. Whole interceptor block rewritten to be simpler: `_isDemoEnded()`, `_isLoginRedirect()`, `_handleSessionLost()` helpers; both `htmx:beforeSwap` and the XHR load listener use them. (2) **Account window size options:** Added S/M/L pill buttons to the account modal header. S=`max-w-md` (current default), M=`max-w-xl`, L=`max-w-3xl`. `_setAcctSize(size)` swaps the width class on `#account-modal-inner` and highlights the active pill. Choice persisted to `localStorage('bw-acct-size')`. `showAccountModal()` restores saved size on open. (3) **Demo users list scrollable:** Wrapped demo users `<table>` in a `max-h-52 overflow-y-auto` div inside the orange border container. Added `sticky top-0 z-10` to the `<thead>` so column headers stay visible while scrolling. "Add New User" form is now always visible without scrolling past a long demo list. |
| 2026-04-07 | **Auto-dedup names + sidebar collapse/expand all.** (1) Workspace names: added `_unique_sibling_name(db, base, user_id, parent_id, exclude_id)` in `workspaces_db.py` — checks active siblings case-insensitively, appends ` (2)`, ` (3)` … as needed. Wired into both `create_workspace` and `update_workspace` (latter fetches `user_id` from DB). (2) Note titles: same auto-suffix logic inlined into `create_note` in `notes_db.py` scoped to the same `workspace_id`. (3) Sidebar General section header now has two icon buttons — collapse-all (chevron up) and expand-all (chevron down) — wired to `wsCollapseAll()` / `wsExpandAll()` added in `index.html` next to existing `wsInitCollapse()`. Collapse state still persisted to localStorage. Server PID=19308. |
| 2026-04-07 | **Fixed demo workspace leak into superadmin account.** Two compounding bugs: (1) `purge_old_demo_users()` only did `DELETE FROM users` — but `workspaces.user_id` is `ON DELETE SET NULL` (not CASCADE), so purged demo users' workspaces became `user_id=NULL`. (2) `init_db()` had an unconditional boot-time backfill `UPDATE workspaces SET user_id=1 WHERE user_id IS NULL` that ran every restart, scooping up all those orphaned demo workspaces into the superadmin account. Fix A: rewrote `purge_old_demo_users()` to explicitly `DELETE FROM notes WHERE workspace_id IN (demo workspaces)` then `DELETE FROM workspaces WHERE user_id IN (stale_ids)` before deleting users — no orphans to leak. Fix B: moved the `user_id` backfill inside `if "user_id" not in ws_cols:` so it only runs once ever (the single boot when the column is first added). Hard-deleted 24 ghost workspaces (IDs 181–206) + 33 orphaned demo notes from the superadmin account. |
| 2026-04-07 | **Fixed ghost "Grocery Team" workspace bug in `database.py`.** Root cause: `init_db()` existence check used `WHERE name=? AND user_id IS NULL` but the migration on the *same boot* immediately backfills `user_id` on every NULL workspace row — so the condition was always false on subsequent startups, causing a fresh duplicate on every server restart. Fix: seed now only fires when `SELECT COUNT(*) FROM workspaces` returns 0 (truly empty DB = fresh install). Any rows at all → skip seed, pick `LIMIT 1` for the orphan-note backfill. Hard-deleted ghost IDs 184, 188, 207, 217 (all created during today's debugging restarts). Only ID 69 (user-trashed on 2026-04-02) remains. Server PID=47012. |
| 2026-04-07 | **Fixed demo-banner layout overlap + home-widgets drag TypeError.** (1) Demo banner (`fixed top-16`) was covering sidebar/main content because the `<style>#demo-banner ~ div { padding-top: 2.5rem }` hack *overrode* the Tailwind `pt-16` class instead of adding to it. Fix: replaced the style hack with a Jinja2 conditional directly on the layout div — `pt-[6.5rem]` in demo mode (64px header + 40px banner = 104px), `pt-16` for regular users. Dead style tag removed. (2) `home-widgets.js` dragstart listener: `setTimeout(() => _dragSrc.classList.add('opacity-40'), 0)` captured `_dragSrc` by reference — if `dragend` fires and nulls `_dragSrc` before the 0ms callback runs, you get `Cannot read properties of null (reading 'classList')`. Fix: capture into a `const captured = _dragSrc` before the `setTimeout` so the callback holds a stable reference. New static_v = 1775593015. |
| 2026-04-07 | **Demo Mode feature added.** Login page gets a fixed top-right `🎮 Try Demo` button (Walmart spark yellow, `POST /demo/start`). Each click: (1) purges `demo_*` users older than 24 h, (2) creates a fresh `demo_<12hex>` user with role `demo`, (3) seeds 3 workspaces (Team Notes 📋, Q2 Planning 📊, Archive 🗂), 4 markdown-rich notes, 4 categories, and a home dashboard with 6 widgets (title, clock, note_link, todo, text, sticky), (4) logs them in as session-only (no `expires_at`) so the cookie dies with the browser. A persistent `#ffc220` banner in `index.html` shows when `is_demo=True` with "Create a free account →" and "Exit Demo" links. Auth middleware allows `/demo/start` as public. Stale demo users purged on every server boot. New files: `routers/demo.py`. Modified: `main.py`, `auth_middleware.py`, `templates/login.html`, `templates/index.html`. Server PID=17632, static_v=1775583195. |
| 2026-04-07 | **Fixed slash command not triggering on empty lines or `•` bullet lines.** Two bugs: (1) **Textarea regex** — the auto-bullet feature converts `- ` → `• ` on spacebar; the trigger regex only allowed `[-*+]`, so `• /` never fired the palette. Fix: added `•` to the character class → `[-*+•]`. (2) **CE prefix contamination** — `_cePrefixBeforeCaret` built a DOM Range starting at `(block, 0)`, which includes the `⠿` drag-grip span injected as the first child of every rendered block (`contenteditable="false"`, `textContent="⠿"`). `r.toString()` returned `'⠿/'` instead of `'/'`, so `prefix.startsWith('/')` was `false` → no palette. Fix: detect grip as first child (`hasAttribute('data-preview-grip')`) and set range start to offset 1 (after grip) instead of 0. File: `static/js/slash_commands.js`. Server restarted as PID 6940, static_v = 1775583195. |
| 2026-04-10 | **RSS Feed widget compact — "Feed label bubbles" toggle had no visible effect (second pass, real root cause).** The previous session's fix was correct in concept but dead code in practice. Root cause: the `needsReload` comparison used `JSON.stringify(config.feeds)` vs `rssEl.dataset.feeds` (a string set by Python's `tojson`). `rssSyncFeeds` serialises feed objects as `{color, url, label, category}` but Python's `tojson` serialises as `{url, label, color, category}` — different key order → always different strings → `needsReload` was always `true` → `_loadRss` was always called → `_rssRerender` was never reached. Fix: compare only `feed.url` arrays joined with a null-byte separator (`'\0'`) instead of full JSON blobs. Key order is irrelevant; only URL presence/order matters for deciding whether new network data is required. File changed: `static/js/home-widgets-settings.js`. `templates_env.py` + settings JS touched to bust cache. |
| 2026-04-10 | **RSS Feed widget compact — "Feed label bubbles" toggle had no visible effect (first pass).** Two bugs stacked: (1) **Imperceptible visual diff** — `showBubbles=false` swapped from pill badge to a 5×5px dot-prefix badge. At 10px font size those are visually indistinguishable. Fix: removed `_rssBadge` entirely (YAGNI). `showBubbles=false` now emits `''` — the source label is completely hidden. (2) **Full network refetch on every settings change** — `_saveWidgetFullConfig` always called `_loadRss` after any setting change. Added `_rssRerender(el)` — re-renders from cached `el._rssAllItems`/`el._rssFeeds` without any network call, rebuilding the config from updated dataset attrs. Updated the settings sync handler to snapshot `prevFeeds`/`prevMax` before mutating the dataset, then call `_rssRerender` when only display settings changed and `_loadRss` only when feeds or max-items actually differ. (Note: this session's `needsReload` comparison was still broken due to JSON key-order issue — fixed in the next 2026-04-10 entry.) Files changed: `static/js/home-widget-rss.js`, `static/js/home-widgets-settings.js`. |
| 2026-04-08 | **RSS widget visual overhaul — card frames, compact rows, vertical feed editor (overflow fix).** Two bugs + one UX complaint. (1) **Card ≡ Compact visually** — old card renderer was just a `div.border-b` with a blue title link; compact was nearly identical. Fix: card is now a full framed box — `<a>` with `rounded-xl border bg-white shadow-hover overflow-hidden`, 16:9 thumbnail banner at top, dark-gray bold title inside, coloured source dot + date at bottom right. Compact stays flat borderless rows: small 44×44 square thumb on left, one-line gray title + badge, no chrome. They look completely different even with zero thumbnails. (2) **Category input overflowing modal** — settings modal is `max-w-xs` (320px, ~280px content after padding). Old feed row was a single horizontal flex with `color|URL|label|category|✕` side-by-side — inputs had no room, category bled out. Fix: restructured to fully **vertical** layout: row-1 = colour swatch + domain label + ✕ button; row-2 = full-width URL input; row-3 = `display:grid;grid-template-columns:1fr 1fr;gap:4px` label+category with `min-w-0` on inputs. CSS grid (inline style) is used because Tailwind `grid-cols-2` in dynamic JS strings is JIT-safe on CDN but inline `style` is 100% guaranteed regardless. (3) **Stale JS cache** — `static_v` is computed once at server startup from max JS mtime; changes after startup don't update the version param, so browser serves old cached file. Fix: touched `templates_env.py` + `home-widget-rss.js` mtime to force uvicorn auto-reload and recompute `static_v`. Hard refresh (`Ctrl+Shift+R`) bypasses cache entirely as a fallback. | 2026-04-08 | **RSS proxy: HTML autodiscovery + browser UA (YouTube fix).** Root cause: YouTube channel URLs (e.g. `/@StephanieSoo`) return HTML, not XML — old proxy tried to parse HTML as XML and returned HTTP 502/422. Fix: (1) upgraded `_fetch_raw` to return `(text, content_type_header)` and use a real Chrome User-Agent so YouTube/sites don't 404 bot requests; (2) added `_autodiscover_feed_url(html, base_url)` that scans for `<link rel="alternate" type="application/rss+xml">` or `atom+xml` in any attribute order — YouTube embeds the channel Atom feed link in every channel page `<head>`; (3) in `rss_proxy`: detect HTML response by content-type/sniffing, run autodiscovery, follow discovered feed URL, or return a site-specific hint (YouTube: show the `feeds/videos.xml?channel_id=UC…` format; others: suggest finding the RSS button); (4) frontend error block revamped — server `data.error` hint shown directly (no more generic "Failed to load feed" with no detail); `HTTPError` now returns `HTTP XXX from remote server` instead of Python exception string. Server restarted (PIDs 25964+52152 killed, new process launched). |
| 2026-04-10 | **Non-dashboard pages showed blank widget canvas instead of coming-soon template.** Two-part root cause: (1) **Wrong `page_type` in DB** — when user created CRM/Media/Grid/RSS/Uploads pages the server was running OLD code (before today's `p_type` branching was added). FastAPI `Form("dashboard")` default kicked in for every new page, so all 5 pages got saved as `dashboard`. Fix: `_fix_page_types.py` (infers correct type from emoji, runs `UPDATE home_pages SET page_type=?` for each). (2) **JS `_hpCache` (5-min TTL) served stale empty-dashboard HTML** — even after DB was corrected, browser served the cached response. Fix: `Ctrl+Shift+R` hard refresh. Future prevention: `invalidateHomePageCache(pageId)` must be called from any route that mutates a page's type or structure. Server log `bookworm.log` was last written 4/9 PM — current server on port 8001 was started fresh by user (writing to terminal, not log file), so it already had the correct Python code and only needed the DB fix + hard refresh. |
| 2026-04-10 | **Bug: new non-dashboard pages showed 'Add your first widget'.** Root cause: user was picking the type-matching emoji (e.g. 📡) directly via the emoji picker WITHOUT clicking the page-type card button in the hp-modal grid. The emoji picker sets hp-emoji only; hp-page-type hidden input stayed at its default 'dashboard', so page was always saved as dashboard regardless of emoji. Page 65 (name 'sdfsd', emoji 📡) confirmed as affected — page_type corrected from 'dashboard' to 'rss' via direct SQLite UPDATE. Fix: hooked pickEmoji() in index.html to call selectPageType(matchedType) whenever the chosen emoji matches one of the HP_TYPE_DEFAULTS entries (📊→dashboard, 👥→crm, 📅→media, 🎨→grid_builder, 🖼️→uploads, 📡→rss). Guard: only fires when _pickerInput === 'hp-emoji' so workspace emoji pickers are unaffected. templates_env.py touched to force uvicorn reload + fresh static_v. |
| 2026-04-10 | **RSS compact "Feed label bubbles" toggle was visually invisible — two contrast bugs + same-label disambiguation.** Three stacked issues in `home-widget-rss.js`: **(1) `_rssFeedContainer` border opacity too low** — `border-color:${c}44` (27% opacity) and `color:${c}` for header text meant yellow (#e4de1b) borders and text were essentially invisible on white (~1.2:1 contrast ratio, WCAG needs 4.5:1). Result: bubble mode looked identical to flat list mode. Fix: border now `1px solid ${c}33` + `border-left:4px solid ${c}` (thick left accent, full opacity — always visible even for yellow). Header text uses new `_rssTextOnWhite(hex)` which computes perceived luminance; if > 160 (too light for white bg) falls back to `#374151` dark gray so text is readable while the dot/border stay in the accent color. **(2) `_rssBadgeDot` same contrast bug** — colored text invisible for light accents. Fix: text now uses `_rssTextOnWhite()`, badge gets a tinted pill background (`${c}22`) to give shape/visibility regardless of accent brightness. **(3) Both feeds labeled "Youtube"** — even with working bubbles, both containers had identical headers. Fix: `_rssFeedContainer` extracts the last URL path fragment (e.g. `@StephanieSoo`, `@DBTechYT`) as a gray subtitle when it differs from the user-defined label. Files: `static/js/home-widget-rss.js`. `templates_env.py` comment touched to bust static_v on next restart. |
| 2026-04-10 | **RSS compact label bubbles — third and final pass (root-cause fix).** Two deep bugs found via DB/code audit: **(1) feeds.map normalised labels before fetch** — URL-domain fallback (www.youtube.com) was applied eagerly, so feed_title from the RSS response (e.g. 'StephanieSoo', 'DBTechYT') was silently discarded. Fix: feeds.map now only assigns colors + _feedIdx; final label resolved in results.forEach using priority: user-set label > feed_title > URL fragment. **(2) feedWrap grouped by _label** — two YouTube channels share domain www.youtube.com, so all items landed in one container instead of two separate labelled bubbles. Fix: added _feedIdx (stable integer feed array index) as per-item group key; feedWrap now groups by it._feedIdx and maps with groups[f._feedIdx]. **(3) Non-dashboard pages showed widget canvas** — fix injected as Jinja2 gate inside home_page.html (after last endmacro), server-restart-proof: reads page.page_type from SELECT* dict, sets page_type = _pt, includes home_page_coming_soon.html for non-dashboard types; normal canvas wrapped in else...endif. Files: static/js/home-widget-rss.js, templates/partials/home_page.html. |
| 2026-04-10 | **Phase 1 — Homespace page types infrastructure shipped.** Added `page_type` column to `home_pages` (migration via `_migrate_once.py` since reload didn't trigger `init_db`; column confirmed in live DB). `PAGE_TYPES` frozenset guards valid values in `home_db.py`. `create_home_page` + `duplicate_home_page` carry `page_type`. `POST /home/pages/create` accepts `page_type` form field. `home_page_view` routes non-dashboard types to `partials/home_page_coming_soon.html` — rich "coming soon" card with per-type feature list, gradient strip, and planned feature checklist. `hp-modal` expanded to `max-w-lg` with 3×2 type picker grid (Dashboard/CRM/Media/Grid Builder/Uploads/RSS); selecting a type auto-swaps emoji + placeholder. Rename modal hides type picker. `submitHpModal` passes `page_type`. Sidebar shows blue pill badge for non-dashboard pages. Layout-settings button hidden for non-dashboard pages. Server confirmed running on **port 8001** via `python main.py` (reload=True). DB migration run directly. JS cache-busted by touching static files. |
| 2026-04-10 | **RSS compact style: label bubbles redesigned + feed container setting added (then consolidated).** (1) Removed `_rssBadgeBubble` — YAGNI. `_rssBadgeDot` now uses **feed color for text** (colored dot + bold colored name). (2) New `_rssFeedContainer(feed, items)` helper — wraps all items from one feed in a rounded border card with colored header (dot + bold name + subtle tinted bg). (3) Settings panel: replaced the two-field `compact_bubbles` + `compact_label` combo with a single **`compact_label`** dropdown — three states: `'1'` = dot+text per row, `'wrap'` = bubble each feed, `'0'` = hidden. Files: `static/js/home-widget-rss.js`, `templates/partials/home_page.html`, `static/js/home-widgets-settings.js`. |
| 2026-04-11 | **Uploads page: drag-and-drop upload modal + BookWorm-styled delete confirmation.** **(1) Upload modal** — replaced bare `<label>` file picker with a full modal (`uploads-modal-backdrop`): dashed drop zone (`ondragover`/`ondrop`), animated icon ring on drag-hover (`pointer-events:none` on children prevents dragleave flicker), "or" divider, "Browse Files" secondary button, per-file progress bar (`upl-progress-bar`) with `Uploading N of M — filename` label, auto-dismiss 900 ms after last file. Escape + click-outside close. JS: `uplOpenUploadModal`, `_uplCloseModal`, `_uplDropZoneActive`, `_uplDropped`, `_uplProcessFiles` (replaces old `uplHandleFileInput` label-innerHTML hack). Hidden file input wired via `addEventListener` in `initUploadsPage`. **(2) Delete confirmation modal** — removed native `confirm()` call; added `upl-del-modal` in template matching `del-widget-modal` / `del-contact-modal` style (red ⚠️ icon in `bg-red-100` circle, bold title, filename callout span, Cancel secondary + Delete File `bg-[#ea1100]` primary). JS: `_uplConfirmDelete(id)`, `_uplCancelDelete()`, `_uplDoDelete()`; `_uplDelPending` state variable; ESC handler in `initUploadsPage` closes both modals. **(3) Phase 2 audit** — confirmed all Phase 2 items already shipped: WebP conversion, tags, detail panel, server-provided counts, file delete. No Phase 3 defined. |
| 2026-04-11 | **RSS Reader feed-rename bug + toast style fix.** Root cause of "Could not save changes" on feed rename: auth middleware issues 302 redirect on session expiry; `fetch()` follows it automatically, landing on login HTML as 200 OK. JS was checking `r.status === 401` (never fires after redirect). Fixed by checking `r.redirected` instead in `rssUpdateFeed`, `rssDeleteFeed`, and `rssAddFeed`. Toast `_rssToast` rewritten to match `_showReminderToast` style: progress bar that shrinks over 6 s (Walmart red/green), SVG × close button, bold uppercase category label ("Error"/"Saved"), slide-out animation on dismiss, `items-start` layout. |
| 2026-04-11 | **RSS Reader: category filter upgraded from sidebar pills to full-width top bar.** `#rss-cat-pills` sidebar strip and `_renderCatPills()` removed entirely. New `<div id="rss-top-cat-bar">` full-width filter bar added between page title and 3-column layout in `home_page_rss.html`. `_renderTopCatBar()` added to `home-page-rss.js` — called at end of `_renderFeedList()` and in the no-feeds early-return path; hidden when no categories exist. Zero new endpoints, zero DB changes. Template audit + QA + pre-commit all green. |
| 2026-04-11 | **RSS Reader JS full rewrite — category grouping, inline feed editing, sort/filter controls + `_health_check.py` port fix.** `static/js/home-page-rss.js` fully rewritten. Three new UX features added: **(1) Category grouping in sidebar** — feeds grouped by `rss_page_feeds.category` field; each group is a collapsible section; ungrouped feeds fall into an unlabelled bucket. **(2) Inline feed editing** — label, color, and category are now editable in-place per feed row via new `POST /home/rss-reader/{page_id}/feeds/{feed_id}/update` endpoint (`label`, `color`, `category` form fields; persists via `update_page_feed()` in `home_rss_db.py`). **(3) Sort + filter controls** — sort toggle (newest/oldest) and filter selector (all/unread/read) rendered above the article list; state kept in JS, no server round-trip. **`_health_check.py` port corrected 8000 → 8001** to match `restart.ps1` — previously the standalone health-check script was smoke-testing the wrong port. `rss_page_feeds.category TEXT NOT NULL DEFAULT ''` migration was applied to live DB and already documented in schema. |
| 2026-04-11 | **RSS Reader: category pills, widget-source badge, widget-deletion unlink (3 features).** **(1) Category filter pills** — `<div id="rss-cat-pills">` strip above feed list in `home_page_rss.html`. `_renderCatPills()` added to `home-page-rss.js`; called at end of `_renderFeedList()` and early-return path; hidden when no categories exist. **⚠️ Later superseded:** sidebar pills promoted to a full-width top bar (`#rss-top-cat-bar`, `_renderTopCatBar()`) and removed — see next entry. **(2) Widget source badge** — new `source_widget_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL` column in `rss_page_feeds` (idempotent migration in `database.py`). New `_build_widget_sources(feeds, uid)` async helper in `routers/home.py` builds `{feed_id: {widget_label, page_name, page_emoji}}` lookup from a per-widget DB query loop (N+1, tracked as tech debt — acceptable at current feed counts). Template injects `<script>var _rssWidgetSources = {{ widget_sources | default({}) | tojson | safe }};</script>`. `_feedRow()` in `home-page-rss.js` renders 📌 badge when entry exists. **(3) Widget deletion → feed unlink** — zero extra Python needed; `ON DELETE SET NULL` FK + `get_db()` `PRAGMA foreign_keys = ON` handles it automatically; comment added to `del_widget` in `routers/home.py`. Updated functions: `get_page_feeds`, `add_page_feed`, `sync_widget_feeds_to_rss_pages`, `get_all_rss_widget_feeds` in `home_rss_db.py`; `get_all_rss_widget_feeds` in `home_db.py`; `add_widget_handler`, `update_widget`, `home_page_view` (rss branch) in `home.py`. |
| 2026-04-07 | **Server restarted (was down on port 8000). New static_v = 1775577806.** Fixed JS SyntaxError in `home-widgets-settings.js` line 151 — `\'` inside `${}` template expression is invalid; changed to plain `''`. `\\'` (escaped single-quote) inside a template-literal `${}` expression is invalid JS — the `${}` block is plain JS, not a string context, so no escaping is needed. Changed `f.placeholder||\\'\\'` → `f.placeholder||''`. One-char fix, zero drama. |
| 2026-04-06 | **Replaced banner `noir`/`velvet` + full sticky note widget restyle.** Banner: `noir` → `oversize` (massive 2.8rem bottom-anchored title, fine-print subtitle, editorial bleed), `velvet` → `slate` (dark-slate `#1e293b`, ultra-thin `font-weight:200`, wide `0.3em` letter-spacing, short `#0053e2` rule accent). Final banner set: `cinema`, `oversize`, `slate`, `infrared`, `studio`, `editorial`, `dusk`, `amber`. Sticky note widget: scrapped all 5 pastel+border-left styles (`yellow/pink/blue/green/lavender`). Replaced with 5 fully distinct surface styles — `paper` (warm cream with CSS ruled lines), `grid` (graph paper: dual-direction faint blue CSS grid), `kraft` (brown craft paper gradient), `chalk` (dark chalkboard green, off-white text), `memo` (clean white/dark with inline MEMO label + divider). Each style has its own `txtcls` text-color variable. `memo` and `chalk` render conditional inline elements above the content div. All dark-mode variants defined in CSS. Files: `home-widgets.js`, `home_page.html`. Health check: all green. |
 

---

## 🐙 GitHub Repository (added 2026-05-13)

BookWorm is published at: **https://github.com/t0n003c/bookworm**

- **Branch:** `main` (tracking `origin/main`)
- **Remote:** `https://github.com/t0n003c/bookworm.git`
- **GHCR image:** `ghcr.io/t0n003c/bookworm:latest` (auto-built by GitHub Actions on every push to `main`)

### Push workflow for future sessions
Every time we make changes, Eddie commits + pushes like this:

```bash
git add -A
git commit -m "feat/fix/chore: description"
git push        # no extra args needed — upstream is already tracked
```

That's it. GitHub Actions then auto-rebuilds the Docker image.

### Pre-push checklist (Eddie must do this every session before pushing)
1. **No hardcoded internal config** — no Walmart proxy URLs, no `t0n003c` username, no internal hostnames.
2. **No new packages imported without adding to `requirements.txt`** — check for lazy imports too (grep the whole routers/ dir).
3. **`.gitignore` / `.dockerignore`** — any new local-only dev files get added before committing.
4. **`git grep` clean check** — `git grep -l 'sysproxy' HEAD` and `git grep -l 't0n003c' HEAD` must return zero results.
5. **Import smoke test** — `cmd /c ".venv\Scripts\python.exe _import_check.py"` (create the 2-liner, run it, delete it).

### Pre-push security scrub (2026-05-13 — what we fixed before first push)
- `routers/home.py` — `_PROXY` was hardcoded to `sysproxy.wal-mart.com:8080`. Now reads `BW_HTTP_PROXY` env var (empty default = direct internet).
- `routers/notes.py` — SSL verification was disabled to bypass Walmart CA. Restored `ssl.create_default_context()`.
- `rebuild_css.bat` — Tailwind download URL pointed at Walmart Artifactory. Changed to canonical GitHub releases URL.
- `CODEPUPPY_NOTES.md`, `AGENTS.md`, `CLAUDE.md`, `PLAN*.md` — removed from git tracking (`git rm --cached`), permanently gitignored.
- `_start_server.py`, `_health_check.py`, `_seed_trip_data.py`, `restart.bat/.vbs` — same treatment.
- `static/img/buds/Tinh1.png` — personal named asset (PII), removed from tracking.
- `pdf2docx==0.5.12` + `PyMuPDF==1.27.2.2` — were missing from `requirements.txt` despite being used (lazy import in `home_uploads_docs.py`). Added.

---

## Session Log - 2026-05-13 (Grid Mobile Touch Fix)

| Date | Summary |
|---|---|
| 2026-05-13 | **Grid page mobile touch UX - full Android fix (5 commits).** User reported drag-to-reorder and edge-scroll broken on real Pixel phone. Root causes found in home-page-grid-touch.js and home-widgets.js. (1) Sidebar ghost invisible: #dnd-ghost had left/top set but no position property; it sat in document flow. Fixed by injecting position:fixed + pill styling via pg-dnd-touch-style sheet. (2) Grid scroll frozen on Pixel: canvas touchstart was passive:true. Android Chrome treats passive as an irrevocable contract - compositor starts GPU scroll immediately and ignores any later preventDefault() in touchmove. DevTools emulator uses mouse-simulated touch (main thread only) so it worked there. (3) Edge-scroll writing to wrong element: #grid-scroll-area has overflow-y:auto but never scrolls because its grandparent #detail-panel has no height (h-full on grid-page-root resolves to 0). Real scroll container is aside#panel (class panel-scroll). Fixed: _tpScrollEl() walks DOM from #grid-canvas upward to find first ancestor with overflow:auto/scroll AND scrollHeight > clientHeight. (4) Synchronous edge-scroll did not render: replaced scrollTop += inside touchmove (compositor defers these until touchend) with setInterval at 16ms. Interval fires between touch events where compositor accepts DOM writes at vsync. (5) Real-device inconsistency final pass: (a) preventDefault() in touchstart is irrevocable on Android; vertical swipes were frozen. Removed it; slop-zone logic in touchmove holds compositor off during classification instead. (b) Pre-arm slop 8px to 12px to handle real finger drift (skin + OS smoothing cause 10-15px drift). (c) getComputedStyle() on every 16ms tick caused forced reflow jank on mobile; scroll element now cached in _tpScrollCache at drag-start, cleared in _tpReset(). Added _tpSuppressClick flag (600ms TTL) to block post-drag synthetic clicks without killing real taps. Commits: 2527ebf, 4190685, 483d93e, c7ca31f, 97b09f4. KEY LESSON: Chrome DevTools emulator is not real Android - passive:true, compositor timing, getComputedStyle reflow cost, and finger drift are all invisible in the emulator. |

---

## 🔑 Key Lesson: Android Chrome UA Stylesheet vs CSS Classes

**Problem:** Tailwind classes like `min-w-0`, `w-full`, `flex-1` on `<input>` elements
work fine in Chrome DevTools mobile emulation but fail on real Android Chrome.

**Root cause:** Android Chrome's UA stylesheet enforces a minimum intrinsic width on
`<input>` form controls at *higher specificity* than any CSS class. Classes lose.

**Fix:** Use inline `style=` attributes for layout constraints on inputs inside widgets:
- Flex inputs that must shrink: `style="min-width:0;width:0;flex:1 1 0%"`
- Block inputs that must not overflow: `style="max-width:100%"`
- Always add `overflow-x-hidden` to the widget container as an outer hard clip

**Rule:** If a mobile layout bug passes DevTools emulation but fails on a real device,
check whether the element is a form control (`<input>`, `<select>`, `<textarea>`).
If so, move the critical layout constraints from classes to inline styles.

---

## Session Log - 2026-05-13 (HTTPS Hardening + Buds UX + Mobile Settle-Up Fix)

| Date | Summary |
|---|---|
| 2026-05-13 | **HTTPS hardening — HSTS header, explicit same_site, proxy startup log (commits 7afc672).** Full HTTPS audit of the Cloudflare Tunnel + nginx Proxy Manager stack. All-clear findings: middleware order correct (ProxyHeadersMiddleware outermost so scheme is fixed before SessionMiddleware validates Secure cookies), thumbnails proxied via /home/img server-side, no ws:// WebSockets, WOPI URL is server-to-server only. Three gaps fixed: (1) `_SecurityHeadersMiddleware` now emits `Strict-Transport-Security: max-age=63072000; includeSubDomains` when `BW_HTTPS=true` — class-level constant, zero per-request overhead. (2) `SessionMiddleware` now has explicit `same_site="lax"` — was already the Starlette default but now pinned so a future upgrade can't silently change it. (3) `routers/home.py` logs the resolved outbound proxy at startup with credentials masked — critical because Docker can silently inject `HTTP_PROXY` from the host, breaking all RSS/weather/image fetches with no visible error. `BW_HTTPS` env-var table row updated in notes. |
| 2026-05-13 | **Buds widget full style — removed 3-dots menu button (commit d6bd60a).** The `⋮` (U+22EE vertical ellipsis) edit/delete popup button was removed from the full-style bud card in `home-widget-buds.js`. Detail/edit panel still accessible by tapping the bud image. |
| 2026-05-13 | **Buds widget — "No Bud background" toggle in widget settings (commits 75f3096 + 9f5da09).** Added `no_card_bg` checkbox to `WIDGET_CONFIG_FIELDS.buds` in `home-widgets.js`. When enabled, strips `border bg-white dark:bg-zinc-800/60 shadow-sm rounded-xl` from the full-style card, leaving buds floating without a box. Two bugs found and fixed: (1) `_budsRender` read `el.dataset.config` (server-stamped page-load snapshot, never updated after save) instead of `card.dataset.widgetConfig` (kept live by `_saveWidgetFullConfig`). Fixed to read `el.closest(".hw-card").dataset.widgetConfig` with fallback — same pattern as subs-summary and upload-preview widgets. (2) `_saveWidgetFullConfig` had post-save re-render hooks for RSS, upload-preview, subs-summary — but nothing for buds. Added `_budsRender(wid)` call. Both bugs would have affected any future buds config field too. |
| 2026-05-13 | **Settle-up widget inputs — real Android Pixel overflow fix (commit 80d48ea).** Previous fix (Tailwind `min-w-0 overflow-hidden` classes) passed DevTools emulation but failed on physical Pixel because Android Chrome UA stylesheet enforces minimum intrinsic widths on form controls at higher specificity than any class. Three-layer fix applied: (1) `overflow-x-hidden` added to `.settle-up-widget` container in `home_page.html` — hard outer clip so nothing escapes the card boundary. (2) Add Person `<input>` — inline `style="min-width:0;width:0;flex:1 1 0%"` replaces class-only approach — inline style beats UA stylesheet. (3) Expense Description + Amount `<input>` — `style="max-width:100%"` added inline. Pattern documented as key lesson above. |

---

## Session Log - 2026-05-28 (Push Badge Fix + RSS Read-State Cap + Perf)

| Date | Summary |
|---|---|
| 2026-05-28 | **Android push notification badge — monochrome icon + full payload wiring (commit `4db3d88`).** Root cause: Android status-bar badge icons must be monochrome white-on-transparent; the previous icon was full-colour and rendered as a solid-colour blob. Fix: `bw_pwa_icons.py` generates a proper 96×96 monochrome `badge-96.png` (white circle on transparent background). `main.py` startup call updated to use new generator. `routers/push.py` payload now includes `badge`, `icon`, and `image` fields. `static/js/sw.js` `showNotification()` call wired to pass all three fields from the push data. Files changed: `bw_pwa_icons.py` (+58/-16), `main.py` (+22/-8), `routers/push.py` (+2/-1), `static/img/icons/badge-96.png` (new binary), `static/js/sw.js` (+2/-1). |
| 2026-05-28 | **Perf: B-tree index on `notes` table + RSS read-state capped to 10/feed (commit `e5b6a78`).** Two independent performance fixes. **(1) Notes index:** `CREATE INDEX IF NOT EXISTS idx_notes_ws_date ON notes(workspace_id, meeting_date DESC)` added to `init_db()` in `database.py` — speeds up `search_notes()` WHERE/ORDER queries that scan by workspace. **(2) RSS read-state cap:** `rss_read_items` table gained a new `feed_id INTEGER REFERENCES rss_page_feeds(id) ON DELETE CASCADE` column (additive migration, idempotent). New index `idx_rss_read_feed ON rss_read_items(user_id, feed_id, read_at DESC)`. `mark_read()` in `home_rss_db.py` now accepts `feed_id` and runs a correlated DELETE after each upsert keeping only the 10 most-recent rows per (user, feed) pair. New startup helper `purge_old_rss_read_items()` in `home_rss_db.py`: deletes all legacy rows where `feed_id IS NULL` (pre-migration, untrackable) and trims every existing (user, feed) group to 10. Called in `lifespan()` in `main.py`. `home_rss.py` + `home-page-rss.js` updated to forward `feed_id` through the mark-read call chain. Files: `database.py` (+25), `main.py` (+2), `routers/home_rss.py` (+17/-3), `routers/home_rss_db.py` (+63/-4), `static/js/home-page-rss.js` (+32/-7). |
| 2026-05-28 | **Dev tool: `audit_syntax.py` + gitignore `audit_*.txt` (commit `e525875`).** New 25-line dev-only script `audit_syntax.py` that walks the `routers/` and `static/js/` directories checking Python files for common issues (bare except, missing await, etc.) and writes a report to `audit_<timestamp>.txt`. Added `audit_*.txt` to `.gitignore` so output files are never committed. Not wired into any CI — run manually when needed. |
| 2026-05-28 | **PWA platform analysis — Mac Safari desktop gap documented (this session, no code change).** Full audit of `_initInstallBanner()` in `home-page-pwa.js` against all platforms. Key finding: Mac Safari desktop silently gets NO install banner — `_isIos()` returns `false` (UA has no iPhone/iPad, `maxTouchPoints === 0`) and `beforeinstallprompt` never fires on Safari. macOS Sonoma 14+ CAN install via File → Add to Dock but users get zero in-app guidance. Chrome/Edge on Windows and Mac are identical — `beforeinstallprompt` fires, standard banner shown. `_isInstalled()` (via `display-mode: standalone` media query) works on all platforms post-install. `navigator.standalone` is iOS-only, always `undefined` on desktop. The `apple-mobile-web-app-*` meta tags are iOS-only and have no effect on Mac desktop Safari. Two improvements identified but not implemented: (1) Mac Safari branch in `_initInstallBanner()` to show File→Add to Dock instructions; (2) populate manifest `screenshots` for richer Chrome install prompt. |

---

## Session Log - 2026-05-29 (Note Editor UX + Uploads Grid Perf)

| Date | Summary |
|---|---|
| 2026-05-29 | **Note editor — Preview-first default + button reorder + autocapitalize (commit `ed0e941`).** Three UX changes to `templates/partials/note_form.html` and `templates/index.html`. **(1) Default mode `preview`:** `_mode` initialised to `'preview'` so notes open rendered, not as raw Markdown. **(2) Button order:** Toolbar reordered to `Preview | Split | MD` (was `MD | Split | Preview`). **(3) Autocapitalize after numbered list in textarea (MD/Split modes):** `autocapitalize="sentences"` on `<textarea>` for native mobile. JS `keydown` listener detects Enter on a numbered-list line (`/^\d+\.\s/`), checks the previous line ends with a sentence-ender (`. ! ?`), sets `_pendingCap` flag; a one-shot `keypress` listener capitalises the first character typed and removes itself. |
| 2026-05-29 | **Fix: auto-capitalize after numbered list in contenteditable/Preview mode (commit `edb6bc6`).** Extended numbered-list autocapitalize to the contenteditable div. `keydown` listener uses `Selection.getRangeAt(0)` to find the enclosing `<li>`, checks its text ends with a sentence-ender, sets `_pendingCapCE`; one-shot `keypress` listener calls `document.execCommand('insertText', false, ev.key.toUpperCase())` and `ev.preventDefault()`. |
| 2026-05-29 | **Fix: exclude grip `<span>` from empty-li check in Preview autocapitalize (commit `88b48c7`).** The drag-handle `<span class="bw-li-grip">` inside every `<li>` was being counted as child content, making every list item appear non-empty and causing autocapitalize to always skip. Fix: empty-li check now filters out `SPAN` nodes before evaluating whether the `<li>` is empty. One-line change in `note_form.html`. |
| 2026-05-29 | **Feat: vertically center weather widget content within card (commit `42518bc`).** The weather widget content wrapper `<div>` in `templates/partials/home_page.html` was top-aligned inside its flex card. Added `flex-1 flex flex-col justify-center` so weather icon, temperature, and condition text sit centred vertically regardless of card height. One-line change. |
| 2026-05-29 | **Feat: upload detail panel — friendly file type label + raw byte count (commit `35f57da`).** `static/js/home-page-uploads-tags.js` extended with `_uplFriendlyType(mime, ext)` — maps MIME types/extensions to human-readable labels (`"JPEG Image"`, `"PDF Document"`, `"MP4 Video"`, `"Python Script"`, etc.). Detail panel in `home-page-uploads.js` now shows `"JPEG Image — 2,457,832 bytes"` alongside the existing formatted size (`"2.4 MB"`). |
| 2026-05-29 | **Perf: image thumbnail endpoint + 2048 px dimension cap on upload (commit `094e927`).** Three-part fix for slow image loading in the uploads grid. **(1) Upload pipeline cap (`routers/home_uploads.py`):** WebP conversion now calls `img.thumbnail((2048, 2048), Image.LANCZOS)` before `img.save(quality=82)` — reduces typical phone photos (4032×3024, ~11 MB) to ~1–3 MB. Applies to future uploads; existing large files handled by (2). **(2) On-demand thumbnail endpoint (`main.py`):** New `GET /uploads/thumb/{filename:path}?w={int}` route registered *before* the catch-all `/uploads/{filename:path}` so Starlette matches it first. Ownership-verified via `get_upload_owner()`. Pillow resizes — only shrinks, never upscales. Disk-caches to `UPLOAD_DIR/_thumbs/{w}/{filename}.webp`; regenerates when source mtime > cache mtime. Served with `Cache-Control: public, max-age=31536000, immutable`. Non-image files fall through to a plain `FileResponse`. **(3) JS (`static/js/home-page-uploads.js`):** Grid card `<img>` sources `/uploads/thumb/{filename}?w=400`. Detail panel preview sources `?w=800`. Lightbox `onclick` keeps full `/uploads/{filename}` for high-quality expand. |


---

## Session Log - 2026-05-25 (CRM Address Field + Reminder Type + Nominatim Autocomplete)

| Date | Summary |
|---|---|
| 2026-05-25 | **Grid cells use `thumb_url` + onerror fallback (commit `18c661e`).** `home-page-grid.js` cell renderer was using `cell.url` as the `<img src>` even when a pre-generated WebP thumbnail existed. Changed to `cell.thumb_url||cell.url` so the small thumbnail is loaded first (fast), with an `onerror` handler that falls back to the full-res URL if the thumbnail is missing or broken. No backend change — `thumb_url` was already present in the API response. |
| 2026-05-25 | **CRM: Address default field — DB migration + backend + frontend (commit `5f58a34`).** Additive migration: `ALTER TABLE crm_contacts ADD COLUMN address TEXT NOT NULL DEFAULT ''` (idempotent; existing rows silently get `''`). `home_crm_db.py`: `add_contact()` and `update_contact()` each gained an `address` parameter. `home_crm.py`: both `create_contact` and `edit_contact` endpoints expose `address = Form("")`. `home-page-crm.js`: Address renders as a flat-underline single-line input below Company in the default 2-col grid (`col-span-2`). |
| 2026-05-25 | **CRM: Mobile add-field button overflow fix (commit `5f58a34`).** The `#crm-af-form` row inside the contact modal was `flex gap-2 items-center` — all three controls (Field Name, Type select, Add button) on one line. On phones narrower than ~360 px the Add button was clipped off-screen. Fixed by switching to `flex-col`: Field Name input gets its own full-width line; Type select (`flex-1`) and Add button (`flex-shrink-0`) share the second line. Button now always reachable. |
| 2026-05-25 | **CRM: Reminder custom field type — full end-to-end (commits `5f58a34`, `7f33586`).** New `reminder` field type wired from DB to UI to push. DB: `upsert_field_reminder()` does delete-then-insert on `(contact_id, field_id)` so saving a contact twice never creates duplicate rows; `clear_field_reminder()` removes the row when date is cleared. API: `POST /crm/{pid}/contacts/{cid}/field-reminder` (upsert) + `POST /crm/{pid}/contacts/{cid}/field-reminder/{fid}/clear`. Frontend: field renders Date + Time + Repeat + optional Message sub-inputs inline in the contact modal; `crmSyncRemVal()` keeps a hidden JSON input in sync; `crmSaveContact()` runs a second `Promise.all` to upsert or clear the reminder row. Rows land in `crm_contact_reminders` — zero extra wiring: 30 s poll, top-bar missed-reminders banner, and push all fire automatically. Bug fixed same session: `VALID_TYPES` in both `create_field` ANeld` was missing `'reminder'`; `edit_field` was also missing `'priority'` (bonus fix). |
| 2026-05-25 | **CRM: Address autocomplete via Nominatim — no API key (commits `7f33586`, `c9eb9a6`, `234bcc9`).** Replaced static `<textarea autocomplete=street-address>` with a live-search widget. 400 ms debounce, 4-char min, fetches `nominatim.openstreetmap.org/search?format=json&limit=6`, renders up to 6 suggestions in a keyboard-navigable `<ul>` (Up/Down/Enter/Esc), 200 ms onblur delay so mousedown on a suggestion registers first. `_crmAddrFormat()` cleans every result: (1) compass abbreviation — longest compound first (Northwest→NW, Northeast→NE, Southwest→SW, Southeast→SE, then North/South/East/West→N/S/E/W) to avoid partial-match corruption; (2) county/parish/borough/township segments stripped via word-boundary regex; (3) bare house number (`/^\d+[A-Za-z]?$/`) joined to next segment with a space — Nominatim sometimes emits `"123, Main Street, …"`. Pre-formatted into `item._fmt` at fetch time so dropdown label and picked value are always identical (DRY). All three transforms covered by a Python regression suite run before each commit. |
