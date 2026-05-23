"""BookWorm — Team Note Taking App (FastAPI + HTMX + Tailwind + SQLite)."""
import asyncio
import os
import re
from contextlib import asynccontextmanager
from datetime import date
from typing import Optional
import logging

log = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from auth_middleware import AuthMiddleware
from security import load_secret_key


# ── Security response headers ─────────────────────────────────────────────────
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject standard security headers on every response."""
    _HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options":        "SAMEORIGIN",
        "Referrer-Policy":        "strict-origin-when-cross-origin",
        "Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
    }

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for k, v in self._HEADERS.items():
            response.headers.setdefault(k, v)
        return response


class _StaticCacheMiddleware(BaseHTTPMiddleware):
    """Add long-lived cache headers to versioned static assets.

    The app injects ?v={{ static_v }} on every <script>/<link> tag, so the
    URL changes on every deploy.  That makes it safe to cache aggressively.

    /static/ paths WITHOUT a ?v= param get a 1-hour cache (e.g. favicon,
    fonts) so they are still refreshed regularly.  Dynamic routes are
    untouched.
    """
    _IMMUTABLE = "public, max-age=31536000, immutable"  # 1 year
    _SHORT     = "public, max-age=3600"                # 1 hour

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            cc = self._IMMUTABLE if request.query_params.get("v") else self._SHORT
            response.headers["Cache-Control"] = cc
        return response


from database import init_db
from routers.categories_db import get_categories_for_workspace, get_all_attr_defs
from routers.notes_db import search_notes
from routers.sharing_db import get_shared_object_ids
from routers.workspaces_db import (
    get_all_workspaces,
    get_open_workspaces,
    get_workspace_tree,
    get_workspace_breadcrumb,
    get_descendant_ids,
    get_first_workspace_id,
    get_trashed_workspaces,
    purge_expired_trash,
)
from routers.home_db import get_home_pages, get_trashed_home_pages, purge_expired_home_pages
from routers.workspace_db_cards import get_db_cards
from routers import notes as notes_router
from routers import categories as categories_router
from routers import workspaces as workspaces_router
from routers import workspace_databases as workspace_databases_router
from routers import attachments as attachments_router
from routers import auth as auth_router
from routers import account as account_router
from routers import totp as totp_router
from routers import home as home_router
from routers import home_rss as home_rss_router
from routers import home_crm as home_crm_router
from routers import home_subscriptions as home_subscriptions_router
from routers import home_trip as home_trip_router
from routers import home_trip_panels as home_trip_panels_router
from routers import home_settle as home_settle_router
from routers import home_buds as home_buds_router
from routers import home_grid as home_grid_router
from routers import home_uploads as home_uploads_router
from routers import home_uploads_docs as home_uploads_docs_router
from routers import home_uploads_annot as home_uploads_annot_router
from routers import home_uploads_folders as home_uploads_folders_router
from routers import home_uploads_catalogs as home_uploads_catalogs_router
from routers import wopi as wopi_router
from routers import demo as demo_router
from routers.demo import purge_old_demo_users
from routers import note_reminders as note_reminders_router
from routers import sharing as sharing_router
from routers.attachments_db import UPLOAD_DIR, get_upload_owner
from database import get_db


async def _demo_purge_loop():
    """Background task: purge stale demo users every 30 minutes.

    This is the safety net for demos whose users never triggered /demo/end
    (e.g. session expired, page refreshed without beacon firing, etc.).
    """
    _INTERVAL = 30 * 60  # 30 minutes
    while True:
        await asyncio.sleep(_INTERVAL)
        try:
            n = await purge_old_demo_users()
            if n:
                log.info("Background purge: removed %d stale demo user(s)", n)
        except Exception:
            log.exception("Background purge failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Generate PWA icons on first boot (no-op if files already exist)
    try:
        from bw_pwa_icons import generate_icons
        generate_icons()
    except Exception:
        log.warning("PWA icon generation failed — continuing without icons")

    await init_db()
    await purge_expired_trash()   # clean up any trash older than 30 days on boot
    await purge_expired_home_pages()  # purge home pages trashed for >30 days
    await purge_old_demo_users()  # clean up stale demo accounts on boot
    purge_task = asyncio.create_task(_demo_purge_loop())
    try:
        yield
    finally:
        purge_task.cancel()
        try:
            await purge_task
        except asyncio.CancelledError:
            pass


from templates_env import templates  # shared instance with all custom filters

app = FastAPI(title="BookWorm", lifespan=lifespan)

# SessionMiddleware must be outermost (added last) so it runs first and
# populates request.session before AuthMiddleware reads it.
# BW_SECRET_KEY should be set in production; a random default means
# sessions are invalidated on every server restart (fine for dev).
app.add_middleware(AuthMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("BW_SECRET_KEY", load_secret_key()),
    # BW_HTTPS=true  → secure-only cookies (require HTTPS). Enable this whenever
    # the app is behind a TLS-terminating proxy (nginx, Caddy, Traefik, etc.).
    # Leave false only for plain-HTTP local-network / development use.
    https_only=os.getenv("BW_HTTPS", "false").lower() == "true",
    max_age=86_400 * 30,  # 30-day cookie TTL; per-session expiry enforced in middleware
)
# Outermost — runs last on responses, so it stamps headers on everything.
app.add_middleware(_SecurityHeadersMiddleware)
app.add_middleware(_StaticCacheMiddleware)

# GZip all text responses ≥1 KB.  Typically cuts JS/CSS/HTML 65-80%.
# Must be added AFTER the security-headers middleware so it wraps the
# whole stack and compresses the final outgoing bytes.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# When BookWorm runs behind a reverse proxy (Cloudflare Tunnel, nginx, Traefik…)
# the proxy terminates TLS and forwards requests over plain HTTP on localhost.
# BW_TRUST_PROXY=true tells uvicorn's ProxyHeadersMiddleware to read the
# X-Forwarded-Proto / X-Forwarded-For headers so:
#   • request.url.scheme becomes 'https' (required for Secure cookies)
#   • request.client.host is the real visitor IP, not 127.0.0.1
# ⚠️ Only enable this when a trusted proxy is actually in front; never on a
#     server exposed directly to the internet without a proxy.
if os.getenv("BW_TRUST_PROXY", "false").lower() == "true":
    # Trust only localhost — the only valid proxy address in this deployment.
    # "*" would let any client spoof X-Forwarded-For / X-Forwarded-Proto.
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["127.0.0.1", "::1"])

app.mount("/static",  StaticFiles(directory="static"),  name="static")
# NOTE: /uploads is NOT a raw StaticFiles mount — ownership is verified
# per-request by the gated route below.  The old open mount would let any
# logged-in user fetch another user’s file by guessing the UUID filename.

app.include_router(auth_router.router)
app.include_router(account_router.router)
app.include_router(totp_router.router)
app.include_router(home_router.router)
app.include_router(home_rss_router.router)
app.include_router(home_crm_router.router)
app.include_router(home_subscriptions_router.router)
app.include_router(home_trip_router.router)
app.include_router(home_trip_panels_router.router)
app.include_router(home_settle_router.router)
app.include_router(home_buds_router.router)
app.include_router(home_grid_router.router)
app.include_router(home_uploads_router.router)
app.include_router(home_uploads_docs_router.router)
app.include_router(home_uploads_annot_router.router)
app.include_router(home_uploads_folders_router.router)
app.include_router(home_uploads_catalogs_router.router)
app.include_router(wopi_router.router)
app.include_router(demo_router.router)
app.include_router(note_reminders_router.router)
app.include_router(notes_router.router)
app.include_router(attachments_router.router)
app.include_router(categories_router.router)
app.include_router(workspaces_router.router)
app.include_router(workspace_databases_router.router)
app.include_router(sharing_router.router)


# ── Ownership-gated file serving ──────────────────────────────────────────────
# Replaces the old open StaticFiles mount so that logged-in users cannot
# access each other's files by guessing a UUID filename.
#
# Subdirectory routes MUST come before the generic /uploads/{filename} route
# so FastAPI matches them first (its router is first-match, not best-match).

@app.get("/uploads/crm-pics/{filename}", include_in_schema=False)
async def serve_crm_pic(request: Request, filename: str):
    """Serve a CRM profile-picture to the page owner.

    Filename pattern: c{page_id}_{contact_id}.{ext}
    Ownership: caller must own the crm_pages row for that page_id.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400)
    try:
        page_id = int(filename.lstrip("c").split("_")[0])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400)
    async with get_db() as db:
        row = await db.execute_fetchone(
            "SELECT id FROM crm_pages WHERE id=? AND user_id=?", (page_id, uid)
        )
    if not row:
        raise HTTPException(status_code=403)
    path = UPLOAD_DIR / "crm-pics" / filename
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(path=path)


