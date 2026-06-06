"""Tutorial importer — parses saved HTML from online course platforms and creates
a database-type workspace with one DB card per lesson.

Supported platforms (primary parser):
  - BuddyBoss / ProgressAlly / Showit (used by courses.katelynjames.com)

Fallback parser:
  - Generic: scans <a href> containing /lesson/ or /module/ in the URL

Design notes:
  - All DB writes in one bulk get_db() transaction (avoids N+1 connections).
  - Uses stdlib html.parser — no lxml dependency.
  - Video URLs stored as embed-ready format (//player.vimeo.com/video/{id}).
  - db_card_attrs uses inline attr_key/attr_value/attr_type per row —
    no separate attr_definitions table needed for imported cards.
"""
from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from database import get_db

router = APIRouter(prefix="/tutorials", tags=["tutorials"])

_MAX_HTML_BYTES = 5 * 1024 * 1024  # 5 MB hard limit


# ── Auth helper ───────────────────────────────────────────────────────────────

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return int(uid)


# ── HTML parser ───────────────────────────────────────────────────────────────

def _extract_course_name(soup: BeautifulSoup) -> str:
    """Priority: <title> strip site suffix -> <h1> -> fallback."""
    title_tag = soup.find("title")
    if title_tag and title_tag.get_text(strip=True):
        raw = title_tag.get_text(strip=True)
        for sep in [" | ", " - ", " \u2013 "]:
            if sep in raw:
                raw = raw.split(sep)[0].strip()
        if raw:
            return raw
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return h1.get_text(strip=True)[:120]
    return "Imported Course"


def _extract_video_urls(html_text: str) -> list:
    """Scan all iframe src/data-src and extract embed-ready URLs.

    Returns deduplicated list in document order.
    Stored as embed-ready format: //platform/embed/{id}
    """
    seen = set()
    results = []

    iframe_pat = re.compile(
        r'<iframe[^>]+(?:src|data-src)=["\']([^"\']+)["\']',
        re.IGNORECASE | re.DOTALL,
    )

    for m in iframe_pat.finditer(html_text):
        raw = m.group(1).strip()

        vimeo = re.search(r'player\.vimeo\.com/video/(\d+)', raw)
        if vimeo:
            embed = "//player.vimeo.com/video/" + vimeo.group(1)
            if embed not in seen:
                seen.add(embed)
                results.append(embed)
            continue

        yt = re.search(r'youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]+)', raw)
        if yt:
            embed = "//www.youtube.com/embed/" + yt.group(1)
            if embed not in seen:
                seen.add(embed)
                results.append(embed)
            continue

        wistia = re.search(r'fast\.wistia\.com/embed/medias/([A-Za-z0-9]+)', raw)
        if wistia:
            embed = "//fast.wistia.com/embed/medias/" + wistia.group(1)
            if embed not in seen:
                seen.add(embed)
                results.append(embed)
            continue

    return results


def _extract_modules_buddyboss(soup: BeautifulSoup) -> list:
    """Primary parser: BuddyBoss / ProgressAlly / Showit platform.

    Module headings use class 'st-m-heading' or 'st-d-heading'.
    Lesson links appear in adjacent sibling <ul>/<ol> elements.
    """
    modules = []
    seen_lessons = set()

    headings = soup.find_all(
        lambda tag: tag.has_attr("class")
        and ("st-m-heading" in tag.get("class", []) or "st-d-heading" in tag.get("class", []))
        and tag.name in ("p", "h1", "h2", "h3", "h4", "span", "div")
    )

    for heading in headings:
        mod_name = heading.get_text(separator=" ", strip=True)
        mod_name = re.sub(r"\s+", " ", mod_name)[:200]
        if not mod_name:
            continue

        lessons = []
        container = heading.parent
        if container:
            sibling = container.find_next_sibling(["ul", "ol"])
            if sibling:
                for li in sibling.find_all("li", recursive=False):
                    a = li.find("a")
                    lesson_title = (a or li).get_text(separator=" ", strip=True)
                    lesson_title = re.sub(r"\s+", " ", lesson_title)[:200]
                    if lesson_title and lesson_title not in seen_lessons:
                        seen_lessons.add(lesson_title)
                        lessons.append({"title": lesson_title, "video_url": ""})

        if mod_name or lessons:
            modules.append({"name": mod_name, "lessons": lessons})

    return modules


def _extract_modules_generic(soup: BeautifulSoup):
    """Fallback parser: group anchor tags by nearest <ul>/<ol> ancestor.

    Returns (modules_list, warning_message).
    """
    warn = "Generic fallback parser used \u2014 module grouping may be approximate"
    modules = []
    seen = set()

    for ul in soup.find_all(["ul", "ol"]):
        links = ul.find_all("a", href=True)
        lesson_links = [
            a for a in links
            if re.search(r'/(lesson|module|unit|chapter|topic)/', a.get("href", ""), re.I)
        ]
        if len(lesson_links) < 2:
            continue

        lessons = []
        for a in lesson_links:
            t = a.get_text(separator=" ", strip=True)
            t = re.sub(r"\s+", " ", t)[:200]
            if t and t not in seen:
                seen.add(t)
                lessons.append({"title": t, "video_url": ""})

        if lessons:
            heading_el = ul.find_previous(["h1", "h2", "h3", "h4"])
            mod_name = (heading_el.get_text(strip=True) if heading_el else "") or "Module"
            modules.append({"name": mod_name[:200], "lessons": lessons})

    return modules, warn


