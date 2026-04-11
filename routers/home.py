"""Home Pages router — personal dashboard with drag-and-drop widgets."""
import html.parser
import json
import logging
import re
import traceback
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from asyncio import get_running_loop
from concurrent.futures import ThreadPoolExecutor
from functools import partial

log = logging.getLogger(__name__)

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from routers.home_db import (
    add_widget, create_home_page, delete_home_page, delete_widget,
    duplicate_home_page, get_home_page, get_home_pages, get_widget_by_id,
    get_widgets, reorder_widgets, rename_home_page, update_page_config,
    update_widget_config, update_widget_style,
)
from routers.home_rss_db import (
    get_all_rss_widget_feeds,
    sync_widget_feeds_to_rss_pages,
)
from routers.notes_db import search_notes
from routers.workspaces_db import get_all_workspaces
from templates_env import templates

router = APIRouter(prefix="/home")

_ERR  = "<span class='text-red-500 text-xs'>{}</span>"
_POOL = ThreadPoolExecutor(max_workers=4)   # small pool for sync URL fetches


def _uid(request: Request) -> int:
    return request.session["user_id"]


async def _user_notes(uid: int, limit: int = 50) -> list[dict]:
    """Return recent notes scoped to this user's workspaces.

    Used for the note-link widget picker.  Calling search_notes() without a
    workspace filter exposes notes from ALL users — never do that.
    """
    workspaces = await get_all_workspaces(uid)
    ws_ids = [w["id"] for w in workspaces]
    if not ws_ids:
        return []
    return (await search_notes(workspace_ids=ws_ids))[:limit]


def _fetch_json(url: str) -> dict:
    """Synchronous JSON fetch — runs in the thread-pool executor.
    Uses the Walmart corporate proxy so server-side requests can reach the internet.
    """
    proxy = urllib.request.ProxyHandler({
        "http":  "http://sysproxy.wal-mart.com:8080",
        "https": "http://sysproxy.wal-mart.com:8080",
    })
    opener = urllib.request.build_opener(proxy)
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BookWorm/1.0 (weather proxy)"},
    )
    with opener.open(req, timeout=10) as resp:
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


# ── RSS proxy ────────────────────────────────────────────────────────────────────────────────
# Fetches and parses RSS 2.0 / Atom feeds server-side so Walmart's corporate
# proxy handles the outbound request (browser fetch() is blocked on most feeds).

def _rss_ns(tag: str) -> str:
    """Strip XML namespace braces: {http://...}tag -> tag."""
    return tag.split('}')[-1] if '}' in tag else tag


# XML namespace constants for thumbnail extraction
_NS_MEDIA = 'http://search.yahoo.com/mrss/'
_NS_YT    = 'http://www.youtube.com/xml/schemas/2015'
_NS_ATOM  = 'http://www.w3.org/2005/Atom'


def _thumb_from_atom(entry) -> str:
    """Extract thumbnail URL from an Atom feed entry (YouTube, media:* namespaces)."""
    # YouTube namespace: yt:videoId is the most reliable source
    vid = entry.findtext(f'{{{_NS_YT}}}videoId')
    if vid:
        return f'https://img.youtube.com/vi/{vid.strip()}/mqdefault.jpg'
    # media:group > media:thumbnail (common in YouTube Atom)
    grp = entry.find(f'{{{_NS_MEDIA}}}group')
    if grp is not None:
        t = grp.find(f'{{{_NS_MEDIA}}}thumbnail')
        if t is not None and (u := t.get('url', '')):
            return u
    # media:thumbnail at entry level
    t = entry.find(f'{{{_NS_MEDIA}}}thumbnail')
    if t is not None and (u := t.get('url', '')):
        return u
    # Fallback: YouTube URL pattern in the <link> href
    link_el = entry.find(f'{{{_NS_ATOM}}}link')
    href = (link_el.get('href', '') if link_el is not None else '')
    m = re.search(r'(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})', href)
    if m:
        return f'https://img.youtube.com/vi/{m.group(1)}/mqdefault.jpg'
    return ''


