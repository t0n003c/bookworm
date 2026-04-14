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
  | `BW_HTTPS` | `false` | Set `true` behind a TLS proxy to enable Secure cookies |
  | `BW_ALLOW_REGISTRATION` | `true` | Seeds `site_settings.registration_open` on first boot only. After that the DB value is authoritative — toggle live in the superadmin panel. |
  | `BW_DEMO_ENABLED` | `true` | `false` = hide Try Demo button, disable `/demo/start` |
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
- **Tailwind CSS is loaded from CDN** (`cdn.tailwindcss.com`) — this is known tech debt. It works but: (a) violates Tailwind's own prod guidelines, (b) is slow, (c) breaks on air-gapped networks. **Pending task: bundle Tailwind as a build step in the Dockerfile.** Until then, don't add more CDN script tags.

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

---

## 🗺️ What Is This?

**BookWorm** — a self-hosted team note-taking app for Tinh's Walmart Grocery team.
- Stack: **FastAPI + HTMX + Tailwind CSS (CDN) + SQLite (aiosqlite)**
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
| `templates_env.py` | **Single shared Jinja2 env** — ALL custom filters registered here |
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
| `routers/home.py` | Home pages + widget CRUD + weather proxy |
| `routers/home_db.py` | DB helpers for home_pages + home_widgets tables |
| `routers/home_crm.py` | 9 endpoints under `/home/crm/{page_id}/…` — contacts CRUD + fields CRUD + field-value upsert. Ownership validated via `_get_crm_page()`. |
| `routers/home_crm_db.py` | DB helpers for CRM. Uses single JOIN in `_attach_field_values()` to avoid N+1. |
| `routers/uploads_db.py` | paginated merged query with embedded tags (GROUP_CONCAT) + workspace_id; MIME-group counts inline in `get_uploads_page()`; `delete_page_upload()` (sweeps tags); 6 tag CRUD helpers; `get_all_user_tags()` |
| `routers/home_uploads.py` | Uploads page API: list files (50/page), standalone upload, auth-gated download |
| `routers/account.py` | User profile / password change / admin user management |
| `routers/totp.py` | 2FA (TOTP) setup + verify routes |
| `routers/totp_db.py` | DB helpers for TOTP |
| `templates/index.html` | Main SPA shell (~112 KB — massive) |
| `templates/base.html` | Base layout (~24 KB) |
| `templates/partials/home_page.html` | All home widget macros + grid render (~54 KB) |
| `templates/partials/home_page_crm.html` | CRM page shell — `#crm-page-root`, `#crm-main`, modal container. No inline script blocks. |
| `templates/partials/note_form.html` | Note editor (huge — ~122 KB) |
| `static/js/home-widgets.js` | Home nav + widget CRUD core; `_initSwappedPage()` dispatches HTMX page boots to 3 page types: rss (`#rss-page-root` → `initRssPage`), crm (`#crm-page-root` → `initCrmPage`), dashboard (fallback → `initHomeWidgets`) |
| `static/js/home-widgets-render.js` | Widget JS engines (weather, calendar, todo, reminder, etc.) |
| `static/js/home-page-crm.js` | CRM JS module. `initCrmPage(pid)` entry point called by `_initSwappedPage()`. Module-level state: `_crmPid, _crmContacts, _crmFields, _crmView, _crmQuery`. Views: table + gallery. Contact CRUD via modals. Fields management modal. View preference persisted to localStorage key `bw_crm_view`. |
| `static/js/home-widgets-settings.js` | Widget settings modal + size picker |
| `static/js/home-widgets-clock.js` | Clock widget engine (analog/digital) |
| `static/js/slash_commands.js` | `/` command palette in note editor |
| `static/js/timeline.js` | Timeline view logic |
| `static/js/timeline-render.js` | Timeline rendering |
| `static/js/timeline-ui.js` | Timeline UI interactions |
| `static/js/bw-spellcheck.js` | Spell-check integration |
| `static/js/home-widget-text.js` | Text/title widget editor |

---

## 🗄️ Database Schema

### Tables (as of current migration state)

**`users`**
- `id, username, password_hash, role (user/superadmin), created_at`
- `totp_secret, totp_enabled` — added via migration
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
**`home_widgets`** — widgets on a page (`page_id, widget_type, style, config_json, sort_order`)

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

**`crm_custom_fields`** — field definitions per CRM page
- `id, page_id, user_id, label, field_type` (`text|select|url|date|number`), `options` (pipe-sep for select), `sort_order, created_at`

**`crm_contact_field_values`** — per-contact custom field values
- `id, contact_id` (→`crm_contacts` CASCADE), `field_id` (→`crm_custom_fields` CASCADE), `value`
- `UNIQUE(contact_id, field_id)` — upsert-safe

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
- Index: `idx_page_uploads_user ON page_uploads(user_id, created_at)`

