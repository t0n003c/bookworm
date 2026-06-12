# BookWorm — Architecture

This document describes the **target architecture** for BookWorm, the **current
state**, and the **phased, low-risk path** from one to the other. It is written
to be followed incrementally (strangler-fig): the app keeps shipping and never
changes behaviour while the structure improves one slice at a time.

> **Guiding constraint:** behaviour must not change. There is no automated test
> suite yet, so every structural change is made behind backward-compatible shims
> and verified with: `import main` (app builds), the route count stays **351**,
> `/health` returns 200, and a smoke pass over key endpoints. Big physical moves
> are done one vertical slice at a time, each reviewed before the next.

---

## 1. Current state (honest assessment)

BookWorm is a FastAPI + HTMX + SQLite app. It is **functional and already
partially layered**, but it has accreted coupling that makes it harder to scale:

**What's already good**
- `routers/*_db.py` separates data access from HTTP handlers (a repository
  pattern in spirit) — e.g. `notes.py` (HTTP) vs `notes_db.py` (SQL).
- Single Jinja environment (`templates_env.py`); single DB accessor (`get_db`).
- Cross-cutting pieces already extracted: `security.py`, `auth_middleware.py`,
  `bw_ssrf.py`, `search_index.py`.

**What hurts maintainability / scale**
1. **Scattered configuration.** `BW_*` env vars were read with `os.getenv(...)`
   inline in **18 files / 40+ call sites**, with defaults and parsing duplicated
   (`BW_DATA_DIR` built 3×, `BW_MAX_UPLOAD_MB` 3×) and occasionally inconsistent.
   → *Fixed in this pass: `core/config.py`.*
2. **Duplicated request helpers.** `def _uid(request)` was copy-pasted in **17
   routers** (with accidental variations); ownership/`_demo_guard` patterns are
   repeated. → *Fixed in this pass: `core/deps.py` (16 routers consolidated).*
3. **Flat top level.** ~15 modules + a 50-file `routers/` dir live at the repo
   root with no layer boundaries, so dependency direction isn't enforceable.
   → *Phases 4–6.*
4. **Fat modules.** `main.py` (~66 KB) mixes app wiring, lifespan, several inline
   routes, CSP, and helpers. `database.py` (~89 KB) holds schema + every
   migration + the connection factory. → *Phases 2 & 5.*
5. **No service layer.** Business logic lives inside HTTP handlers, so it can't
   be reused (e.g. by a CLI, a cron job, or tests) without going through HTTP.
   → *Phase 6.*

---

## 2. Target architecture (Clean / layered)

A pragmatic Clean Architecture adapted to a small FastAPI app. **Dependencies
point inward only** — outer layers know inner layers, never the reverse.

```
            ┌─────────────────────────────────────────────┐
            │  api  (HTTP layer — routers, request/resp)   │  ← thin
            ├─────────────────────────────────────────────┤
            │  services  (business logic / use-cases)      │  ← reusable
            ├─────────────────────────────────────────────┤
            │  repositories  (data access — SQL via get_db)│
            ├─────────────────────────────────────────────┤
            │  models  (Pydantic schemas + domain types)   │
            ├─────────────────────────────────────────────┤
            │  core  (config, db session, security, deps)  │  ← depends on nothing app-internal
            └─────────────────────────────────────────────┘
```

**Layer rules**
- **core** imports only stdlib / third-party. Everything may import `core`.
- **repositories** import `core` (+ models). No HTTP, no FastAPI types.
- **services** import repositories, models, core. No FastAPI `Request`/`Response`.
- **api** imports services, models, core. Routers are *thin*: parse the request,
  call a service, render a template / return JSON. No SQL, no business rules.
