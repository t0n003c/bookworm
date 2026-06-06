"""Auto-fetch video URLs from course lesson pages using a browser cookie.

Workflow:
  1. User pastes the course index page source (Ctrl+U) — we extract all lesson URLs
  2. User pastes their Cookie header from DevTools Network tab
  3. We fetch each lesson page server-side, extract the Vimeo/YT/Wistia embed,
     and bulk-update the 'Video URL' attr on matching DB cards.

Only stdlib + already-installed deps (BeautifulSoup, FastAPI, aiosqlite).
"""
from __future__ import annotations

import asyncio
import re
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from database import get_db
from routers.tutorials import _extract_video_urls, _uid

router = APIRouter(prefix="/tutorials", tags=["tutorials"])

_MAX_RESP_BYTES = 5 * 1024 * 1024   # 5 MB cap per lesson page
_FETCH_TIMEOUT  = 15                 # seconds per request
_FETCH_DELAY    = 0.4                # polite pause between requests
_MAX_CONCURRENT = 3                  # simultaneous fetches

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


# ── URL extractor ─────────────────────────────────────────────────────────────

def _extract_lesson_urls(html_text: str) -> dict:
    """Scan all <a href> tags for lesson page URLs.

    Returns {lesson_num: absolute_url}.
    Resolves relative URLs using the canonical / og:url base.
    Handles both /lesson-N-slug/ and /lesson_N_slug/ patterns.
    """
    soup = BeautifulSoup(html_text, "html.parser")

    # Resolve relative hrefs against the page's own origin
    base_url = ""
    for tag, attr in [
        (soup.find("link", rel="canonical"), "href"),
        (soup.find("meta", property="og:url"), "content"),
    ]:
        if tag and tag.get(attr):
            parsed = urlparse(tag[attr])
            base_url = f"{parsed.scheme}://{parsed.netloc}"
            break

    pat = re.compile(r"/lesson[-_](\d+)[-_/]", re.IGNORECASE)
    lesson_map: dict = {}
    seen: set = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        m = pat.search(href)
        if not m:
            continue
        num = int(m.group(1))
        if num in seen:
            continue
        seen.add(num)
        if href.startswith("http"):
            url = href
        elif base_url:
            url = urljoin(base_url, href)
        else:
            url = href
        lesson_map[num] = url

    return lesson_map


# ── HTTP fetch ─────────────────────────────────────────────────────────────────────
#
# Three-tier strategy:
#   1. Direct urllib   — fastest, works when DNS is open
#   2. Walmart proxy   — urllib + sysproxy, SSL verify off (Walmart CA)
#   3. PowerShell IWR  — Invoke-WebRequest -UseDefaultCredentials;
#                         Windows SSO handles NTLM proxy auth transparently

_WALMART_PROXY = "http://sysproxy.wal-mart.com:8080"


def _build_opener(use_proxy: bool) -> urllib.request.OpenerDirector:
    import ssl
    if use_proxy:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode    = ssl.CERT_NONE
        proxy = urllib.request.ProxyHandler({
            "http":  _WALMART_PROXY,
            "https": _WALMART_PROXY,
        })
        return urllib.request.build_opener(
            proxy, urllib.request.HTTPSHandler(context=ctx))
    return urllib.request.build_opener()


def _urllib_fetch(url: str, cookie: str, use_proxy: bool) -> tuple:
    """Single urllib attempt. Returns (html, error)."""
    opener = _build_opener(use_proxy)
    req = urllib.request.Request(url)
    req.add_header("Cookie", cookie)
    req.add_header("User-Agent", _UA)
    req.add_header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
    req.add_header("Accept-Language", "en-US,en;q=0.9")
    req.add_header("Referer", url)
    try:
        with opener.open(req, timeout=_FETCH_TIMEOUT) as resp:
            data    = resp.read(_MAX_RESP_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
            html    = data.decode(charset, errors="replace")
            if re.search(r'<form[^>]+action=["\'][^"\']*login', html, re.I):
                return None, "Cookie expired — login form detected"
            return html, None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} {e.reason}"
    except urllib.error.URLError as e:
        return None, f"URLError: {e.reason}"
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def _ps_cleanup(*paths: str) -> None:
    for p in paths:
        try:
            if p and __import__("os").path.exists(p):
                __import__("os").unlink(p)
        except Exception:
            pass