def _thumb_from_rss(item) -> str:
    """Extract thumbnail URL from an RSS 2.0 item element."""
    # media:thumbnail / media:content
    for tag in [f'{{{_NS_MEDIA}}}thumbnail', f'{{{_NS_MEDIA}}}content']:
        el = item.find(tag)
        if el is not None:
            u = el.get('url') or el.get('href', '')
            if u:
                return u
    # media:group > media:thumbnail
    grp = item.find(f'{{{_NS_MEDIA}}}group')
    if grp is not None:
        t = grp.find(f'{{{_NS_MEDIA}}}thumbnail')
        if t is not None and (u := t.get('url', '')):
            return u
    # <enclosure type="image/..."> fallback
    enc = item.find('enclosure')
    if enc is not None and 'image' in (enc.get('type') or ''):
        return enc.get('url', '')
    # YouTube video ID in <link>
    link = (item.findtext('link') or '').strip()
    m = re.search(r'(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})', link)
    if m:
        return f'https://img.youtube.com/vi/{m.group(1)}/mqdefault.jpg'
    # First <img src> in description HTML
    desc = item.findtext('description') or ''
    m2 = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc, re.IGNORECASE)
    if m2:
        return m2.group(1)
    return ''


def _parse_rss(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    tag  = _rss_ns(root.tag)

    # ─ Atom feed ──────────────────────────────────────────────────────────────────────────────
    if tag == 'feed':
        ns   = _NS_ATOM
        ftxt = lambda el, child: (el.findtext(f'{{{ns}}}{child}') or '').strip()
        title = ftxt(root, 'title')
        items = []
        for entry in root.findall(f'{{{ns}}}entry'):
            link_el = entry.find(f'{{{ns}}}link')
            link    = (link_el.get('href') if link_el is not None else '') or ''
            summary = (entry.findtext(f'{{{ns}}}summary') or
                       entry.findtext(f'{{{ns}}}content') or '').strip()
            pub     = (entry.findtext(f'{{{ns}}}published') or
                       entry.findtext(f'{{{ns}}}updated') or '').strip()
            items.append({'title': ftxt(entry, 'title'), 'link': link,
                          'description': summary, 'pub_date': pub,
                          'thumbnail': _thumb_from_atom(entry)})
        return {'feed_title': title, 'items': items}

    # ─ RSS 2.0 ────────────────────────────────────────────────────────────────────────────────
    channel = root.find('channel') or root
    title   = (channel.findtext('title') or '').strip()
    items   = []
    for item in channel.findall('item'):
        link = (item.findtext('link') or '').strip()
        desc = (item.findtext('description') or '').strip()
        pub  = (item.findtext('pubDate') or item.findtext('dc:date') or '').strip()
        items.append({'title': (item.findtext('title') or '').strip(),
                      'link': link, 'description': desc, 'pub_date': pub,
                      'thumbnail': _thumb_from_rss(item)})
    return {'feed_title': title, 'items': items}


# Mimic a real browser so sites like YouTube don't return 404/403.
_RSS_UA = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/124.0.0.0 Safari/537.36'
)


def _fetch_raw(url: str) -> tuple:
    """Fetch URL through Walmart proxy. Returns (text, content_type_header)."""
    proxy  = urllib.request.ProxyHandler({
        'http':  'http://sysproxy.wal-mart.com:8080',
        'https': 'http://sysproxy.wal-mart.com:8080',
    })
    opener = urllib.request.build_opener(proxy)
    req    = urllib.request.Request(url, headers={
        'User-Agent': _RSS_UA,
        'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*',
    })
    with opener.open(req, timeout=15) as resp:
        ct_header = resp.headers.get_content_type() or ''
        charset   = resp.headers.get_content_charset() or 'utf-8'
        return resp.read().decode(charset, errors='replace'), ct_header


def _fetch_bytes(url: str) -> tuple[bytes, str]:
    """Fetch binary content (e.g. images) through Walmart proxy.
    Returns (raw_bytes, content_type).  Raises on non-2xx."""
    proxy  = urllib.request.ProxyHandler({
        'http':  'http://sysproxy.wal-mart.com:8080',
        'https': 'http://sysproxy.wal-mart.com:8080',
    })
    opener = urllib.request.build_opener(proxy)
    req    = urllib.request.Request(url, headers={'User-Agent': _RSS_UA})
    with opener.open(req, timeout=10) as resp:
        ct = resp.headers.get_content_type() or 'application/octet-stream'
        return resp.read(), ct


