# AGENTS.md

AI agent guidance for the BookWorm codebase.
**Always read `CODEPUPPY_NOTES.md` before touching any file.**

---

## Project Overview

**BookWorm** — self-hosted team note-taking app for Tinh's Walmart Grocery team.

- **Stack:** FastAPI + HTMX + Tailwind CSS (bundled, pre-built) + SQLite (aiosqlite)
- **Local dev:** `http://localhost:8000` via `.venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000`
- **Start/restart:** `cmd /c restart.bat` (Eddie-safe, polls 30 s) or double-click `restart.vbs` (silent)
- **Docker:** `docker compose up -d` → port **8001**
- **DB:** `bookworm.db` (local) | `/data/bookworm.db` (Docker via `BW_DATA_DIR`)
- **Health check:** run `_health_check.py` after any change

---

## Eddie-First Investigation Protocol

**For bug fixes and small changes — Eddie investigates BEFORE invoking any sub-agent.**
Sub-agents run expensive shell scans because they have no context. Give them context and
they become surgical. Follow this order every time:

```
1. Eddie reads the relevant files directly (read_file, grep)
2. Eddie diagnoses the root cause using those reads
3. Eddie writes the fix
4. Eddie passes pre-gathered evidence to sub-agents — never send a blank prompt
5. bookworm-qa / bookworm-pre-commit validate the finished change
```

### What "pre-gathered evidence" means in practice
When invoking any sub-agent, include in the prompt:
- **Exact files changed** (names + what was modified)
- **The root cause** Eddie already found
- **Relevant code snippets or error messages** already read
- **What to verify** — specific endpoints, functions, or behaviours to check

This cuts sub-agent shell commands from ~10 broad scans to 2-3 targeted ones.

---

## Agent Routing — Use These Automatically

### `bookworm-dev` 🎼 — complex / architecturally ambiguous tasks only
Invoke when: the scope is unclear, multiple files/systems are involved, or Eddie
cannot confidently identify the root cause after reading the obvious files.
**Do NOT invoke for straightforward bug reports** — Eddie reads and fixes those
directly, then goes straight to `bookworm-qa` + `bookworm-pre-commit`.

Good triggers: "the whole RSS page is broken", "auth seems wrong across multiple routes",
"I want to redesign the widget system".
Bad triggers: "this button shows an alert instead of an inline error" ← Eddie handles that.

### `bookworm-feature-planner` 📋 — before writing ANY new feature code
- Triggered by: "add a widget", "new feature", "build X for BookWorm"
- Produces a `PLAN.md` with exact files to touch, migration needs, and gotchas
- **Always plan before coding.** No exceptions.

### `bookworm-qa` 🧪 — after EVERY code change
- Triggered by: completing a feature, fixing a bug, before committing
- Hits all key endpoints, checks template rendering, scans error logs
- Reports green/yellow/red status

### `bookworm-db-migration` 🗄️ — any schema change
- Triggered by: adding tables, columns, constraints, or indexes
- All migrations go in `init_db()` in `database.py`
- Must be idempotent (safe to run 10× on a live DB)

### `bookworm-widget-scaffolder` 🧩 — adding a new home page widget type
- Triggered by: "new widget", "add X widget to home page"
- Touches: `home_page.html` macro, add-widget modal, `home-widgets.js`, optional JS engine, `templates_env.py` filters, DB migration if needed

### `bookworm-template-audit` 🔍 — after any template or JS change
- Triggered by: editing `templates/`, `static/js/`
- Catches: `let`/`const` in HTMX partials, missing `|safe` on `tojson`, missing `?v={{ static_v }}` cache-busting, broken `hx-target` IDs, unregistered Jinja2 filters

### `bookworm-pre-commit` ✅ — before EVERY commit or push
- Triggered by: "commit", "push", "ship it", "PR"
- Catches hardcoded secrets, raw `aiosqlite.connect()`, missing `rd()`, missing `_PUBLIC` entries, and more
- Non-negotiable — always run this before committing