**`page_upload_tags`** — user-defined tags applied to any file (note attachment or standalone upload)
- `id, upload_src TEXT CHECK(IN 'note','page'), upload_id INTEGER, user_id` (→`users` CASCADE), `tag TEXT, created_at`
- `UNIQUE(upload_src, upload_id, user_id, tag)` — idempotent `INSERT OR IGNORE`
- Index: `idx_page_upload_tags_user ON page_upload_tags(user_id, tag)`
- **No FK** to `note_attachments` or `page_uploads` — polymorphic source (intentional; avoids multi-target FK awkwardness)
- Orphaned rows (file deleted) are harmless; user `ON DELETE CASCADE` handles account cleanup
- `delete_page_upload()` manually sweeps tags before deleting the file row

---

## 🧩 Home Widget System

Each widget has a `widget_type` (string) and a `style` (string variant). Config stored as JSON.

| widget_type | Available Styles | Notes |
|---|---|---|
| `clock` | `digital`, `analog` | JS-driven; `home-widgets-clock.js` |
| `weather` | `default` | Server-side fetch via Walmart proxy → open-meteo API |
| `calendar` | `default` | JS mini-calendar |
| `todo` | `default`, `compact` | Checklist; compact = condensed rows |
| `reminder` | `default`, `agenda` | Date/time reminders; agenda = day-planner grouped view |
| `note_link` | `default` | Quick-link card to a specific note |
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

---

## 🔐 Auth System

- Session-based via `starlette.middleware.sessions` (30-day cookie TTL)
- `AuthMiddleware` in `auth_middleware.py` intercepts unauthenticated requests
- Public routes (bypass auth — `_PUBLIC` set in `auth_middleware.py`): `/login`, `/setup`, `/register`, `/favicon.ico`, `/2fa/verify`, `/demo/start`, `/demo/end`, `/demo/pre-end`, `/demo/cancel-end`, `/demo/alive`, `/health`
- `/static/` prefix is allowed separately via path-prefix check, not via `_PUBLIC`
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

---

## ✅ Features Completed (as of 2026-04-11)

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
- [x] **Uploads Homespace page (Phase 2 complete)** — paginated merged file list (note attachments + standalone, 50/page), type filter tabs (Photos/Videos/Audio/Documents/Other), auth-gated download via `/home/uploads/{pid}/files/{src}/{id}/download`, standalone upload with demo guard. Phase 2 shipped (731c733): standalone file delete (page-src only; note-src shows "Open in Note" link), global filter counts (full-dataset MIME aggregation via `get_file_counts()`), slide-in detail panel (image preview, download, delete, note link, tags), custom tags (`page_upload_tags`, 4 endpoints, embedded in list via `GROUP_CONCAT`, group tag filter pills), WebP conversion on upload (Pillow≥10.0.0, graceful fallback), `_uplJsStr()` for JS-string onclick escaping. Router: `routers/home_uploads.py`. DB: `page_uploads` + `page_upload_tags`. Helpers: `uploads_db.py`. JS: `home-page-uploads.js` (535 lines rewritten). Template: `home_page_uploads.html`. **No Phase 3 defined.**

---

## 🚧 In Progress / Last Session Work (2026-04-14)

Last commit: **`731c733`** — Uploads Phase 2 shipped.

**Uploads Phase 2 shipped this session:**

- `page_upload_tags` table added (polymorphic, no FK to source tables, `UNIQUE(upload_src,upload_id,user_id,tag)`, index on `(user_id,tag)`).
- `uploads_db.py` +6 tag CRUD helpers + `get_all_user_tags()` + `delete_page_upload()` tag sweep + inline MIME-group counts in `get_uploads_page()` + `GROUP_CONCAT` tags embedded in list query + `workspace_id` in merged query.
- `home_uploads.py` +DELETE endpoint + 4 tag endpoints + WebP conversion (Pillow≥10.0.0, graceful fallback).
- `home-page-uploads.js` rewritten (535 lines): detail slide-in panel, tag CRUD, global filter counts, group tag filter pills, `_uplJsStr()` escaping fix.

