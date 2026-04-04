"""Home Pages router — personal dashboard with drag-and-drop widgets."""
import json
import urllib.error
import urllib.parse
import urllib.request
from asyncio import get_running_loop
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from routers.home_db import (
    add_widget, create_home_page, delete_home_page, delete_widget,
    get_home_page, get_home_pages, get_widgets, reorder_widgets,
    rename_home_page, update_page_config, update_widget_config,
)
from routers.notes_db import search_notes
from templates_env import templates

router = APIRouter(prefix="/home")

_ERR  = "<span class='text-red-500 text-xs'>{}</span>"
_POOL = ThreadPoolExecutor(max_workers=4)   # small pool for sync URL fetches


def _uid(request: Request) -> int:
    return request.session["user_id"]


def _fetch_json(url: str) -> dict:
    """Synchronous JSON fetch — runs in the thread-pool executor."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BookWorm/1.0 (weather proxy)"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


async def _fetch_json_async(url: str) -> dict:
    loop = get_running_loop()
    return await loop.run_in_executor(_POOL, partial(_fetch_json, url))


# ── Sidebar partial ───────────────────────────────────────────────────────────────────────

@router.get("/sidebar", response_class=HTMLResponse)
async def home_sidebar(request: Request):
    pages = await get_home_pages(_uid(request))
    return templates.TemplateResponse(
        request, "partials/home_sidebar.html", {"pages": pages}
    )


# ── Weather proxy ──────────────────────────────────────────────────────────────────
# Fetches geocoding + weather from open-meteo server-side so that
# corporate-proxy restrictions that block browser fetch() don’t apply.

@router.get("/weather")
async def weather_proxy(
    loc:  str = Query("Dallas, TX"),
    unit: str = Query("F"),
):
    try:
        geo_url = (
            "https://geocoding-api.open-meteo.com/v1/search?"
            + urllib.parse.urlencode({"name": loc, "count": 1, "language": "en", "format": "json"})
        )
        geo = await _fetch_json_async(geo_url)
        if not geo.get("results"):
            return JSONResponse({"error": "location_not_found"}, status_code=404)

        r        = geo["results"][0]
        lat, lon = r["latitude"], r["longitude"]
        name     = r.get("name", loc)
        admin1   = r.get("admin1", "")
        temp_unit = "fahrenheit" if unit.upper() == "F" else "celsius"

        wx_url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m"
            f"&daily=temperature_2m_max,temperature_2m_min,weathercode"
            f"&temperature_unit={temp_unit}&wind_speed_unit=mph"
            f"&forecast_days=4&timezone=auto"
        )
        wx = await _fetch_json_async(wx_url)
        return JSONResponse({
            "name": name, "admin1": admin1,
            "unit": unit.upper(),
            "current": wx.get("current", {}),
            "daily":   wx.get("daily",   {}),
        })
    except urllib.error.URLError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


# ── CRUD: pages (specific routes MUST come before /{page_id} to avoid
#   Starlette matching 'create'/'delete'/etc as a path parameter integer) ────

@router.post("/pages/create", response_class=HTMLResponse)
async def create_page(
    request: Request,
    name:  str = Form("My Page"),
    emoji: str = Form("🏠"),
):
    uid     = _uid(request)
    page_id = await create_home_page(uid, name, emoji)
    pages   = await get_home_pages(uid)
    return templates.TemplateResponse(
        request, "partials/home_sidebar.html",
        {"pages": pages, "active_page_id": page_id},
    )


# ── Page canvas (parameterized — registered AFTER all fixed-path routes) ──────

@router.get("/pages/{page_id}", response_class=HTMLResponse)
async def home_page_view(request: Request, page_id: int):
    uid   = _uid(request)
    page  = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse("<p class='text-red-500 p-6'>Page not found.</p>", 404)
    widgets = await get_widgets(page_id)
    # Fetch recent notes for the note-link widget picker (latest 50)
    all_notes = (await search_notes())[:50]
    return templates.TemplateResponse(
        request,
        "partials/home_page.html",
        {"page": page, "widgets": widgets, "all_notes": all_notes},
    )


@router.post("/pages/{page_id}/rename", response_class=HTMLResponse)
async def rename_page(
    request: Request,
    page_id: int,
    name:  str = Form("My Page"),
    emoji: str = Form("🏠"),
):
    uid = _uid(request)
    await rename_home_page(page_id, uid, name, emoji)
    pages = await get_home_pages(uid)
    return templates.TemplateResponse(
        request, "partials/home_sidebar.html", {"pages": pages}
    )


@router.post("/pages/{page_id}/update-config", response_class=HTMLResponse)
async def update_page_config_handler(
    request: Request,
    page_id: int,
    config_json: str = Form("{}"),
):
    uid = _uid(request)
    try:
        patch = json.loads(config_json)
    except Exception:
        patch = {}
    # Merge patch into existing config instead of a full overwrite
    page = await get_home_page(page_id, uid)
    existing = page.get("config", {}) if page else {}
    merged = {**existing, **patch}
    await update_page_config(page_id, uid, merged)
    return HTMLResponse("", 204)


@router.post("/pages/{page_id}/delete", response_class=HTMLResponse)
async def del_page(request: Request, page_id: int):
    uid = _uid(request)
    await delete_home_page(page_id, uid)
    pages = await get_home_pages(uid)
    return templates.TemplateResponse(
        request, "partials/home_sidebar.html", {"pages": pages}
    )


# ── CRUD: widgets ─────────────────────────────────────────────────────────────

@router.post("/pages/{page_id}/widgets/add", response_class=HTMLResponse)
async def add_widget_handler(
    request: Request,
    page_id: int,
    widget_type: str = Form(...),
    style:       str = Form("default"),
    config_json: str = Form("{}"),
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse(_ERR.format("Page not found."), 404)
    try:
        config = json.loads(config_json)
    except Exception:
        config = {}
    await add_widget(page_id, widget_type, style, config)
    widgets   = await get_widgets(page_id)
    all_notes = (await search_notes())[:50]
    return templates.TemplateResponse(
        request, "partials/home_page.html",
        {"page": page, "widgets": widgets, "all_notes": all_notes},
    )


@router.post("/widgets/{widget_id}/update-config", response_class=HTMLResponse)
async def update_widget(
    request: Request,
    widget_id: int,
    config_json: str = Form("{}"),
):
    try:
        config = json.loads(config_json)
    except Exception:
        config = {}
    await update_widget_config(widget_id, config)
    return HTMLResponse("", 204)


@router.post("/widgets/{widget_id}/delete", response_class=HTMLResponse)
async def del_widget(request: Request, widget_id: int, page_id: int = Form(...)):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse(_ERR.format("Forbidden."), 403)
    await delete_widget(widget_id)
    widgets   = await get_widgets(page_id)
    all_notes = (await search_notes())[:50]
    return templates.TemplateResponse(
        request, "partials/home_page.html",
        {"page": page, "widgets": widgets, "all_notes": all_notes},
    )


@router.post("/pages/{page_id}/widgets/reorder", response_class=HTMLResponse)
async def reorder_widgets_handler(
    request: Request,
    page_id: int,
    order: str = Form(...),   # comma-separated widget IDs
):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse(_ERR.format("Forbidden."), 403)
    try:
        ids = [int(x) for x in order.split(",") if x.strip()]
    except ValueError:
        return HTMLResponse(_ERR.format("Bad order."), 400)
    await reorder_widgets(page_id, ids)
    return HTMLResponse("", 204)
