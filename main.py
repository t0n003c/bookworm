"""BookWorm — Team Note Taking App (FastAPI + HTMX + Tailwind + SQLite)."""
from contextlib import asynccontextmanager
from datetime import date
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles


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
from routers import notes as notes_router
from routers import categories as categories_router
from routers import workspaces as workspaces_router
from routers import attachments as attachments_router
from routers.attachments_db import UPLOAD_DIR


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await purge_expired_trash()  # clean up any trash older than 30 days on boot
    yield


from templates_env import templates  # shared instance with all custom filters

app = FastAPI(title="BookWorm", lifespan=lifespan)

app.mount("/static",  StaticFiles(directory="static"),          name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)),   name="uploads")

app.include_router(notes_router.router)
app.include_router(attachments_router.router)
app.include_router(categories_router.router)
app.include_router(workspaces_router.router)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, ws: Optional[int] = None):
    """Render the main SPA shell."""
    open_workspaces = await get_open_workspaces()
    all_workspaces  = await get_all_workspaces()
    ws_tree         = await get_workspace_tree()
    active_ws_id    = ws or (open_workspaces[0]["id"] if open_workspaces else None)
    open_ws_ids     = {w["id"] for w in open_workspaces}
    ws_id_set = await get_descendant_ids(active_ws_id) if active_ws_id is not None else None
    notes     = await search_notes(workspace_ids=list(ws_id_set)) if ws_id_set is not None else []
    categories      = await get_categories_for_workspace(active_ws_id)
    attr_defs       = await get_all_attr_defs()
    breadcrumbs: dict = {}
    for ow in open_workspaces:
        breadcrumbs[ow["id"]] = await get_workspace_breadcrumb(ow["id"])
    # also include the active workspace even if it isn't pinned to the top bar
    if active_ws_id is not None and active_ws_id not in breadcrumbs:
        breadcrumbs[active_ws_id] = await get_workspace_breadcrumb(active_ws_id)
    trashed_workspaces = await get_trashed_workspaces()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
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
        },
    )


if __name__ == "__main__":
    import sys
    import uvicorn
    # Ensure stdout/stderr are real streams (guards against Windows background-launch NoneType bug)
    if sys.stdout is None:
        sys.stdout = open("bookworm_stdout.log", "w", buffering=1)
    if sys.stderr is None:
        sys.stderr = open("bookworm_stderr.log", "w", buffering=1)
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)
