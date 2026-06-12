"""RSS Reader page-level routes.

Mounted with prefix=/home (same as routers/home.py).
Routes live under /home/rss-reader/{page_id}/...

These are JSON-returning endpoints consumed by home-page-rss.js.
They never render full templates — the page itself is rendered by
home_page_view() in home.py.
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from routers.home_rss_db import (
    add_page_feed,
    delete_page_feed,
    get_page_feeds,
    get_read_guids,
    mark_read,
    purge_old_rss_read_items,
    update_page_feed,
)
from routers.home_db import get_home_page

log = logging.getLogger(__name__)

router = APIRouter(prefix="/home")


def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    return int(uid)


# ── Feed CRUD ─────────────────────────────────────────────────────────────────

@router.get("/rss-reader/{page_id}/feeds")
async def list_feeds(request: Request, page_id: int):
    uid   = _uid(request)
    page  = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "rss":
        return JSONResponse([], status_code=200)
    feeds = await get_page_feeds(page_id, uid)
    return JSONResponse(feeds)


@router.post("/rss-reader/{page_id}/feeds/add")
async def add_feed(
    request: Request,
    page_id: int,
    url:      str = Form(...),
    label:    str = Form(""),
    color:    str = Form(""),
    category: str = Form(""),
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page or page.get("page_type") != "rss":
        return JSONResponse({"error": "page not found"}, status_code=404)

    url = url.strip()
    if not url.startswith(("http://", "https://")):
        return JSONResponse({"error": "invalid url"}, status_code=400)

    feeds = await add_page_feed(page_id, uid, url, label, color, category)
    return JSONResponse(feeds)


@router.post("/rss-reader/{page_id}/feeds/{feed_id}/update")
async def update_feed(
    request: Request,
    page_id: int,
    feed_id: int,
    label:    str = Form(""),
    color:    str = Form("#0053e2"),
    category: str = Form(""),
):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    try:
        feeds = await update_page_feed(feed_id, page_id, uid, label, color, category)
        return JSONResponse(feeds)
    except Exception as exc:
        log.exception("update_feed error: %s", exc)
        return JSONResponse({"error": "server error"}, status_code=500)


@router.post("/rss-reader/{page_id}/feeds/{feed_id}/delete")
async def remove_feed(request: Request, page_id: int, feed_id: int):
    try:
        uid = _uid(request)
    except PermissionError:
        return JSONResponse({"error": "not logged in"}, status_code=401)
    try:
        feeds = await delete_page_feed(feed_id, page_id, uid)
        return JSONResponse(feeds)
    except Exception as exc:
        log.exception("remove_feed error: %s", exc)
        return JSONResponse({"error": "server error"}, status_code=500)


# ── Read state ────────────────────────────────────────────────────────────────

@router.get("/rss-reader/{page_id}/read")
async def get_read(request: Request, page_id: int):
    uid   = _uid(request)
    guids = await get_read_guids(page_id, uid)
    return JSONResponse(list(guids))


@router.post("/rss-reader/{page_id}/read")
async def post_read(request: Request, page_id: int):
    """Mark guids as read.  Accepts two body shapes:

    New (preferred): JSON object  ``{"feed_id": 42, "guids": ["...", ...]}``
    Legacy fallback: JSON array   ``["guid1", "guid2"]``   (no feed cap)
    """
    uid = _uid(request)
    feed_id: int | None = None
    guids: list[str] = []
    try:
        body = await request.json()
        if isinstance(body, dict):
            feed_id = body.get("feed_id")  # may be None / missing
            guids   = body.get("guids") or []
        elif isinstance(body, list):
            guids = body  # legacy array format
    except Exception:
        form = await request.form()
        raw  = form.get("guids", "")
        guids = [g.strip() for g in str(raw).split(",") if g.strip()]

    await mark_read(page_id, uid, guids, feed_id=feed_id)
    return JSONResponse({"ok": True})