@app.get("/uploads/trip-covers/{filename}", include_in_schema=False)
async def serve_trip_cover(request: Request, filename: str):
    """Serve a trip cover image (loc / spot / plan) to the page owner.

    Filename patterns:
      loc{page_id}_{loc_id}.{ext}
      spot{page_id}_{spot_id}.{ext}
      plan{page_id}_{plan_id}.{ext}
    Ownership: caller must own the trip_pages row for that page_id.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400)
    try:
        # Strip the alpha prefix (loc / spot / plan) then grab first numeric segment
        m = re.match(r'^[a-z]+(\d+)_', filename)
        if not m:
            raise ValueError
        page_id = int(m.group(1))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400)
    async with get_db() as db:
        row = await db.execute_fetchone(
            "SELECT id FROM trip_pages WHERE id=? AND user_id=?", (page_id, uid)
        )
    if not row:
        raise HTTPException(status_code=403)
    path = UPLOAD_DIR / "trip-covers" / filename
    if not path.exists():
        raise HTTPException(status_code=404)
    return FileResponse(path=path)


@app.get("/uploads/{filename}", include_in_schema=False)
async def serve_upload(request: Request, filename: str):
    """Serve a user upload only to the file’s owner.

    Auth flow:
      1. Reject unauthenticated sessions (401).
      2. Reject path-traversal attempts that sneak a / into the filename (400).
      3. Look up the owner of *filename* across both upload tables.
      4. Return 404 if the file is unknown — avoids leaking whether it exists.
      5. Return 403 if the caller is not the owner.
      6. Serve via FileResponse (streaming, supports Range requests).
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)

    # Block path traversal before it touches the filesystem
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    owner_uid = await get_upload_owner(filename)
    if owner_uid is None:
        raise HTTPException(status_code=404)
    if owner_uid != uid:
        raise HTTPException(status_code=403)

    disk_path = UPLOAD_DIR / filename
    if not disk_path.exists():
        raise HTTPException(status_code=404)

    return FileResponse(path=disk_path)


