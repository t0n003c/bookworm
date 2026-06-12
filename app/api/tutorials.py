"""Tutorial importer — parses saved HTML from online course platforms and creates
a database-type workspace with one DB card per lesson.

Supported platforms (primary parser):
  - Showit / BuddyBoss / ProgressAlly (used by courses.katelynjames.com)
    Module headings: sie-menu-items_{N}-text  (nav buttons, no lesson children)
    Lesson items:    sie-dropdown-{N}_{M}-text (separate dropdown blocks, desktop only)
    Mobile duplicates use sie-dropdown-{N}-mobile_{M}-text — automatically skipped.

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

from core.deps import current_user_id


def _uid(request: Request) -> int:
    return current_user_id(request, detail='Not authenticated')


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
    """Scan HTML for embedded video URLs using two strategies.

    Strategy 1 — iframe src/data-src attributes:
      Works on raw view-source HTML (Ctrl+U / View Page Source).

    Strategy 2 — nuclear full-text scan:
      Catches Chrome 'Save Page As → HTML Only' (Ctrl+S) which blanks
      cross-origin iframe src to about:blank but often leaves the Vimeo/
      YouTube URL in JS config blobs, data-* attrs, or HTML-entity strings.
      Also runs on an &amp;-decoded copy to handle HTML-entity-escaped URLs.

    Returns deduplicated list in document order.
    Stored as embed-ready protocol-relative URLs.
    """
    seen: set = set()
    results: list = []

    def _add_vimeo(vid_id: str, h: str = "") -> None:
        embed = "//player.vimeo.com/video/" + vid_id
        if h:
            embed += "?h=" + h
        if embed not in seen:
            seen.add(embed)
            results.append(embed)

    def _add_youtube(vid_id: str) -> None:
        embed = "//www.youtube.com/embed/" + vid_id
        if embed not in seen:
            seen.add(embed)
            results.append(embed)

    def _add_wistia(vid_id: str) -> None:
        embed = "//fast.wistia.com/embed/medias/" + vid_id
        if embed not in seen:
            seen.add(embed)
            results.append(embed)

    # ── Strategy 1: iframe src / data-src attributes ──────────────────────────
    iframe_pat = re.compile(
        r'<iframe[^>]+(?:src|data-src)=["\']([^"\']+)["\']',
        re.IGNORECASE | re.DOTALL,
    )
    for m in iframe_pat.finditer(html_text):
        raw = m.group(1).strip()
        v = re.search(r'player\.vimeo\.com/video/(\d+)', raw)
        if v:
            h_m = re.search(r'[?&]h=([A-Za-z0-9]+)', raw)
            _add_vimeo(v.group(1), h_m.group(1) if h_m else "")
            continue
        y = re.search(r'youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]+)', raw)
        if y:
            _add_youtube(y.group(1))
            continue
        w = re.search(r'fast\.wistia\.com/embed/medias/([A-Za-z0-9]+)', raw)
        if w:
            _add_wistia(w.group(1))

    # ── Strategy 2: nuclear full-text scan ────────────────────────────────────
    # Run on both the raw text AND an &amp;-decoded copy, because HTML
    # serialisers encode & as &amp; inside attribute values.
    for corpus in (html_text, html_text.replace("&amp;", "&")):
        for vm in re.finditer(
            r'player\.vimeo\.com/video/(\d{5,})', corpus, re.IGNORECASE
        ):
            nearby = corpus[vm.start():vm.start() + 200]
            h_m = re.search(r'[?&]h=([A-Za-z0-9]+)', nearby)
            _add_vimeo(vm.group(1), h_m.group(1) if h_m else "")
        for vid_id in re.findall(
            r'youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{6,})', corpus, re.IGNORECASE
        ):
            _add_youtube(vid_id)
        for vid_id in re.findall(
            r'fast\.wistia\.com/embed/medias/([A-Za-z0-9]{6,})', corpus, re.IGNORECASE
        ):
            _add_wistia(vid_id)

    return results


def _extract_lesson_info(html_text: str, filename: str = "") -> dict:
    """Parse a single lesson-page HTML and return lesson identification + video URL.

    Detection priority for lesson number:
      1. filename slug  (e.g. lesson-1-intro-to-composition.html)
      2. <title> tag    (e.g. "Lesson 1 : Intro to composition")
      3. <link rel=canonical> or <meta og:url> href slug
      4. first <h1>/<h2>/<h3> containing "lesson N"

    Video detection uses _extract_video_urls (iframe-based) plus:
      - Wistia async div class (wistia_async_HASHEDID)
      - data-wistia-id attribute
    """
    soup = BeautifulSoup(html_text, "html.parser")

    lesson_num: Optional[int] = None

    # 1. Filename slug
    fn_m = re.search(r'lesson[-_](\d+)', filename, re.I)
    if fn_m:
        lesson_num = int(fn_m.group(1))

    # 2. <title>
    if lesson_num is None:
        title_tag = soup.find("title")
        if title_tag:
            m = re.search(r'\blesson\s*#?\s*(\d+)\b', title_tag.get_text(), re.I)
            if m:
                lesson_num = int(m.group(1))

    # 3. Canonical URL / og:url
    if lesson_num is None:
        for tag, attr in [
            (soup.find("link", rel="canonical"), "href"),
            (soup.find("meta", property="og:url"), "content"),
        ]:
            if tag and tag.get(attr):
                m = re.search(r'/lesson[-_](\d+)[-/]', tag[attr], re.I)
                if m:
                    lesson_num = int(m.group(1))
                    break

    # 4. First heading containing "lesson N"
    if lesson_num is None:
        for h in soup.find_all(["h1", "h2", "h3"]):
            m = re.search(r'\blesson\s*#?\s*(\d+)\b', h.get_text(), re.I)
            if m:
                lesson_num = int(m.group(1))
                break

    # Video: iframe-based (Vimeo / YouTube / Wistia)
    video_urls = _extract_video_urls(html_text)

    # Video: data-vimeo-id attribute (ProgressAlly / custom Vimeo embeds)
    if not video_urls:
        el = soup.find(attrs={"data-vimeo-id": True})
        if el:
            h = el.get("data-vimeo-h") or el.get("data-h") or ""
            vid = "//player.vimeo.com/video/" + str(el["data-vimeo-id"])
            video_urls = [vid + ("?h=" + h if h else "")]

    # Video: Vimeo Player JS API — new Vimeo.Player(el, {id: 12345678})
    # ProgressAlly initialises the player via script, not an <iframe> in the DOM.
    if not video_urls:
        m = re.search(
            r'Vimeo\.Player\s*\([^)]*?[{,]\s*["\']?id["\']?\s*:\s*(\d{5,})',
            html_text, re.DOTALL,
        )
        if m:
            config_nearby = html_text[m.start():m.start() + 500]
            h_m = re.search(r'["\']?h["\']?\s*:\s*["\']([A-Za-z0-9]+)["\']', config_nearby)
            h = h_m.group(1) if h_m else ""
            video_urls = ["//player.vimeo.com/video/" + m.group(1) + ("?h=" + h if h else "")]

    # Video: Vimeo player URL anywhere in <script> tags
    # Catches JSON config blobs like: "url":"https://vimeo.com/12345678" or
    # src="https://player.vimeo.com/video/12345678?h=abc123"
    if not video_urls:
        for script in soup.find_all("script"):
            text = script.get_text(" ", strip=True)
            m = re.search(r'player\.vimeo\.com/video/(\d{5,})', text)
            if not m:
                m = re.search(
                    r'vimeo\.com/(?:video/)?([0-9]{5,})(?:[?/"\']|$)', text
                )
            if m:
                nearby = text[m.start():m.start() + 200]
                h_m = re.search(r'[?&]h=([A-Za-z0-9]+)', nearby)
                video_urls = ["//player.vimeo.com/video/" + m.group(1) + ("?h=" + h_m.group(1) if h_m else "")]
                break

    # Video: Wistia async div class — wistia_async_<hashedId>
    if not video_urls:
        wistia_pat = re.compile(r'\bwistia_async_([A-Za-z0-9]+)\b')
        m = wistia_pat.search(html_text)
        if m:
            video_urls = ["//fast.wistia.com/embed/medias/" + m.group(1)]

    # Video: data-wistia-id attribute
    if not video_urls:
        el = soup.find(attrs={"data-wistia-id": True})
        if el:
            video_urls = ["//fast.wistia.com/embed/medias/" + el["data-wistia-id"]]

    title_tag = soup.find("title")
    lesson_title = (
        re.sub(r"\s+", " ", title_tag.get_text().strip()) if title_tag else ""
    )

    return {
        "lesson_num":   lesson_num,
        "lesson_title": lesson_title,
        "video_url":    video_urls[0] if video_urls else "",
    }


# ── Primary parser: Showit / BuddyBoss / ProgressAlly ────────────────────────

_MENU_ITEM_PAT = re.compile(r"^sie-menu-items_(\d+)-text$")
# Desktop-only lesson pattern — excludes -mobile- variants
_DROPDOWN_PAT  = re.compile(r"^sie-dropdown-(\d+)_(\d+)-text$")


def _extract_modules_showit(soup: BeautifulSoup):
    """Showit / BuddyBoss / ProgressAlly course page parser.

    Module headings live in sie-menu-items_{N}-text elements.
    Lesson items live in sie-dropdown-{N}_{M}-text elements (desktop variant).
    Mobile duplicates (sie-dropdown-{N}-mobile_{M}-text) are skipped automatically.

    Returns (modules_list, warnings_list).
    """
    # ── Step 1: collect module headings in DOM order ───────────────────────────
    seen_n = set()
    modules_raw = []  # [(N, heading_text)]

    for el in soup.find_all(True):
        for c in el.get("class", []):
            m = _MENU_ITEM_PAT.match(c)
            if m:
                N = int(m.group(1))
                if N in seen_n:
                    break
                text = re.sub(r"\s+", " ", el.get_text(separator=" ", strip=True))
                if text:
                    seen_n.add(N)
                    modules_raw.append((N, text))
                break

    # Keep only headings that look like module labels (contain "Module" etc.)
    module_keywords = re.compile(r'\b(module|section|part|unit|chapter)\b', re.I)
    modules_filtered = [(N, t) for N, t in modules_raw if module_keywords.search(t)]

    # Fall back to all sie-menu-items headings if none match the keyword filter
    if not modules_filtered:
        modules_filtered = modules_raw

    modules_filtered.sort(key=lambda x: x[0])

    if not modules_filtered:
        return [], []

    # ── Step 2: collect lesson items (desktop only) ───────────────────────────
    lessons_by_dropdown = {}  # dropdown_N -> [(M, text)]
    seen_cells = set()  # (N, M) dedup

    for el in soup.find_all(True):
        for c in el.get("class", []):
            m = _DROPDOWN_PAT.match(c)
            if m:
                N, M = int(m.group(1)), int(m.group(2))
                key = (N, M)
                if key in seen_cells:
                    break
                text = re.sub(r"\s+", " ", el.get_text(separator=" ", strip=True))
                if text:
                    seen_cells.add(key)
                    lessons_by_dropdown.setdefault(N, []).append((M, text))
                break

    for N in lessons_by_dropdown:
        lessons_by_dropdown[N].sort(key=lambda x: x[0])

    dropdown_keys = sorted(lessons_by_dropdown.keys())
    modules = []

    # Zip module headings with dropdown groups in order
    for idx, (_, mod_name) in enumerate(modules_filtered):
        if idx < len(dropdown_keys):
            dk = dropdown_keys[idx]
            lessons = [
                {"title": text, "video_url": ""}
                for _, text in lessons_by_dropdown[dk]
            ]
        else:
            lessons = []
        modules.append({"name": mod_name, "lessons": lessons})

    # Extra dropdown groups beyond the module count → append as bonus section
    for idx in range(len(modules_filtered), len(dropdown_keys)):
        dk = dropdown_keys[idx]
        lessons = [{"title": t, "video_url": ""} for _, t in lessons_by_dropdown[dk]]
        if lessons:
            modules.append({"name": "Extra Resources", "lessons": lessons})

    return modules, []


# ── Fallback parser: generic anchor-based ────────────────────────────────────

def _extract_modules_generic(soup: BeautifulSoup):
    """Fallback: group <a href=/lesson/...> tags by nearest <ul>/<ol> ancestor.

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
            t = re.sub(r"\s+", " ", a.get_text(separator=" ", strip=True))[:200]
            if t and t not in seen:
                seen.add(t)
                lessons.append({"title": t, "video_url": ""})

        if lessons:
            heading_el = ul.find_previous(["h1", "h2", "h3", "h4"])
            mod_name = (heading_el.get_text(strip=True) if heading_el else "") or "Module"
            modules.append({"name": mod_name[:200], "lessons": lessons})

    return modules, warn