- **templates/** & **static/** are presentation assets owned by the `api` layer.

This makes the codebase **modular** (each feature is a vertical slice across the
layers), **loosely coupled** (a feature talks to others only through service
interfaces), and **scalable** (a slice can be extracted to its own service, or
the DB swapped, without rippling through HTTP handlers).

---

## 3. Target folder structure

```
bookworm/
├── app/
│   ├── main.py                  # create_app(), router registration, middleware order
│   ├── lifespan.py              # startup/shutdown (init_db, schedulers, prewarm)
│   │
│   ├── core/                    # cross-cutting infra (depends on nothing app-internal)
│   │   ├── config.py            # Settings — single source of truth for BW_*   ✅ DONE
│   │   ├── db.py                # get_db(), connection PRAGMAs (from database.py)
│   │   ├── security.py          # secret key, Fernet, session expiry (from security.py)
│   │   ├── ssrf.py              # is_safe_url / resolve_redirect (from bw_ssrf.py)   ✅ exists
│   │   ├── logging.py           # logging config
│   │   └── deps.py              # FastAPI deps: current_user_id, require_owner, demo_guard
│   │
│   ├── db/
│   │   ├── schema.py            # CREATE TABLE statements
│   │   └── migrations.py        # init_db() additive/idempotent migrations (from database.py)
│   │
│   ├── models/                  # Pydantic request/response + domain types (from models.py)
│   │
│   ├── repositories/            # data access — the current routers/*_db.py files
│   │   ├── notes.py             # ← routers/notes_db.py
│   │   ├── workspaces.py        # ← routers/workspaces_db.py
│   │   └── …                    # one per current *_db.py
│   │
│   ├── services/                # use-cases / business logic (extracted from handlers)
│   │   ├── notes.py
│   │   ├── search/              # search_index.py, search_llm.py, search_qa.py
│   │   └── …
│   │
│   ├── api/                     # HTTP layer — the current routers/*.py (minus *_db.py)
│   │   ├── middleware/auth.py   # ← auth_middleware.py
│   │   ├── notes.py             # ← routers/notes.py (thin)
│   │   └── …
│   │
│   └── web/
│       ├── templates_env.py     # the single Jinja env + filters
│       ├── templates/           # (moved)
│       └── static/              # (moved)
│
├── scripts/                     # _health_check.py, _start_server.py, gen_vapid_keys.py, …
├── ARCHITECTURE.md              # this file
├── CODEPUPPY_NOTES.md           # implementation bible / session log
├── Dockerfile, docker-compose.yml, requirements.txt, .env.example
└── .github/workflows/docker-publish.yml
```

> The `app/` package gives Python a real boundary to enforce the dependency
> rules (import-linter can later fail CI if `core` imports `api`, etc.).

### Current file → target layer map

| Current | Target |
|---|---|
| `core/config.py` | `app/core/config.py` ✅ (moved; shim at `core/config.py`) |
| `core/db.py`, `core/deps.py` | `app/core/db.py`, `app/core/deps.py` ✅ (moved; shims left) |
| `db/schema.py`, `db/migrations.py` | `app/db/schema.py`, `app/db/migrations.py` ✅ (moved; shims left) |
| `bw_ssrf.py` | `app/core/ssrf.py` |
| `security.py` | `app/core/security.py` |
| `database.py` (get_db) | `app/core/db.py` ✅ (now `core/db.py`) |
| `database.py` (init_db/schema) | `app/db/migrations.py` + `app/db/schema.py` ✅ (now `db/`) |
| `auth_middleware.py` | `app/api/middleware/auth.py` |
| `models.py` | `app/models/` |
| `routers/*_db.py` | `app/repositories/*` |
| `routers/*.py` | `app/api/*` (thin) + logic → `app/services/*` |
| `search_index.py`, `search_llm.py`, `routers/search_qa.py` | `app/services/search/` |
| `templates_env.py`, `templates/`, `static/` | `app/web/` |
| `_health_check.py`, `_start_server.py`, `gen_vapid_keys.py`, `bw_*_icons.py`, `download_vendors.py`, `_seed_trip_data.py` | `scripts/` |

---

## 4. Phased migration plan (strangler-fig)

Each phase is independently shippable and verified (`import main` + 351 routes +
`/health` + smoke). No phase changes behaviour.

- **Phase 1 — Centralised config ✅ (this release).** `core/config.py` typed
  `Settings`; migrate the core + duplicated call sites (`rate_limit`,
  `attachments`, `home_uploads`, `demo`, `push`, `attachments_db`, `database`,
  `security`, `templates_env`). Each value proven byte-identical to its old
  `os.getenv`. Remaining router reads (webauthn, wopi, auth, home, search) flip
  to `settings` next, mechanically.
- **Phase 2 — Split `database.py`.** ✅ **2a done:** `get_db()` + `DB_PATH` +
  data-dir extracted to `core/db.py` (the DB-session layer); `database.py`
  re-exports them (`get_db` is identity-equal) so every `from database import
  get_db` keeps working. Verified: 351 routes, a live `get_db()` query, PRAGMAs
  intact (foreign_keys=1, WAL). ✅ **2b done:** schema constants →
  `db/schema.py`; `init_db()` migrations → `db/migrations.py`; `database.py` is
  now an 18-line facade re-exporting `get_db`/`DB_PATH`/`init_db`/`CREATE_TABLES_SQL`/
  `SEED_*` (all identity-equal). Verified behaviour-identical to the pre-split
  monolith (same result on a fresh build *and* on a copy of the live DB — incl. an
  identical pre-existing fresh-build quirk), 351 routes, server restart + health +
  smoke green, live DB untouched.
- **Phase 3 — Shared request deps.** ✅ **Done:** `core/deps.py` with
  `current_user_id(request, *, detail=…)` (guarded form) and `session_user_id`
  (strict `session["user_id"]` form). The 17 copy-pasted `_uid`s collapsed onto
  these two helpers: 4 strict routers alias `session_user_id`; 12 guarded routers
  delegate to `current_user_id`, each passing its exact 401 `detail` so responses
  stay byte-identical. `home_ai` is intentionally left (it raises `PermissionError`,
  caught by its own handlers — different contract). Verified: all 17 `_uid`
  behaviour-identical (valid→same id; unauth→same exception/status/detail), 351
  routes, health + smoke. Next: fold the repeated ownership/`_demo_guard` checks
  into `require_owner`/`demo_guard` deps.
- **Phase 4 — Introduce `app/` package + shims.** 🟡 **In progress — infra moved:**
  `core/` → `app/core/` (config, db, deps) and `db/` → `app/db/` (schema,
  migrations). The old `core/*.py` and `db/*.py` are now 4-line shims that alias
  the new modules via `sys.modules` (every name + identity preserved), so all
  `from core.… import …` / `from db.… import …` / `from database import …` keep
  working unchanged. Verified: 9 identity checks (old path *is* new object), 351
  routes, fresh build + live restart + health + smoke. **Next:** move
  `auth_middleware`/`security`/`bw_ssrf` → `app/core` + `app/api/middleware`,
  then routers → `app/api`, then flip the Dockerfile entrypoint last.
- **Phase 5 — Slim `main.py`.** Move lifespan → `app/lifespan.py`, inline routes
  → their feature routers, CSP/middleware wiring → `create_app()`.
- **Phase 6 — Service layer per slice.** For one feature at a time (start with
  notes), extract business logic from the router into `services/`, leaving the
  router as a thin adapter. Add unit tests against the service (now possible —
  no HTTP needed).

**Stop-the-line rule:** if any gate fails, the phase is reverted, not patched.

---

## 5. Conventions

- **Config:** read only via `from core.config import settings`. Never add a new
  `os.getenv("BW_…")` outside `core/config.py`.
- **DB access:** only through `get_db()` (async, `PRAGMA foreign_keys=ON`).
  Repository functions own SQL; services and routers never write SQL.
- **AuthZ:** every object-scoped route verifies ownership against
  `request.session["user_id"]` (see the security audit notes in
  `CODEPUPPY_NOTES.md`). This will move to a single `require_owner` dep (Phase 3).
- **Migrations:** additive + idempotent, in `init_db()` only.
- **No behaviour change without intent:** structural PRs are pure refactors;
  behavioural changes are separate, labelled PRs.

---

## 6. What changed in this release (Phase 1)

- **New `core/` infra package** with `core/config.py` — a typed, immutable
  `Settings` that is the single source of truth for all 20 `BW_*` settings,
  parsed once, each field reproducing the exact default/parsing of the call
  sites it replaces.
- **10 modules migrated** off inline `os.getenv` to `settings.*`, eliminating the
  triplicated `BW_DATA_DIR` / `BW_MAX_UPLOAD_MB` reads. Verified behaviour-
  identical (route count 351 unchanged; per-value equality asserted).
- This file (`ARCHITECTURE.md`) — the blueprint and the plan for Phases 2–6.

No routes, responses, or runtime behaviour changed.