# ── PWA support routes ───────────────────────────────────────────────────────

_SW_PATH = os.path.join(os.path.dirname(__file__), "static", "js", "sw.js")


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    """Serve the service worker at root scope so it controls all pages."""
    try:
        with open(_SW_PATH, "r", encoding="utf-8") as f:
            body = f.read()
    except FileNotFoundError:
        return Response(status_code=404)
    return Response(
        content=body,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/manifest.json", include_in_schema=False)
async def pwa_manifest():
    """Web-app manifest with root-relative icon paths.

    Paths start with '/' so they resolve correctly regardless of what host,
    port, or tunnel (Cloudflare, ngrok, etc.) is serving the app.  Baking
    in an absolute base URL like the old version did is an anti-pattern —
    it breaks the moment the address changes.
    """
    manifest = {
        "name": "BookWorm",
        "short_name": "BookWorm",
        "description": "Team note-taking app — notes, reminders, CRM & more.",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#1b4332",
        "theme_color": "#1b4332",
        "orientation": "any",
        "categories": ["productivity", "utilities"],
        "icons": [
            {
                "src": "/static/img/icons/icon-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/static/img/icons/icon-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": "/static/img/icons/icon-maskable-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "screenshots": [],
    }
    return JSONResponse(
        content=manifest,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/offline", response_class=HTMLResponse, include_in_schema=False)
async def offline_page(request: Request):
    """Offline fallback page cached by the service worker."""
    return templates.TemplateResponse(request, "offline.html")


@app.get("/health")
async def health():
    """Lightweight liveness probe — no auth, no DB hit, no redirects.

    Used by Docker / Kubernetes health checks so they don't trigger a
    session redirect chain. Returns 200 + JSON when the process is alive.
    """
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, ws: Optional[int] = None):
    """Render the main SPA shell.

    - No workspace selected: redirect to the user's own first workspace,
      or show the welcome state if they have none yet.
    - Workspace selected: validate it actually belongs to this user before
      loading any notes (prevents account bleed-through).
    """
    user_id = request.session.get("user_id")
    log.debug("GET /  user_id=%r  ws_param=%r  session_keys=%s", user_id, ws, list(request.session.keys()))

    # ── resolve active workspace ──────────────────────────────────────────
    if ws is None:
        # Find *this* user's first workspace — never fall back to ws=1.
        first_ws = await get_first_workspace_id(user_id)
        if first_ws is not None:
            return RedirectResponse(url=f"/?ws={first_ws}")
        # User has no workspaces yet → fall through with active_ws_id=None
        #  which triggers the welcome/empty state in note_list.html.

    # ── guard: ensure the requested workspace belongs to this user ────────
    all_workspaces = await get_all_workspaces(user_id)
    user_ws_ids    = {w["id"] for w in all_workspaces}

    if ws is not None and ws not in user_ws_ids:
        # Someone navigated to another user's workspace (or a stale URL).
        # Send them to their own landing instead.
        first_ws = await get_first_workspace_id(user_id)
        redirect_to = f"/?ws={first_ws}" if first_ws else "/"
        return RedirectResponse(url=redirect_to)

    active_ws_id = ws  # None → welcome state; int → validated user workspace
    log.debug("GET /  active_ws_id=%r  user_ws_ids=%s", active_ws_id, user_ws_ids)

    open_workspaces = await get_open_workspaces(user_id)
    ws_tree         = await get_workspace_tree(user_id)
    open_ws_ids     = {w["id"] for w in open_workspaces}
    ws_id_set = await get_descendant_ids(active_ws_id) if active_ws_id is not None else None
    notes     = await search_notes(workspace_ids=list(ws_id_set)) if ws_id_set is not None else []
    if notes:
        _shared = await get_shared_object_ids("note", [n["id"] for n in notes])
        for note in notes:
            note["has_share_link"] = note["id"] in _shared
    categories      = await get_categories_for_workspace(active_ws_id)
    attr_defs       = await get_all_attr_defs()
    breadcrumbs: dict = {}
    for ow in open_workspaces:
        breadcrumbs[ow["id"]] = await get_workspace_breadcrumb(ow["id"], user_id)
    # also include the active workspace even if it isn't pinned to the top bar
    if active_ws_id is not None and active_ws_id not in breadcrumbs:
        breadcrumbs[active_ws_id] = await get_workspace_breadcrumb(active_ws_id, user_id)
    trashed_workspaces = await get_trashed_workspaces(user_id)
    home_pages         = await get_home_pages(user_id)
    trashed_hp          = await get_trashed_home_pages(user_id)
    trashed_home_pages  = trashed_hp
    current_username = request.session.get("username", "")
    current_role     = request.session.get("role", "user")
    # Determine if the active workspace is a database node, and load its cards.
    # Required so the initial hard-refresh render shows the card grid, not
    # note_list.html (which knows nothing about database workspaces).
    active_ws_type = "workspace"
    db_cards: list = []
    if active_ws_id is not None:
        ws_row = next((w for w in all_workspaces if w["id"] == active_ws_id), None)
        if ws_row:
            active_ws_type = ws_row.get("ws_type") or "workspace"
            if active_ws_type == "database":
                db_cards = await get_db_cards(db_id=active_ws_id, user_id=user_id)
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "current_username":   current_username,
            "current_user_id":    user_id,
            "current_role":       current_role,
            "notes":              notes,
            "categories":         categories,
            "attr_defs":          attr_defs,
            "today":              date.today().isoformat(),
            "open_workspaces":    open_workspaces,
            "all_workspaces":     all_workspaces,
            "ws_tree":            ws_tree,
            "trashed_workspaces": trashed_workspaces,
            "breadcrumbs":        breadcrumbs,
            "active_ws_id":       active_ws_id,
            "open_count":         len(open_workspaces),
            "open_ws_ids":        open_ws_ids,
            "active_ws_type":     active_ws_type,
            "db_cards":           db_cards,
            "home_pages":         home_pages,
            "trashed_home_pages": trashed_home_pages,
            "is_demo":            request.session.get("is_demo", False),
            "demo_expires_at":    request.session.get("demo_expires_at"),
            "current_user_id":    user_id,
        },
    )
    # Prevent the browser from caching this page — it is user-specific and must
    # always be fetched fresh so a new login never sees a previous user's data.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