def _autodiscover_feed_url(html: str, base_url: str) -> str | None:
    """Scan HTML for RSS/Atom autodiscovery <link> tags.

    Handles both attribute orderings:
      <link rel="alternate" type="application/rss+xml" href="...">
      <link href="..." type="application/atom+xml" rel="alternate">
    """
    import re
    patterns = [
        r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]*href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]*type=["\']application/(?:rss|atom)\+xml["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return urllib.parse.urljoin(base_url, m.group(1))
    return None


@router.get('/rss')
async def rss_proxy(url: str = Query(...)):
    """Fetch + parse an RSS/Atom feed server-side, with HTML autodiscovery fallback."""
    try:
        loop           = get_running_loop()
        text, ct_hdr   = await loop.run_in_executor(_POOL, partial(_fetch_raw, url))

        # ── HTML autodiscovery ────────────────────────────────────────────────
        # If the response is HTML (e.g. a YouTube channel page, a blog home),
        # scan for <link rel="alternate" type="application/rss+xml"> and follow it.
        sniff  = text.lstrip()[:300].lower()
        is_html = ('html' in ct_hdr) or sniff.startswith('<!doctype') or '<html' in sniff
        if is_html:
            feed_url = _autodiscover_feed_url(text, url)
            if not feed_url:
                hint = (
                    'Tip: for YouTube, use the channel\'s RSS URL directly: '
                    'https://www.youtube.com/feeds/videos.xml?channel_id=UC…'
                ) if 'youtube.com' in url else (
                    'That URL returned an HTML page with no RSS/Atom link. '
                    'Try finding the \'Subscribe\' or \'RSS\' button on the site.'
                )
                return JSONResponse({'error': hint}, status_code=422)
            # Follow the discovered feed URL
            text, _ = await loop.run_in_executor(_POOL, partial(_fetch_raw, feed_url))

        data = _parse_rss(text)
        return JSONResponse(data)

    except ET.ParseError as exc:
        return JSONResponse(
            {'error': f'The feed URL returned invalid XML ({exc}). Make sure you\'re linking directly to an .xml or /feed URL.'},
            status_code=422)
    except urllib.error.HTTPError as exc:
        return JSONResponse(
            {'error': f'Remote server returned HTTP {exc.code} — double-check the URL.'},
            status_code=502)
    except urllib.error.URLError as exc:
        return JSONResponse({'error': str(exc.reason)}, status_code=502)
    except Exception as exc:
        return JSONResponse({'error': str(exc)}, status_code=500)


# ── Article content extractor ───────────────────────────────────────────────────────

class _ArticleExtractor(html.parser.HTMLParser):
    """Minimal stdlib HTML parser that extracts readable paragraphs.

    Strategy: skip noisy/chrome tags entirely, flush paragraph buffers on block
    boundaries, keep only chunks longer than 40 chars as real paragraphs.
    """
    _SKIP  = frozenset({
        'script','style','noscript','nav','header','footer','aside',
        'form','iframe','button','input','select','textarea','svg',
        'figure','figcaption','menu','menuitem','dialog','template',
    })
    _BLOCK = frozenset({
        'p','div','li','blockquote','td','th',
        'h1','h2','h3','h4','h5','h6',
        'article','section','main','pre',
    })

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._cur:  list[str] = []
        self._paras: list[str] = []

    def handle_starttag(self, tag, attrs):
        if self._skip_depth or tag in self._SKIP:
            self._skip_depth += 1
            return
        if tag in self._BLOCK:
            self._flush()

    def handle_endtag(self, tag):
        if self._skip_depth:
            self._skip_depth -= 1
            return
        if tag in self._BLOCK:
            self._flush()

    def handle_data(self, data):
        if not self._skip_depth:
            self._cur.append(data)

    def _flush(self):
        text = ' '.join(''.join(self._cur).split()).strip()
        if len(text) > 40:
            self._paras.append(text)
        self._cur = []

    def result(self) -> list[str]:
        self._flush()
        # De-duplicate consecutive identical paragraphs (ad boilerplate)
        seen, out = set(), []
        for p in self._paras:
            key = p[:80]
            if key not in seen:
                seen.add(key)
                out.append(p)
        return out


def _extract_article(url: str) -> dict:
    """Fetch an article URL and return {title, paragraphs, url}."""
    text, _ = _fetch_raw(url)
    # Best-effort title extraction
    title_m = re.search(r'<title[^>]*>([^<]{1,200})</title>', text, re.IGNORECASE)
    title   = title_m.group(1).strip() if title_m else ''
    # Parse paragraphs
    parser = _ArticleExtractor()
    parser.feed(text)
    paras = parser.result()
    # Cap at ~6 000 chars total to avoid massive payloads
    out, total = [], 0
    for p in paras:
        out.append(p)
        total += len(p)
        if total >= 6_000:
            break
    return {'title': title, 'paragraphs': out, 'url': url}


@router.get('/rss/article')
async def article_proxy(request: Request, url: str = Query(...)):
    """Fetch a full article page and return extracted readable paragraphs.

    Returns JSON: {title, paragraphs:[str], url}
    Only http/https URLs are accepted.
    """
    _uid(request)  # must be logged in
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return JSONResponse({'error': 'invalid url'}, status_code=400)
    try:
        loop = get_running_loop()
        data = await loop.run_in_executor(_POOL, partial(_extract_article, url))
        return JSONResponse(data)
    except urllib.error.HTTPError as exc:
        return JSONResponse({'error': f'HTTP {exc.code}'}, status_code=502)
    except urllib.error.URLError as exc:
        return JSONResponse({'error': str(exc.reason)}, status_code=502)
    except Exception as exc:
        log.warning('article_proxy error %s: %s', url, exc)
        return JSONResponse({'error': str(exc)}, status_code=500)


# ── CRUD: pages (specific routes MUST come before /{page_id} to avoid
#   Starlette matching 'create'/'delete'/etc as a path parameter integer) ────

@router.get('/img')
async def img_proxy(url: str = Query(...)):
    """Proxy an image URL through the Walmart network proxy.

    Only allows http/https and only passes through image/* content types so
    this cannot be used as an open proxy for arbitrary content.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return Response(status_code=400)
    try:
        loop          = get_running_loop()
        data, ct      = await loop.run_in_executor(_POOL, partial(_fetch_bytes, url))
        if not ct.startswith('image/'):
            return Response(status_code=415)   # Unsupported Media Type — not an image
        return Response(
            content=data,
            media_type=ct,
            headers={'Cache-Control': 'public, max-age=3600'},  # cache 1 h in browser
        )
    except urllib.error.HTTPError as exc:
        return Response(status_code=exc.code)
    except Exception:
        return Response(status_code=502)


@router.post("/pages/create", response_class=HTMLResponse)
async def create_page(
    request:   Request,
    name:      str = Form("My Page"),
    emoji:     str = Form("🏠"),
    page_type: str = Form("dashboard"),
):
    uid     = _uid(request)
    page_id = await create_home_page(uid, name, emoji, page_type)
    pages   = await get_home_pages(uid)
    resp    = templates.TemplateResponse(
        request, "partials/home_sidebar.html",
        {"pages": pages, "active_page_id": page_id},
    )
    resp.headers["X-New-Page-Id"] = str(page_id)
    return resp


# ── Page canvas (parameterized — registered AFTER all fixed-path routes) ──────

@router.get("/pages/{page_id}", response_class=HTMLResponse)
async def home_page_view(request: Request, page_id: int):
    """Render a single home-page canvas.

    Every potential failure is caught here so the user always sees a
    readable error and the traceback lands in bw_error.log (next to main.py)
    where it is easy to find even when uvicorn swallows stderr.
    """
    import pathlib, datetime
    _elog = pathlib.Path(__file__).parent.parent / "bw_error.log"

    def _log_err(msg: str) -> None:
        ts = datetime.datetime.now().isoformat(timespec="seconds")
        try:
            with _elog.open("a", encoding="utf-8") as fh:
                fh.write(f"[{ts}] {msg}\n")
        except OSError:
            pass
        log.error(msg)

    # ── Request-level log so we can confirm the fetch is reaching the server ──
    import datetime as _dt
    with open("debug_requests.log", "a") as _f:
        _f.write(f"{_dt.datetime.now().isoformat()} GET /home/pages/{page_id}  uid={request.session.get('user_id', '?')}\n")

    try:
        uid  = _uid(request)
    except Exception as e:
        _log_err(f"home_page_view: _uid failed page_id={page_id} err={e!r}\n{traceback.format_exc()}")
        return HTMLResponse("<div class='p-6 text-red-500'>Session error — please refresh and log in again.</div>", 500)

    try:
        page = await get_home_page(page_id, uid)
    except Exception as e:
        _log_err(f"home_page_view: get_home_page failed page_id={page_id} uid={uid} err={e!r}\n{traceback.format_exc()}")
        return HTMLResponse("<div class='p-6 text-red-500'>DB error loading page.</div>", 500)

    if not page:
        return HTMLResponse("<p class='text-red-500 p-6'>Page not found.</p>", 404)

    try:
        p_type    = page.get("page_type", "dashboard") or "dashboard"
        widgets   = await get_widgets(page_id)
        all_notes = await _user_notes(uid)

        # Route to the correct template per page type.
        # dashboard  → full widget canvas
        # rss        → 3-column RSS Reader
        # everything else → coming-soon placeholder (built in later phases)
        if p_type == "dashboard":
            tmpl = "partials/home_page.html"
        elif p_type == "rss":
            tmpl = "partials/home_page_rss.html"
            # Auto-import feeds from every rss_feed widget this user owns.
            # One-way only: existing reader-page feeds are never removed.
            # This handles the migration case for widgets created before the
            # sync hook was introduced, and is idempotent on repeat visits.
            widget_feeds = await get_all_rss_widget_feeds(uid)
            if widget_feeds:
                await sync_widget_feeds_to_rss_pages(uid, widget_feeds)
        else:
            tmpl = "partials/home_page_coming_soon.html"

        return templates.TemplateResponse(
            request, tmpl,
            {"page": page, "page_type": p_type, "widgets": widgets, "all_notes": all_notes},
        )
    except Exception as e:
        tb = traceback.format_exc()
        _log_err(f"home_page_view: render failed page_id={page_id} uid={uid} err={e!r}\n{tb}")
        return HTMLResponse(
            f"<div class='p-6 font-mono text-xs text-red-500 whitespace-pre-wrap'>"
            f"Error loading page:\n{e}\n\nSee bw_error.log for full traceback.</div>",
            status_code=500,
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


@router.post("/pages/{page_id}/duplicate", response_class=HTMLResponse)
async def duplicate_page(request: Request, page_id: int):
    """Clone a home page + all its widgets and navigate to the copy."""
    uid = _uid(request)
    new_id = await duplicate_home_page(page_id, uid)
    pages  = await get_home_pages(uid)
    resp   = templates.TemplateResponse(
        request, "partials/home_sidebar.html", {"pages": pages}
    )
    resp.headers["X-New-Page-Id"] = str(new_id)
    return resp


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
    # One-way sync: push new widget's feeds → all RSS reader pages for this user.
    if widget_type == "rss_feed":
        await sync_widget_feeds_to_rss_pages(uid, config.get("feeds") or [])
    widgets   = await get_widgets(page_id)
    all_notes = await _user_notes(uid)
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
    # One-way sync: if this is an RSS feed widget, push any new feed URLs
    # into all RSS reader pages for this user (no deletions, no reverse flow).
    widget = await get_widget_by_id(widget_id)
    if widget and widget.get("widget_type") == "rss_feed":
        uid = request.session.get("user_id")
        if uid:
            await sync_widget_feeds_to_rss_pages(int(uid), config.get("feeds") or [])
    return HTMLResponse("", 204)


@router.post("/widgets/{widget_id}/change-style", response_class=HTMLResponse)
async def change_widget_style(
    request: Request,
    widget_id: int,
    style:    str = Form(...),
    page_id:  int = Form(...),
):
    """Update a widget's style and return the refreshed page canvas."""
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse(_ERR.format("Page not found."), 404)
    await update_widget_style(widget_id, style)
    widgets   = await get_widgets(page_id)
    all_notes = await _user_notes(uid)
    return templates.TemplateResponse(
        request, "partials/home_page.html",
        {"page": page, "widgets": widgets, "all_notes": all_notes},
    )


@router.post("/widgets/{widget_id}/delete", response_class=HTMLResponse)
async def del_widget(request: Request, widget_id: int, page_id: int = Form(...)):
    uid  = _uid(request)
    page = await get_home_page(page_id, uid)
    if not page:
        return HTMLResponse(_ERR.format("Forbidden."), 403)
    await delete_widget(widget_id)
    widgets   = await get_widgets(page_id)
    all_notes = await _user_notes(uid)
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