# ── Top-level orchestrator ────────────────────────────────────────────────────

def _parse_course_html(html_text: str) -> dict:
    """Parse raw course HTML. Returns course structure dict."""
    soup = BeautifulSoup(html_text, "html.parser")
    course_name = _extract_course_name(soup)
    warnings = []

    # Primary: Showit / BuddyBoss / ProgressAlly
    modules, extra_warns = _extract_modules_showit(soup)
    parser_mode = "showit"
    warnings.extend(extra_warns)

    # Fallback: generic anchor scanner
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

        # Default note template — gives every lesson card a ready-to-fill structure.
        _NOTE_TMPL = (
            "<h3>\U0001f4dd Lesson Notes</h3>"
            "<p></p>"
            "<h3>\U0001f4a1 Key Takeaways</h3>"
            "<ul><li></li></ul>"
            "<h3>\U0001f517 Resources &amp; Links</h3>"
            "<p></p>"
        )

        for mod in modules:
            for lesson in mod["lessons"]:
                title = lesson["title"].strip()
                if not title:
                    skipped += 1
                    continue
                lesson_num += 1
                c_cur = await db.execute(
                    "INSERT INTO db_cards (db_id, user_id, title, note_content, sort_order) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (ws_id, user_id, title, _NOTE_TMPL, lesson_num * 10),
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


@router.post("/import-lesson-video/{ws_id}")
async def import_lesson_videos(
    request: Request,
    ws_id: int,
    files: list[UploadFile] = File(...),
):
    """Accept HTML files saved from individual lesson pages.

    For each file:
      - Extracts the lesson number (from filename slug, <title>, canonical URL, heading)
      - Extracts the embedded video URL (Vimeo / YouTube / Wistia)
      - Finds the matching db_card by 'Lesson #' attr in this workspace
      - Updates that card's 'Video URL' attr

    Returns JSON list of per-file results for display in the import modal.
    """
    user_id = _uid(request)
    results = []

    async with get_db() as db:
        for f in files:
            fname = f.filename or ""
            raw = await f.read()
            if len(raw) > _MAX_HTML_BYTES:
                results.append({"filename": fname, "error": "File too large (max 5 MB)",
                                 "lesson_num": None, "video_url": "",
                                 "matched": False, "card_title": None})
                continue

            html_text = raw.decode("utf-8", errors="replace")
            info = _extract_lesson_info(html_text, fname)
            row_result = {
                "filename":    fname,
                "lesson_num":  info["lesson_num"],
                "lesson_title": info["lesson_title"],
                "video_url":   info["video_url"],
                "matched":     False,
                "card_title":  None,
                "card_id":     None,
                "error":       None,
            }

            if info["lesson_num"] is None:
                row_result["error"] = "Could not detect lesson number"
            elif not info["video_url"]:
                row_result["error"] = "No video embed found in this page"
            else:
                cur = await db.execute(
                    """
                    SELECT dc.id, dc.title
                    FROM db_cards dc
                    JOIN db_card_attrs dca ON dca.card_id = dc.id
                    WHERE dc.db_id = ? AND dc.user_id = ?
                      AND dca.attr_key = 'Lesson #' AND dca.attr_value = ?
                    """,
                    (ws_id, user_id, str(info["lesson_num"])),
                )
                card_row = await cur.fetchone()
                if not card_row:
                    row_result["error"] = f"No card found for Lesson #{info['lesson_num']}"
                else:
                    await db.execute(
                        "UPDATE db_card_attrs SET attr_value = ? "
                        "WHERE card_id = ? AND attr_key = 'Video URL'",
                        (info["video_url"], card_row["id"]),
                    )
                    row_result["matched"]    = True
                    row_result["card_id"]    = card_row["id"]
                    row_result["card_title"] = card_row["title"]

            results.append(row_result)

        await db.commit()

    return JSONResponse(results)
