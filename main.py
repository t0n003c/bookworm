"""BookWorm — Team Note Taking App (FastAPI + HTMX + Tailwind + SQLite)."""
import asyncio
import os
from contextlib import asynccontextmanager
from datetime import date
from typing import Optional
import logging

log = logging.getLogger(__name__)

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from auth_middleware import AuthMiddleware
from security import load_secret_key


# ── Security response headers ─────────────────────────────────────────────────
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject standard security headers on every response.

    Deliberately skips Content-Security-Policy: the app uses Tailwind/HTMX/
    Chart.js from CDN and has inline <script> blocks throughout the templates.
    A nonce-based CSP is the right long-term fix but is out of scope here.
    """
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


from database import init_db
from routers.categories_db import get_categories_for_workspace, get_all_attr_defs
from routers.notes_db import search_notes
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
from routers.home_db import get_home_pages
from routers import notes as notes_router
from routers import categories as categories_router
from routers import workspaces as workspaces_router
from routers import attachments as attachments_router
from routers import auth as auth_router
from routers import account as account_router
from routers import totp as totp_router
from routers import home as home_router
from routers import home_rss as home_rss_router
from routers import home_crm as home_crm_router
from routers import home_uploads as home_uploads_router
from routers import home_uploads_docs as home_uploads_docs_router
from routers import home_uploads_annot as home_uploads_annot_router
from routers import wopi as wopi_router
from routers import demo as demo_router
from routers.demo import purge_old_demo_users
from routers.attachments_db import UPLOAD_DIR


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
    await init_db()
    await purge_expired_trash()   # clean up any trash older than 30 days on boot
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

app.mount("/static",  StaticFiles(directory="static"),          name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)),   name="uploads")

app.include_router(auth_router.router)
app.include_router(account_router.router)
app.include_router(totp_router.router)
app.include_router(home_router.router)
app.include_router(home_rss_router.router)
app.include_router(home_crm_router.router)
app.include_router(home_uploads_router.router)
app.include_router(home_uploads_docs_router.router)
app.include_router(home_uploads_annot_router.router)
app.include_router(wopi_router.router)
app.include_router(demo_router.router)
app.include_router(notes_router.router)
app.include_router(attachments_router.router)
app.include_router(categories_router.router)
app.include_router(workspaces_router.router)


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
    categories      = await get_categories_for_workspace(active_ws_id)
    attr_defs       = await get_all_attr_defs()
    breadcrumbs: dict = {}
    for ow in open_workspaces:
        breadcrumbs[ow["id"]] = await get_workspace_breadcrumb(ow["id"], user_id)
    # also include the active workspace even if it isn't pinned to the top bar
    if active_ws_id is not None and active_ws_id not in breadcrumbs:
        breadcrumbs[active_ws_id] = await get_workspace_breadcrumb(active_ws_id, user_id)
    trashed_workspaces = await get_trashed_workspaces(user_id)
    home_pages       = await get_home_pages(user_id)
    current_username = request.session.get("username", "")
    current_role     = request.session.get("role", "user")
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
            "home_pages":         home_pages,
            "is_demo":            request.session.get("is_demo", False),
            "demo_expires_at":    request.session.get("demo_expires_at"),
        },
    )
    # Prevent the browser from caching this page — it is user-specific and must
    # always be fetched fresh so a new login never sees a previous user's data.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response



