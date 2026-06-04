"""Full-text + TF-IDF hybrid search — Phase 2+4, Hybrid Search Q&A.

Pipeline (mirrors note #265 architecture):
  asyncio.gather(fts5_search, items_fts_search, semantic_search) → merge → top K

Phase 4A additions:
- _items_fts_search(): FTS over search_items (db_cards, workspaces, widgets).
- _fetch_items_meta_sync(): metadata fetch for TF-IDF-only non-note hits.
- semantic_search() now returns [{item_type, item_id, score}] — all callers updated.
- Response shape: adds item_type, item_id, link_data fields (note_id preserved
  as alias when item_type == 'note' for soft backwards compatibility).
- POST /qa/sync-items: superadmin endpoint to trigger widget resync.

Phase 4B additions:
- GET /qa/models now also accepts the requesting user's personal API key so
  regular users can test their own endpoint from the Account modal.

Auth: all endpoints require a valid session. None are in _PUBLIC.
"""
import asyncio
import html as _html_mod
import json
import logging
import re
import sqlite3

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

import os

import httpx

import search_index
import search_llm
from database import DB_PATH, get_db
from routers.auth_db import get_user_llm_settings

log = logging.getLogger(__name__)

# ── HTML → plain-text helper ────────────────────────────────────────
_TAG_RE = re.compile(r'<[^>]+>')

def _strip_html(text: str) -> str:
    """Strip HTML tags and decode entities, preserving STX/ETX highlight markers.

    db_cards store note_content as hljs-annotated HTML.  When that body is
    pulled into a search snippet it would show raw <span class="hljs-*">...
    markup to the user.  This function removes tags and normalises whitespace
    while leaving the \x02/\x03 markers that _bwSqSnippet() uses for <mark>.
    """
    if not text:
        return ""
    text = _TAG_RE.sub(' ', text)        # strip tags → spaces
    text = _html_mod.unescape(text)      # &amp; &lt; etc. → real chars
    text = re.sub(r'[ \t]+', ' ', text)  # collapse horizontal whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)  # at most two newlines
    return text.strip()
router = APIRouter(prefix="/qa", tags=["search-qa"])

_MAX_TOKENS = 20


# ── model discovery (proxied so API key stays server-side) ──────────────