def _parse_course_html(html_text: str) -> dict:
    """Top-level parser. Returns course structure dict."""
    soup = BeautifulSoup(html_text, "html.parser")
    course_name = _extract_course_name(soup)
    warnings = []

    modules = _extract_modules_buddyboss(soup)
    parser_mode = "buddyboss"

    if not modules or all(not m["lessons"] for m in modules):
        modules, warn = _extract_modules_generic(soup)
        parser_mode = "generic"
        warnings.append(warn)

    if not modules:
        warnings.append("No modules or lessons found \u2014 HTML may require manual entry")
        modules = [{"name": "Uncategorized", "lessons": []}]

    # Correlate video URLs with lessons (document order)
    video_urls = _extract_video_urls(html_text)
    vid_idx = 0
    for mod in modules:
        for lesson in mod["lessons"]:
            if vid_idx < len(video_urls):
                lesson["video_url"] = video_urls[vid_idx]
                vid_idx += 1

    if vid_idx < len(video_urls):
        extra = len(video_urls) - vid_idx
        warnings.append(str(extra) + " video URL(s) not matched to any lesson (extras ignored)")

    return {
        "course_name": course_name,
        "modules": modules,
        "warnings": warnings,
        "parser_mode": parser_mode,
    }


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/import-html")
async def import_tutorial_html(
    request: Request,
    html_content: str = Form(""),
    html_file: Optional[UploadFile] = File(None),
    course_title: str = Form(""),
    parent_ws_id: int = Form(0),
):
    """Accept raw HTML (paste or file upload), parse course structure, and
    create a database workspace with one DB card per lesson.

    Returns JSON: {workspace_id, course_name, cards_created, modules_found, skipped, warnings}
    """
    user_id = _uid(request)

    # ── Resolve HTML source ────────────────────────────────────────────────────
    html_text = ""
    if html_file and html_file.filename:
        raw_bytes = await html_file.read()
        if len(raw_bytes) > _MAX_HTML_BYTES:
            raise HTTPException(status_code=413, detail="HTML file too large (max 5 MB)")
        try:
            html_text = raw_bytes.decode("utf-8", errors="replace")
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Could not decode file: " + str(exc)) from exc
    elif html_content:
        if len(html_content.encode("utf-8")) > _MAX_HTML_BYTES:
            raise HTTPException(status_code=413, detail="Pasted HTML too large (max 5 MB)")
        html_text = html_content

    if not html_text.strip():
        raise HTTPException(
            status_code=422,
            detail="No HTML provided \u2014 paste HTML or upload a .html file",
        )

    # ── Parse ──────────────────────────────────────────────────────────────────
    try:
        parsed = _parse_course_html(html_text)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Parse error: " + str(exc)) from exc

    course_name = (course_title.strip() or parsed["course_name"])[:200]
    warnings = parsed["warnings"]
    modules = parsed["modules"]

    # ── Bulk DB transaction (one connection for the entire import) ─────────────
    parent_id = parent_ws_id if parent_ws_id else None

    async with get_db() as db:
        # Name dedup — replicate _unique_sibling_name() logic from workspaces_db.py
        cur = await db.execute(
            "SELECT name FROM workspaces "
            "WHERE user_id=? AND deleted_at IS NULL "
            "AND (parent_id IS ? OR parent_id=?)",
            (user_id, parent_id, parent_id),
        )
        taken = {r[0].strip().lower() for r in await cur.fetchall()}
        candidate = course_name.strip()
        if candidate.lower() in taken:
            n = 2
            while (candidate + " (" + str(n) + ")").lower() in taken:
                n += 1
            candidate = candidate + " (" + str(n) + ")"

        # Sort order for new workspace
        so_cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL AND user_id=?",
            (parent_id, user_id),
        )
        new_sort = (await so_cur.fetchone())[0] + 10

        # Create the database workspace
        ws_cur = await db.execute(
            "INSERT INTO workspaces (name, emoji, parent_id, sort_order, user_id, ws_type) "
            "VALUES (?, ?, ?, ?, ?, 'database')",
            (candidate, "\U0001f393", parent_id, new_sort, user_id),
        )
        ws_id = ws_cur.lastrowid

        # Create cards + attrs in bulk.
        # db_card_attrs stores attr_key/attr_value/attr_type inline —
        # no separate attr_definitions rows needed for imported content.
        lesson_num = 0
        cards_created = 0
        skipped = 0
        attr_rows = []

        for mod in modules:
            for lesson in mod["lessons"]:
                title = lesson["title"].strip()
                if not title:
                    skipped += 1
                    continue
                lesson_num += 1
                c_cur = await db.execute(
                    "INSERT INTO db_cards (db_id, user_id, title, sort_order) "
                    "VALUES (?, ?, ?, ?)",
                    (ws_id, user_id, title, lesson_num * 10),
                )
                card_id = c_cur.lastrowid
                cards_created += 1

                attr_rows.extend([
                    (card_id, "Module",    mod["name"],          "text",   "",                             "always", 0),
                    (card_id, "Lesson #",  str(lesson_num),       "number", "",                             "always", 10),
                    (card_id, "Video URL", lesson["video_url"],   "url",    "",                             "always", 20),
                    (card_id, "Status",    "Not Started",         "select", "Not Started|In Progress|Done", "always", 30),
                ])

        if attr_rows:
            await db.executemany(
                "INSERT INTO db_card_attrs "
                "(card_id, attr_key, attr_value, attr_type, attr_options, visibility, sort_order) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                attr_rows,
            )

        await db.commit()

    return JSONResponse({
        "workspace_id":  ws_id,
        "course_name":   candidate,
        "cards_created": cards_created,
        "modules_found": len(modules),
        "skipped":       skipped,
        "warnings":      warnings,
    })