### `bookworm-perf-detective` 🔎 — performance questions or slowness reports
- Triggered by: "slow", "N+1", "query performance", "indexing"
- Hunts N+1 patterns in router DB files, missing SQLite indexes, aggressive HTMX polling, expensive Jinja2 filter loops

### `bookworm-docs-keeper` 📝 — keep CODEPUPPY_NOTES.md in sync
- Triggered by: after schema changes, new filters registered, new widget types, new `_PUBLIC` routes
- Compares live code vs CODEPUPPY_NOTES.md and auto-updates stale sections
- Run at end of any significant session

---

## Critical Rules (Always Enforce)

### Database
- **ALL** DB access via `get_db()` in `database.py` — never raw `aiosqlite.connect()`
- Migrations in `init_db()` only — additive + idempotent
- SQLite table-swap dance for constraint changes (see CODEPUPPY_NOTES.md)

### Templates & JS
- **`var` not `let`/`const`** inside HTMX-reinjected partial `<script>` blocks
- **`tojson | safe`** — always `| safe` when dumping JSON into a `<script>` tag
- **`?v={{ static_v }}`** — always cache-bust `<script src>` and `<link href>` for app assets
- **Register ALL custom Jinja2 filters** in `templates_env.py` — nowhere else

### Auth & Security
- New public routes → add to `_PUBLIC` in `auth_middleware.py`
- New global-table write routes → add `_demo_guard(request)` check
- No hardcoded secrets, IPs, or internal Walmart hostnames — env vars only

### Config
- All config via `os.getenv("BW_*", default)` — never hardcoded
- New env var → update `.env.example` AND `docker-compose.yml` (no exceptions)

### Ports
- Local dev: **8000** | Docker: **8001** | Teams: **8080** (never touch)

### Server Start & Health Check (READ THIS — ignoring it causes Code Puppy to freeze or die)
- **NEVER** chain server-start + health check in one shell command with `&&`. The freeze: `urlopen` with no timeout blocks forever if the server is slow (OneDrive I/O, cold start).
- **NEVER** use `start /B` or `cmd /c "start /B ..."` to launch uvicorn — child inherits stdout/stderr handles, shell tool waits forever for them to close.
- **NEVER** call `urllib.request.urlopen(url)` without a `timeout=` argument.
- **NEVER** use `start /MIN .venv\Scripts\uvicorn.exe ... && ping -n N ... && urlopen(...)` — the `start /MIN` looks innocent but the chained `urlopen` with no timeout freezes Code Puppy the moment the server is slow.
- ☠️ **NEVER run `Get-Process -Name python | Stop-Process -Force`** — Code Puppy IS a Python process. This command kills Eddie's own session immediately. It happened. Don't do it again.
  - ✅ Safe alternative — kill by port: `$p = (netstat -ano | Select-String ':8000 ') | ForEach-Object { ($_.ToString().Trim() -split '\s+')[-1] } | Select-Object -First 1; if ($p) { Stop-Process -Id ([int]$p) -Force -ErrorAction SilentlyContinue }`
  - ✅ Safe alternative — kill uvicorn specifically: `Get-Process -Name uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force`

**✅ CORRECT — use `restart.bat` (safe for both Eddie and humans, no `pause`, polls 30 s):**
  ```
  cmd /c restart.bat
  ```
  This calls `_start_server.py` (properly detached, hidden window), then polls `/health` with `timeout=2` up to 30 times. Exits cleanly. No freeze risk.

**✅ CORRECT — PowerShell two-step (when you need explicit control):**
  ```
  # Step 1 — start (detached, logs to file)
  powershell -Command "Get-Process uvicorn -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2; Start-Process -FilePath '.venv\\Scripts\\uvicorn.exe' -ArgumentList 'main:app','--host','127.0.0.1','--port','8000' -NoNewWindow -RedirectStandardOutput 'bookworm.log' -RedirectStandardError 'bookworm_err.log'"
  # Step 2 — verify (polls with timeout=5, safe to run from tools)
  .venv\Scripts\python.exe _health_check.py
  ```