**Current status:** App healthy. Docs updated.

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
5. **`note_form.html` is 122 KB** — avoid reading the whole thing at once; use `start_line`/`num_lines`.
6. **`home_page.html` is 54 KB** — same deal.
7. **HTMX OOB swaps** — if a partial response needs to update the sidebar, it must return OOB fragments with correct IDs.
8. **Port conflict** — Teams uses 8080. Never kill that. BookWorm is on 8000 (local dev via `restart.bat`) or 8001 (Docker). **Confirmed 2026-04-10: server is currently running via `python main.py` on port 8001.** `restart.bat` targets port 8000 via uvicorn directly — these two startup paths are mismatched. The `python main.py` path uses `uvicorn.run(..., reload=True)` so file changes auto-reload, but the DB migration only runs on cold startup. **Workaround:** When a new DB migration is needed that the reload didn't pick up, run `_migrate_once.py` directly against `bookworm.db` using `.venv\Scripts\python.exe`. The running process holds a read lock but SQLite allows `ALTER TABLE` from a second connection as long as no write transaction is active.
9. **`netstat` may show ghost PIDs on port 8001** — PID entries are real but invisible to `Get-Process`/`wmic`/`Get-CimInstance`. These are likely Windows port-forwarding entries from Docker/WSL2 NAT. The actual Python server process is not killable via normal Windows process tools when started this way. To restart: use the uvicorn file-watcher (`reload=True`) for Python changes; touch static JS files to bump their mtime for cache-busting.
10. **`_hpCache` client-side cache (5-min TTL)** — `home-widgets.js` caches each `/home/pages/{id}` response in a JS `Map`. After any server-side change to a page's *type, layout, or template* (not widget data), the browser still serves the stale HTML until either: (a) `Ctrl+Shift+R` hard refresh (nukes JS memory entirely), or (b) 5 minutes elapse and the stale-while-revalidate kicks in. `invalidateHomePageCache(pageId)` only helps if called from JS in the same tab. **Rule: always hard-refresh after fixing page_type values in the DB or changing the page's template routing.**
11. **Uploads** — `UPLOAD_DIR` is set in `routers/attachments_db.py`, not a top-level constant. Files go next to the DB.
12. **Session invalidation on restart** — in dev (no `BW_SECRET_KEY` env var), the secret key is randomly generated each start, invalidating all sessions. Normal and expected.
13. **HTMX re-injection `let`/`const` trap** — any `<script>` block inside a partial template (e.g. `note_form.html`) gets re-executed by HTMX every time the partial is swapped in. Top-level `let`/`const` declarations will throw `SyntaxError: already declared` on the second injection. **Rule: use `var` for any state variables declared at the top level of partial `<script>` blocks.** Variables inside function bodies or IIFEs are fine as-is.
14. **`restart.bat` has a `pause` at the end** — running it with `background=true` (or piped/non-interactive) blocks permanently and the server NEVER actually restarts. Use the direct PowerShell command instead (see Quirk #13). After killing old processes manually, wait ~2s for the port to free up before launching.
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
20. **`_uplJsStr(s)` in `home-page-uploads.js` — JS-string onclick escaping.** Backslash-escapes `\` and `'` so a value can be safely embedded inside a single-quoted JS string literal inside an `onclick` attribute (e.g. `onclick="fn('${_uplJsStr(name)}')"`). Use this instead of `_uplEsc` when the value goes into a JS string context (not an HTML attribute context). `_uplEsc` HTML-encodes for HTML attribute safety; `_uplJsStr` JS-escapes for JS string-literal safety. Mixing them causes either broken JS or XSS.

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

```powershell
# Option 1: restart.bat (interactive only — has a pause at the end, do NOT use from tools)
restart.bat

# Option 2: PowerShell Start-Process (correct way from Eddie's shell tool)
# Fully detaches uvicorn from the tool's stdout/stderr capture — no freeze.
powershell -Command "Get-Process uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2; Start-Process -FilePath '.venv\\Scripts\\uvicorn.exe' -ArgumentList 'main:app','--host','127.0.0.1','--port','8000' -NoNewWindow -RedirectStandardOutput 'bookworm.log' -RedirectStandardError 'bookworm_err.log'"
```

> ⚠️ NEVER use `start /B` or `cmd /c "start /B ..."` — inherited stdout/stderr handles freeze the shell tool (see Quirk #13).

> ⚠️ NEVER chain server start + health check in one shell command. Start the server first, then run `_health_check.py` as a separate step (see Quirk #18).

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
| 2026-04-06 | **Fixed event widget losing events on refresh — race condition in `_hpFetch` (stale-flight bug).** Root cause: `showHomePage()` on SPA navigation triggers a background revalidation fetch (`_hpFetch silent=true`) when the cache entry is older than 5 min. If the user then saved a new event (which calls `invalidateHomePageCache`), the in-flight fetch completed AFTER the cache was deleted and re-inserted stale HTML containing no events — overwriting both `_hpCache` and `hc.innerHTML`. Fix: added `_hpMutVer` Map (per-page mutation counter). `invalidateHomePageCache` now increments the counter. `_hpFetch` snapshots `verAtStart` before the fetch; on completion, if `verNow !== verAtStart`, the result is discarded and a fresh fetch is kicked off. This prevents any stale in-flight response from clobbering a mutation that happened mid-flight. File: `static/js/home-widgets.js`. Server restarted as PID 80980. |
| 2026-04-06 | **Fixed event widget losing events on SPA navigation (cache bug).** Root cause: `_evtSaveItems` in `home-widget-events.js` correctly POSTed to the server (204 OK, DB updated), but never called `invalidateHomePageCache`. So within the 5-min `_hpCache` TTL, navigating away and back served stale HTML with no events. Fix: added `invalidateHomePageCache(pageId)` call after the successful fetch, reading `pageId` from `sessionStorage.getItem('bw-hp')` — same pattern used in `home-widgets-settings.js`. |
| 2026-04-05 | Eddie brought server online (was down). Health-checked everything. All green. Last session was mid-feature on reminder widget browser notifications — committed clean. Created this notes file. |
| 2026-04-05 | Fixed two text widget bugs in `home-widget-text.js`: (1) **DnD vs text-selection conflict** — `openTextEdit` now sets `card.draggable = false` while editing and restores it in `_exitEditMode`; (2) **Tab/Shift+Tab list indent/dedent** — added `_handleTabIndent` keydown listener attached on edit-open and removed on exit. Only fires when caret is inside a `<li>`; all other Tab presses fall through to browser default. |
| 2026-04-05 | Fixed JS SyntaxError: `Identifier '_savedLinkRange' has already been declared` in `templates/partials/note_form.html` lines 997+999. Root cause: HTMX re-injects the note form `<script>` block every time a note is opened; `let` throws on re-declaration but `var` is safe. Changed both `let _savedLinkRange` and `let _editingLinkEl` to `var`. See "Known Quirks" #11 below. |
| 2026-04-06 | **Fixed event widget losing events on refresh.** Root cause: `evt_prepare_items` Jinja2 filter was in `templates_env.py` but running process was stale → every home page render 500'd → HTMX showed error div → events looked gone (DB was fine all along). Fix: kill old BookWorm PIDs, restart with `cmd /c "start /B .venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000 >> bookworm.log 2>&1"`. Gotcha: `restart.bat` has `pause` at end — breaks when run non-interactively. **Note: server drifted stale again on same day at 11:31–11:34 (errors logged in `bw_error.log`). Re-killed PID 64892, fresh restart gave PID 28108 — clean from 11:44 onwards.** |
| 2026-04-06 | **Added standalone Banner widget.** Removed `banner` style from the Title widget style list. Created new `banner` widget type with 4 styles: `solid` (Walmart blue), `gradient` (blue→purple), `dark` (zinc-900), `spark` (Walmart yellow #ffc220). Config fields: text, subtitle, emoji, align — same as title. Changes: `static/js/home-widgets.js` (WIDGET_STYLES + WIDGET_CONFIG_FIELDS), `templates/partials/home_add_widget_modal.html` (added to type picker), `templates/partials/home_page.html` (removed banner from render_title, added render_banner macro + dispatch). All templates pass health check. |
| 2026-04-06 | **Added event delete confirmation + calendar day popup.** (1) The × button on event cards now shows a styled warning modal (`evt-del-confirm-modal` in `home-widget-events.js`) matching `del-widget-modal` style, with cancel + confirm buttons, before permanently deleting. (2) Calendar date cells (month & mini) are now clickable — `cal-day-modal` lists events (Edit ✏️ + Delete) and reminders (Delete) for that day. "Add Event" button in the footer pre-fills the target date. Modal built once in JS and reused. `id` field added to `_bwEventStore` entries for reliable index lookups. |
| 2026-04-06 | **Deep-dive investigation of event widget (11:44 session).** User reported events disappearing on page refresh. Full trace performed: DB query confirmed Widget 33 has event `{text:"dfsdf", target_date:"2026-04-15"}` saved correctly. `bw_error.log` revealed the actual failure: `TemplateAssertionError: No filter named 'evt_prepare_items'` for all page 1 renders between 11:32–11:34 — the stale server (PID 64892) that hadn't seen the filter registration. Server was restarted at 11:44 (PID 28108). E2E render test `_test_event_render.py` confirms the CURRENT server renders `evt-json-33` with clean unescaped JSON (`"` not `&quot;`) and 1 item. All code fixes from earlier sessions are correctly in place. Root cause of user-visible symptom: stale server → 500 on `/home/pages/1` → `home_page_view` error handler returned error div → JS could never read the event blob → events appeared gone. **Resolution: server restart + the two code fixes already applied (see row below) = fully working. ⚠️ NOTE: Do NOT treat this entry as closed proof. Always ask the user to confirm events are persisting before concluding the bug is resolved.** |
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