def _powershell_fetch(url: str, cookie: str) -> tuple:
    """Use PowerShell Invoke-WebRequest -UseDefaultCredentials.

    Windows SSO provides NTLM credentials to the corporate proxy automatically—
    same mechanism the browser uses, no passwords required.
    Cookie + URL passed via environment variables (not in the script text).
    """
    import subprocess, tempfile, os

    tmp  = tempfile.gettempdir()
    pid  = os.getpid()
    ps_path  = os.path.join(tmp, f"bw_fetch_{pid}.ps1")
    out_path = os.path.join(tmp, f"bw_fetch_{pid}.txt")
    out_ps   = out_path.replace("\\", "\\\\")

    script = (
        "$ProgressPreference = 'SilentlyContinue'\n"
        "$url    = $env:BW_FETCH_URL\n"
        "$cookie = $env:BW_FETCH_COOKIE\n"
        "try {\n"
        "  $r = Invoke-WebRequest -Uri $url "
        "-Headers @{Cookie=$cookie; 'User-Agent'='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0'} "
        "-UseDefaultCredentials -UseBasicParsing -TimeoutSec 15\n"
        f"  [System.IO.File]::WriteAllText('{out_ps}', $r.Content, [System.Text.Encoding]::UTF8)\n"
        "} catch {\n"
        f"  [System.IO.File]::WriteAllText('{out_ps}', 'PSERR:' + $_.Exception.Message, [System.Text.Encoding]::UTF8)\n"
        "  exit 1\n"
        "}"
    )

    try:
        with open(ps_path, "w", encoding="utf-8") as f:
            f.write(script)

        env = os.environ.copy()
        env["BW_FETCH_URL"]    = url
        env["BW_FETCH_COOKIE"] = cookie

        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-File", ps_path],
            capture_output=True, timeout=25, env=env,
        )

        if not os.path.exists(out_path):
            return None, "PowerShell produced no output file"
        with open(out_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        _ps_cleanup(ps_path, out_path)

        if content.startswith("PSERR:"):
            return None, "PowerShell: " + content[6:300].strip()
        if len(content) < 100:
            return None, "PowerShell returned empty response"
        if re.search(r'<form[^>]+action=["\'][^"\']*login', content, re.I):
            return None, "Cookie expired — login form detected"
        return content, None

    except subprocess.TimeoutExpired:
        _ps_cleanup(ps_path, out_path)
        return None, "PowerShell fetch timed out"
    except FileNotFoundError:
        _ps_cleanup(ps_path, out_path)
        return None, "powershell.exe not found"
    except Exception as e:
        _ps_cleanup(ps_path, out_path)
        return None, f"PowerShell: {type(e).__name__}: {e}"


def _fetch_sync(url: str, cookie: str) -> tuple:
    """Fetch url with cookie. Returns (html, error_str).

    Strips accidental 'Cookie: ' prefix, then tries 3 strategies:
      1. Direct urllib
      2. urllib + Walmart proxy (SSL bypass for Walmart CA inspection)
      3. PowerShell Invoke-WebRequest -UseDefaultCredentials (NTLM SSO)
    """
    cookie = re.sub(r'^cookie:\s*', '', cookie.strip(), flags=re.IGNORECASE)

    html, e1 = _urllib_fetch(url, cookie, use_proxy=False)
    if html:
        return html, None

    html, e2 = _urllib_fetch(url, cookie, use_proxy=True)
    if html:
        return html, None

    html, e3 = _powershell_fetch(url, cookie)
    if html:
        return html, None

    return None, f"Direct: {e1} | Proxy: {e2} | PowerShell: {e3}"


async def _fetch(url: str, cookie: str) -> tuple:
    return await asyncio.to_thread(_fetch_sync, url, cookie)


# ── Diagnostic test endpoint ───────────────────────────────────────────────────

@router.post("/test-fetch")
async def test_fetch(request: Request, url: str = Form(""), cookie_header: str = Form("")):
    """Test connectivity to a single URL — returns success/error detail."""
    _uid(request)
    if not url.strip():
        raise HTTPException(422, "URL required")
    html, err = await _fetch(url.strip(), cookie_header.strip())
    if err:
        return JSONResponse({"ok": False, "error": err, "url": url})
    vids = _extract_video_urls(html)
    return JSONResponse({
        "ok":       True,
        "url":      url,
        "html_len": len(html),
        "videos":   vids,
    })


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/auto-fetch-videos/{ws_id}")
async def auto_fetch_videos(
    request: Request,
    ws_id: int,
    course_html:   str = Form(""),
    cookie_header: str = Form(""),
):
    """Fetch every lesson page and auto-fill Video URL on matching cards.

    Accepts:
      course_html   — HTML source of the course index page (Ctrl+U → copy all)
      cookie_header — raw Cookie: header value from DevTools Network tab

    Returns JSON summary + per-card result list.
    """
    user_id = _uid(request)

    if not course_html.strip():
        raise HTTPException(422, "Paste the course index page HTML")
    if not cookie_header.strip():
        raise HTTPException(422, "Paste your Cookie header value from DevTools")

    # ── Step 1: extract lesson URLs ────────────────────────────────────────────
    lesson_url_map = _extract_lesson_urls(course_html)
    if not lesson_url_map:
        raise HTTPException(
            422,
            "No lesson links found — make sure you pasted the course index page, "
            "not an individual lesson page",
        )

    # ── Step 2: load cards + attrs ────────────────────────────────────────────
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, title FROM db_cards WHERE db_id = ? AND user_id = ?",
            (ws_id, user_id),
        )
        cards = await cur.fetchall()

    if not cards:
        raise HTTPException(404, "No cards found in this workspace")

    # Build per-card info (lesson_num, current video_url, video_attr_id)
    to_fetch = []
    skipped_have_video = 0
    skipped_no_url = 0

    async with get_db() as db:
        for card in cards:
            card_id, card_title = card[0], card[1]
            acur = await db.execute(
                "SELECT attr_key, attr_value, id FROM db_card_attrs WHERE card_id = ?",
                (card_id,),
            )
            attrs = await acur.fetchall()

            lesson_num   = None
            current_vid  = ""
            video_attr_id = None
            for attr_key, attr_val, attr_id in attrs:
                if attr_key == "Lesson #" and attr_val:
                    try:
                        lesson_num = int(attr_val)
                    except (ValueError, TypeError):
                        pass
                elif attr_key == "Video URL":
                    current_vid   = attr_val or ""
                    video_attr_id = attr_id

            lesson_url = lesson_url_map.get(lesson_num) if lesson_num else None

            if current_vid:
                skipped_have_video += 1
                continue
            if not lesson_url:
                skipped_no_url += 1
                continue

            to_fetch.append({
                "card_id":       card_id,
                "card_title":    card_title,
                "lesson_num":    lesson_num,
                "lesson_url":    lesson_url,
                "video_attr_id": video_attr_id,
            })

    if not to_fetch:
        return JSONResponse({
            "fetched": 0, "matched": 0, "failed": 0,
            "skipped_have_video": skipped_have_video,
            "skipped_no_url":     skipped_no_url,
            "lesson_urls_found":  len(lesson_url_map),
            "results": [],
        })

    # ── Step 3: fetch pages concurrently ──────────────────────────────────────
    sem = asyncio.Semaphore(_MAX_CONCURRENT)

    async def fetch_one(item: dict) -> dict:
        async with sem:
            html, err = await _fetch(item["lesson_url"], cookie_header)
            await asyncio.sleep(_FETCH_DELAY)
        if err:
            return {**item, "video_url": "", "error": err}
        urls = _extract_video_urls(html)
        if not urls:
            return {**item, "video_url": "", "error": "No video embed found on page"}
        return {**item, "video_url": urls[0], "error": None}

    results = list(await asyncio.gather(*[fetch_one(i) for i in to_fetch]))

    # ── Step 4: bulk DB update ────────────────────────────────────────────────
    matched = [r for r in results if r.get("video_url")]
    if matched:
        async with get_db() as db:
            for r in matched:
                await db.execute(
                    "UPDATE db_card_attrs SET attr_value = ? WHERE id = ?",
                    (r["video_url"], r["video_attr_id"]),
                )
            await db.commit()

    return JSONResponse({
        "fetched":            len(results),
        "matched":            len(matched),
        "failed":             len(results) - len(matched),
        "skipped_have_video": skipped_have_video,
        "skipped_no_url":     skipped_no_url,
        "lesson_urls_found":  len(lesson_url_map),
        "results": [
            {
                "card_id":    r["card_id"],
                "card_title": r["card_title"],
                "lesson_num": r["lesson_num"],
                "video_url":  r.get("video_url", ""),
                "error":      r.get("error"),
            }
            for r in results
        ],
    })