### Docker & GitHub Safety
- Every change must be safe for `git clone → docker compose up -d` by strangers
- `.env` gitignored | `.env.example` committed with placeholder values only
- `*.db`, `uploads/`, `*.log`, `*.secret` gitignored AND dockerignored

---

## Key File Map (Quick Reference)

| File | Purpose |
|---|---|
| `main.py` | App entry point, mounts all routers |
| `database.py` | Schema + ALL migrations (`init_db()`) |
| `models.py` | Pydantic models |
| `templates_env.py` | **Single** Jinja2 env — all filters registered here |
| `auth_middleware.py` | Auth redirect + `_PUBLIC` routes list |
| `routers/home.py` | Home pages + widget CRUD |
| `routers/home_db.py` | DB helpers for home pages + widgets |
| `routers/home_rss.py` | RSS Reader JSON endpoints (update/delete/add/read) |
| `routers/home_rss_db.py` | RSS Reader DB helpers (`get_page_feeds`, `update_page_feed`, …) |
| `routers/demo.py` | Demo mode — all global writes need `_demo_guard()` |
| `templates/partials/home_page.html` | All widget macros |
| `templates/partials/home_page_rss.html` | RSS Reader page template |
| `static/js/home-widgets.js` | Widget nav + CRUD core; `_initSwappedPage()` dispatches HTMX page boots |
| `static/js/home-widgets-render.js` | Widget JS engines; `_showReminderToast()` |
| `static/js/home-page-rss.js` | RSS Reader module — feeds, items, read state, inline errors |
| `CODEPUPPY_NOTES.md` | **The bible** — full patterns, gotchas, session log |

### RSS Reader — quick debug lookup
| Symptom | First file to read |
|---|---|
| Feed rename / save fails | `static/js/home-page-rss.js` → `rssUpdateFeed()` then `routers/home_rss.py` → `update_feed` |
| Feed delete fails | `static/js/home-page-rss.js` → `rssDeleteFeed()` then `routers/home_rss.py` → `remove_feed` |
| Feeds not loading at all | `initRssPage()` in `home-page-rss.js`; `_initSwappedPage()` in `home-widgets.js` |
| RSS page blank after HTMX nav | `home-widgets.js` → `_initSwappedPage()` → `rss-page-root` guard |
| DB schema issue | `database.py` `init_db()` → rss_page_feeds block + category migration |
| Session expiry triggers wrong error | `auth_middleware.py` `_bounce()` — fetch() gets 302→HTML; check `Content-Type` before `r.json()` |

---

## Workflow (Always Follow This Order)

### 🐛 Bug fix
1. **Eddie reads** the obvious files first (`read_file`, `grep`) — identify root cause before touching anything
2. **Eddie fixes** — keep diff small (prefer `replace_in_file`)
3. **Audit** → `bookworm-template-audit` if `templates/` or `static/js/` touched — pass exact files + what changed
4. **QA** → `bookworm-qa` — pass: files changed, root cause, endpoints to verify
5. **Pre-commit** → `bookworm-pre-commit` — pass: files staged, any temp debug files to watch for
6. **Commit** → focused, descriptive message

### ✨ New feature
1. **Plan** → `bookworm-feature-planner` — pass user requirement verbatim
2. **Eddie codes** from `PLAN.md` following all Critical Rules
3. **Audit** → `bookworm-template-audit` if templates/JS touched
4. **Migrate** → `bookworm-db-migration` if schema changed
5. **QA** → `bookworm-qa` — pass: feature summary, new endpoints, what to verify
6. **Pre-commit** → `bookworm-pre-commit`
7. **Sync docs** → `bookworm-docs-keeper` if schema/filters/widgets/routes changed
8. **Commit** → small, focused commits

### 🔁 Refactor / performance
1. **Eddie reads** affected files — form a clear before/after plan
2. If broad scope → `bookworm-perf-detective` with specific suspected hotspots pre-identified
3. **Eddie changes**, then Audit → QA → Pre-commit → Commit as above