@router.get("/models")
async def list_models(request: Request, endpoint: str = ""):
    """Proxy GET /models to the configured LLM endpoint using the caller's personal key.

    Returns {models: [str]} sorted A-Z, or {models: [], error: str} on failure.
    """
    uid = _uid(request)
    cfg = await get_user_llm_settings(uid)

    base = (endpoint.strip() or cfg["endpoint"]).rstrip("/")
    if not base:
        return {"models": [], "error": "No endpoint configured."}

    headers = {}
    if cfg["api_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    proxy = os.getenv("BW_HTTP_PROXY") or None
    try:
        async with httpx.AsyncClient(
            proxy=proxy, timeout=8.0, follow_redirects=True
        ) as client:
            resp = await client.get(f"{base}/models", headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return {"models": [], "error": str(exc)}

    # OpenAI format: {data: [{id: "..."}]}; some servers return {models: [str]}
    raw = data.get("data") or data.get("models") or []
    ids = sorted(
        {(m["id"] if isinstance(m, dict) else str(m)) for m in raw}
    )
    return {"models": ids}


_MAX_LIMIT  = 50
_FTS5_POOL  = 50   # internal over-fetch for re-ranking


# ── helpers ───────────────────────────────────────────────────────────────

def _uid(request: Request) -> int:
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    return uid


def _build_fts_query(q: str) -> str | None:
    words = re.sub(r'["\'\\^*():\-]', " ", q).split()
    if not words:
        return None
    return " ".join(w + "*" for w in words[:_MAX_TOKENS])


def _bigram_bonus(title: str, words: list) -> float:
    """0.3 if any consecutive query-word pair appears in the title."""
    title_l = title.lower()
    for i in range(len(words) - 1):
        if words[i] + " " + words[i + 1] in title_l:
            return 0.3
    return 0.0


async def _fts5_search(uid: int, fts_query: str) -> list:
    """Run FTS5 over notes and return up to _FTS5_POOL rows with full metadata."""
    sql = """
        SELECT
            n.id                                                        AS item_id,
            'note'                                                      AS item_type,
            n.title,
            snippet(notes_fts, 1, char(2), char(3), '\u2026', 32)          AS snippet,
            bm25(notes_fts)                                             AS bm25_score,
            w.name                                                      AS workspace_name,
            w.emoji                                                     AS workspace_emoji,
            '{}'                                                        AS link_data
        FROM  notes_fts
        JOIN  notes      n ON n.id  = notes_fts.rowid
        JOIN  workspaces w ON w.id  = n.workspace_id
                          AND w.user_id    = ?
                          AND w.deleted_at IS NULL
        WHERE notes_fts MATCH ?
        ORDER BY bm25(notes_fts)
        LIMIT ?
    """
    try:
        async with get_db() as db:
            cur  = await db.execute(sql, (uid, fts_query, _FTS5_POOL))
            rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


async def _items_fts_search(uid: int, fts_query: str) -> list:
    """Run FTS5 over search_items (db_cards, workspaces, widgets) for this user."""
    sql = """
        SELECT
            si.id         AS rowid_alias,
            si.item_id,
            si.item_type,
            si.title,
            si.link_data,
            snippet(search_items_fts, 1, char(2), char(3), '\u2026', 32) AS snippet,
            bm25(search_items_fts)                                        AS bm25_score
        FROM  search_items_fts
        JOIN  search_items si ON si.id = search_items_fts.rowid
        WHERE search_items_fts MATCH ?
          AND si.user_id = ?
        ORDER BY bm25(search_items_fts)
        LIMIT ?
    """
    try:
        async with get_db() as db:
            cur  = await db.execute(sql, (fts_query, uid, _FTS5_POOL))
            rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _fetch_note_meta_sync(note_ids: list, uid: int) -> dict:
    """Sync: fetch title + workspace for TF-IDF-only note hits."""
    if not note_ids:
        return {}
    ph  = ",".join("?" * len(note_ids))
    sql = f"""
        SELECT n.id, n.title, n.content,
               w.name AS workspace_name, w.emoji AS workspace_emoji
        FROM   notes n
        JOIN   workspaces w ON w.id = n.workspace_id AND w.user_id = ?
                           AND w.deleted_at IS NULL
        WHERE  n.id IN ({ph})
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, [uid, *note_ids]).fetchall()
    finally:
        conn.close()
    return {r["id"]: dict(r) for r in rows}


def _fetch_items_meta_sync(item_pairs: list, uid: int) -> dict:
    """Sync: fetch title + link_data for TF-IDF-only non-note hits.

    item_pairs: [(item_type, item_id), ...]
    Returns: {(item_type, item_id): {title, link_data, snippet}}
    """
    if not item_pairs:
        return {}
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    result = {}
    try:
        card_ids = [p[1] for p in item_pairs if p[0] == "db_card"]
        ws_ids   = [p[1] for p in item_pairs if p[0] == "workspace"]
        wgt_ids  = [p[1] for p in item_pairs if p[0] == "widget"]

        if card_ids:
            ph = ",".join("?" * len(card_ids))
            rows = conn.execute(
                f"SELECT si.item_id, si.title, si.body, si.link_data "
                f"FROM search_items si WHERE si.item_type='db_card' "
                f"AND si.item_id IN ({ph}) AND si.user_id=?",
                [*card_ids, uid],
            ).fetchall()
            for r in rows:
                result[("db_card", r["item_id"])] = {
                    "title": r["title"], "snippet": _strip_html((r["body"] or ""))[:150],
                    "link_data": r["link_data"],
                }
        if ws_ids:
            ph = ",".join("?" * len(ws_ids))
            rows = conn.execute(
                f"SELECT si.item_id, si.title, si.link_data "
                f"FROM search_items si WHERE si.item_type='workspace' "
                f"AND si.item_id IN ({ph}) AND si.user_id=?",
                [*ws_ids, uid],
            ).fetchall()
            for r in rows:
                result[("workspace", r["item_id"])] = {
                    "title": r["title"], "snippet": "",
                    "link_data": r["link_data"],
                }
        if wgt_ids:
            ph = ",".join("?" * len(wgt_ids))
            rows = conn.execute(
                f"SELECT si.item_id, si.title, si.body, si.link_data "
                f"FROM search_items si WHERE si.item_type='widget' "
                f"AND si.item_id IN ({ph}) AND si.user_id=?",
                [*wgt_ids, uid],
            ).fetchall()
            for r in rows:
                result[("widget", r["item_id"])] = {
                    "title": r["title"], "snippet": _strip_html((r["body"] or ""))[:150],
                    "link_data": r["link_data"],
                }

        # Phase 5: CRM contacts
        contact_ids = [p[1] for p in item_pairs if p[0] == "crm_contact"]
        if contact_ids:
            ph = ",".join("?" * len(contact_ids))
            rows = conn.execute(
                f"SELECT si.item_id, si.title, si.body, si.link_data "
                f"FROM search_items si WHERE si.item_type='crm_contact' "
                f"AND si.item_id IN ({ph}) AND si.user_id=?",
                [*contact_ids, uid],
            ).fetchall()
            for r in rows:
                result[("crm_contact", r["item_id"])] = {
                    "title": r["title"], "snippet": _strip_html((r["body"] or ""))[:200],
                    "link_data": r["link_data"],
                }
    finally:
        conn.close()
    return result


def _merge_and_score(
    note_fts_rows: list,
    item_fts_rows: list,
    tfidf_hits: list,
    words: list,
    limit: int,
    extra_note_meta: dict | None = None,
    extra_item_meta: dict | None = None,
) -> list:
    """Merge notes FTS5, items FTS5, and TF-IDF into a single ranked list."""
    # Index FTS results by (item_type, item_id)
    fts_by_key = {}
    for r in note_fts_rows:
        key = ("note", r["item_id"])
        fts_by_key[key] = r
    for r in item_fts_rows:
        key = (r["item_type"], r["item_id"])
        fts_by_key[key] = r

    # TF-IDF indexed by (item_type, item_id)
    tfidf_by_key = {(h["item_type"], h["item_id"]): h["score"] for h in tfidf_hits}

    # Collect all unique keys preserving FTS order first
    all_keys = list(dict.fromkeys(list(fts_by_key) + list(tfidf_by_key)))

    extra_note_meta = extra_note_meta or {}
    extra_item_meta = extra_item_meta or {}

    scored = []
    for key in all_keys:
        item_type, item_id = key
        fts_row   = fts_by_key.get(key)
        tfidf_sc  = tfidf_by_key.get(key, 0.0)
        bm25_sc   = fts_row["bm25_score"] if fts_row else 0.0
        title     = (fts_row or {}).get("title") or ""
        if not title:
            if item_type == "note":
                title = extra_note_meta.get(item_id, {}).get("title") or ""
            else:
                title = extra_item_meta.get(key, {}).get("title") or ""
        bigram  = _bigram_bonus(title, words)
        hybrid  = tfidf_sc * 5.0 + (-bm25_sc) + bigram

        if fts_row:
            snippet    = _strip_html(fts_row.get("snippet") or "")
            link_data  = fts_row.get("link_data") or "{}"
            ws_name    = fts_row.get("workspace_name") or ""
            ws_emoji   = fts_row.get("workspace_emoji") or ""
        elif item_type == "note":
            meta       = extra_note_meta.get(item_id, {})
            snippet    = _strip_html((meta.get("content") or ""))[:150]
            link_data  = "{}"
            ws_name    = meta.get("workspace_name") or ""
            ws_emoji   = meta.get("workspace_emoji") or "📁"
        else:
            meta       = extra_item_meta.get(key, {})
            snippet    = _strip_html(meta.get("snippet") or "")
            link_data  = meta.get("link_data") or "{}"
            ws_name    = ""
            ws_emoji   = ""

        try:
            link_obj = json.loads(link_data)
        except (json.JSONDecodeError, ValueError):
            link_obj = {}

        scored.append({
            "item_type":       item_type,
            "item_id":         item_id,
            "title":           title or "Untitled",
            "snippet":         snippet,
            "score":           hybrid,
            "workspace_name":  ws_name,
            "workspace_emoji": ws_emoji,
            "link_data":       link_obj,
            # Backwards compat alias — note_id still present when type is 'note'
            "note_id":         item_id if item_type == "note" else None,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/search")
async def fts_search(request: Request, q: str = "", limit: int = 12):
    """Hybrid FTS5 + TF-IDF search across all content types.

    Returns {results: [...], index_ready: bool}
    When TF-IDF isn't ready, falls back to BM25-only (notes + search_items).
    """
    uid   = _uid(request)
    q     = (q or "").strip()
    if not q:
        return {"results": [], "index_ready": search_index.is_ready()}

    limit     = max(1, min(limit, _MAX_LIMIT))
    words     = re.sub(r'["\'\\^*():\-]', " ", q).split()
    fts_query = _build_fts_query(q)
    if not fts_query:
        return {"results": [], "index_ready": search_index.is_ready()}

    # Run all three searches concurrently
    loop = asyncio.get_running_loop()
    note_fts_task  = asyncio.create_task(_fts5_search(uid, fts_query))
    items_fts_task = asyncio.create_task(_items_fts_search(uid, fts_query))
    tfidf_task     = loop.run_in_executor(
        None, search_index.semantic_search, q, uid, _FTS5_POOL
    )
    note_fts_rows, item_fts_rows, tfidf_hits = await asyncio.gather(
        note_fts_task, items_fts_task, tfidf_task
    )

    # Fallback: no TF-IDF index — return combined FTS5 results only
    if not search_index.is_ready() or not tfidf_hits:
        combined = []
        for r in note_fts_rows:
            combined.append({
                "item_type":       "note",
                "item_id":         r["item_id"],
                "note_id":         r["item_id"],
                "title":           r["title"] or "Untitled",
                "snippet":         _strip_html(r["snippet"] or ""),
                "score":           float(-r["bm25_score"]),
                "workspace_name":  r["workspace_name"] or "",
                "workspace_emoji": r["workspace_emoji"] or "📁",
                "link_data":       {},
            })
        for r in item_fts_rows:
            try:
                link_obj = json.loads(r.get("link_data") or "{}")
            except (json.JSONDecodeError, ValueError):
                link_obj = {}
            combined.append({
                "item_type":       r["item_type"],
                "item_id":         r["item_id"],
                "note_id":         None,
                "title":           r["title"] or "Untitled",
                "snippet":         _strip_html(r["snippet"] or ""),
                "score":           float(-r["bm25_score"]),
                "workspace_name":  "",
                "workspace_emoji": "",
                "link_data":       link_obj,
            })
        combined.sort(key=lambda x: x["score"], reverse=True)
        return {"results": combined[:limit], "index_ready": False}

    # Fetch metadata for TF-IDF-only hits in executors
    all_fts_keys   = {("note", r["item_id"]) for r in note_fts_rows}
    all_fts_keys  |= {(r["item_type"], r["item_id"]) for r in item_fts_rows}
    tfidf_only_notes = [
        h["item_id"] for h in tfidf_hits
        if h["item_type"] == "note" and ("note", h["item_id"]) not in all_fts_keys
    ]
    tfidf_only_items = [
        (h["item_type"], h["item_id"]) for h in tfidf_hits
        if h["item_type"] != "note" and (h["item_type"], h["item_id"]) not in all_fts_keys
    ]

    extra_note_meta: dict = {}
    extra_item_meta: dict = {}
    tasks = []
    if tfidf_only_notes:
        tasks.append(loop.run_in_executor(
            None, _fetch_note_meta_sync, tfidf_only_notes[:20], uid
        ))
    if tfidf_only_items:
        tasks.append(loop.run_in_executor(
            None, _fetch_items_meta_sync, tfidf_only_items[:20], uid
        ))
    if tasks:
        fetched = await asyncio.gather(*tasks)
        idx = 0
        if tfidf_only_notes:
            extra_note_meta = fetched[idx]; idx += 1
        if tfidf_only_items:
            extra_item_meta = fetched[idx]

    results = _merge_and_score(
        note_fts_rows, item_fts_rows, tfidf_hits, words, limit,
        extra_note_meta, extra_item_meta,
    )
    return {"results": results, "index_ready": True}


@router.post("/rebuild-index")
async def rebuild_index_endpoint(request: Request):
    """Superadmin: trigger an immediate TF-IDF index rebuild."""
    _uid(request)
    if request.session.get("role") != "superadmin":
        raise HTTPException(status_code=403)
    asyncio.create_task(search_index.rebuild_index())
    return {"status": "rebuilding", "message": "Rebuild started in background."}


@router.post("/sync-items")
async def sync_items_endpoint(request: Request):
    """Superadmin: trigger an immediate widget search_items resync."""
    _uid(request)
    if request.session.get("role") != "superadmin":
        raise HTTPException(status_code=403)
    asyncio.create_task(search_index.sync_widget_items())
    return {"status": "syncing", "message": "Widget sync started in background."}


@router.post("/sync-crm")
async def sync_crm_endpoint(request: Request):
    """Superadmin: trigger an immediate CRM contact search_items resync."""
    _uid(request)
    if request.session.get("role") != "superadmin":
        raise HTTPException(status_code=403)
    asyncio.create_task(search_index.sync_crm_contacts())
    return {"status": "syncing", "message": "CRM contact sync started in background."}


async def stream_answer(request: Request, q: str = ""):
    """SSE stream — runs hybrid search then streams an LLM answer.

    Format: `data: <json_token>\\n\\n` per chunk; ends with `data: [DONE]\\n\\n`.
    When no LLM endpoint is configured, emits only [DONE] (pure retrieval).
    """
    uid = _uid(request)
    q   = (q or "").strip()
    if not q:
        return StreamingResponse(
            iter(["data: [DONE]\n\n"]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    fts_query = _build_fts_query(q)
    if not fts_query:
        return StreamingResponse(
            iter(["data: [DONE]\n\n"]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Hybrid search — same pipeline as /qa/search
    loop           = asyncio.get_running_loop()
    note_fts_task  = asyncio.create_task(_fts5_search(uid, fts_query))
    items_fts_task = asyncio.create_task(_items_fts_search(uid, fts_query))
    tfidf_task     = loop.run_in_executor(
        None, search_index.semantic_search, q, uid, _FTS5_POOL
    )
    note_fts_rows, item_fts_rows, tfidf_hits = await asyncio.gather(
        note_fts_task, items_fts_task, tfidf_task
    )

    # Build ordered items list for LLM context (notes + cards only)
    words       = re.sub(r'["\'\\^*():\-]', " ", q).split()
    merged      = _merge_and_score(
        note_fts_rows, item_fts_rows, tfidf_hits, words,
        search_llm._CONTEXT_NOTES * 2,  # over-fetch; LLM filter drops ws/widget
    )
    context_items = [
        {"item_type": r["item_type"], "item_id": r["item_id"]}
        for r in merged
        if r["item_type"] in ("note", "db_card", "crm_contact")
    ][:search_llm._CONTEXT_NOTES]

    async def _event_gen():
        try:
            async for token in search_llm.stream_llm(q, context_items, uid):
                yield "data: " + json.dumps(token) + "\n\n"
        except Exception:
            log.exception("/qa/stream: generator error")
            yield "data: [ERROR]\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
