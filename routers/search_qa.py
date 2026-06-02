"""Full-text + TF-IDF hybrid search — Phase 2, Hybrid Search Q&A.

Pipeline (mirrors note #265 architecture):
  asyncio.gather(fts5_search, semantic_search) → merge → hybrid_score → top K

Scoring formula (from note #265):
  hybrid = tfidf_score * 5  +  (-bm25_score)  +  bigram_bonus(0.3)

FTS5 supplies the result window and workspace metadata.
TF-IDF contributes re-ranking signal; its note IDs are used to pull
metadata for any candidates the keyword pass missed entirely.

Auth: all endpoints require a valid session. None are in _PUBLIC.
"""
import asyncio
import logging
import re
import sqlite3

from fastapi import APIRouter, HTTPException, Request

import search_index
from database import DB_PATH, get_db

log = logging.getLogger(__name__)
router = APIRouter(prefix="/qa", tags=["search-qa"])

_MAX_TOKENS = 20
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
    """Run FTS5 and return up to _FTS5_POOL rows with full metadata."""
    sql = """
        SELECT
            n.id                                                        AS note_id,
            n.title,
            snippet(notes_fts, 1, char(2), char(3), '\u2026', 32)          AS snippet,
            bm25(notes_fts)                                             AS bm25_score,
            w.name                                                      AS workspace_name,
            w.emoji                                                     AS workspace_emoji
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


def _fetch_meta_sync(note_ids: list, uid: int) -> dict:
    """Sync: fetch title + workspace for a list of note IDs (TF-IDF only hits)."""
    if not note_ids:
        return {}
    placeholders = ",".join("?" * len(note_ids))
    sql = f"""
        SELECT n.id, n.title, n.content,
               w.name AS workspace_name, w.emoji AS workspace_emoji
        FROM   notes n
        JOIN   workspaces w ON w.id = n.workspace_id AND w.user_id = ?
                           AND w.deleted_at IS NULL
        WHERE  n.id IN ({placeholders})
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, [uid, *note_ids]).fetchall()
    finally:
        conn.close()
    return {r["id"]: dict(r) for r in rows}


def _merge_and_score(
    fts_rows: list,
    tfidf_hits: list,
    words: list,
    limit: int,
    extra_meta: dict | None = None,
) -> list:
    """Combine FTS5 and TF-IDF candidates into a single ranked list.

    extra_meta: pre-fetched metadata dict {note_id: row} for TF-IDF-only
    hits — must be fetched and passed by the caller (in an executor) so
    this function stays pure and never blocks the event loop.
    """
    fts_by_id    = {r["note_id"]: r for r in fts_rows}
    tfidf_by_id  = {h["note_id"]: h["score"] for h in tfidf_hits}
    all_note_ids = list(dict.fromkeys(list(fts_by_id) + list(tfidf_by_id)))
    extra_meta   = extra_meta or {}

    scored = []
    for nid in all_note_ids:
        fts_row    = fts_by_id.get(nid)
        tfidf_sc   = tfidf_by_id.get(nid, 0.0)
        bm25_sc    = fts_row["bm25_score"] if fts_row else 0.0
        title      = (fts_row or extra_meta.get(nid, {})).get("title") or ""
        bigram     = _bigram_bonus(title, words)

        # Hybrid score — per note #265 formula
        hybrid = tfidf_sc * 5.0 + (-bm25_sc) + bigram

        # Build result dict — prefer FTS5 metadata (has snippet)
        if fts_row:
            entry = dict(fts_row)
        else:
            meta  = extra_meta.get(nid, {})
            entry = {
                "note_id":         nid,
                "title":           meta.get("title") or "Untitled",
                "snippet":         (meta.get("content") or "")[:150],
                "bm25_score":      0.0,
                "workspace_name":  meta.get("workspace_name") or "",
                "workspace_emoji": meta.get("workspace_emoji") or "📁",
            }

        entry["hybrid_score"] = hybrid
        scored.append(entry)

    scored.sort(key=lambda x: x["hybrid_score"], reverse=True)

    results = []
    for e in scored[:limit]:
        results.append({
            "note_id":         e["note_id"],
            "title":           e.get("title") or "Untitled",
            "snippet":         e.get("snippet") or "",
            "score":           e["hybrid_score"],
            "workspace_name":  e.get("workspace_name") or "",
            "workspace_emoji": e.get("workspace_emoji") or "📁",
        })
    return results


# ── endpoints ─────────────────────────────────────────────────────────────

@router.get("/search")
async def fts_search(request: Request, q: str = "", limit: int = 12):
    """Hybrid FTS5 + TF-IDF search over the requesting user's notes.

    Returns {results: [...], index_ready: bool}
    When the TF-IDF index isn't built yet (first boot), falls back
    to BM25-only ordering — no degraded UX.
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

    # Run FTS5 and TF-IDF concurrently
    loop = asyncio.get_running_loop()
    fts_task   = asyncio.create_task(_fts5_search(uid, fts_query))
    tfidf_task = loop.run_in_executor(
        None, search_index.semantic_search, q, uid, _FTS5_POOL
    )
    fts_rows, tfidf_hits = await asyncio.gather(fts_task, tfidf_task)

    # Fallback: no TF-IDF index yet — return BM25-only results
    if not search_index.is_ready() or not tfidf_hits:
        results = [
            {
                "note_id":         r["note_id"],
                "title":           r["title"] or "Untitled",
                "snippet":         r["snippet"] or "",
                "score":           float(-r["bm25_score"]),
                "workspace_name":  r["workspace_name"] or "",
                "workspace_emoji": r["workspace_emoji"] or "📁",
            }
            for r in fts_rows[:limit]
        ]
        return {"results": results, "index_ready": False}

    # Fetch metadata for TF-IDF-only hits in an executor — never blocks the loop
    fts_ids    = {r["note_id"] for r in fts_rows}
    tfidf_only = [h["note_id"] for h in tfidf_hits if h["note_id"] not in fts_ids]
    extra_meta: dict = {}
    if tfidf_only:
        extra_meta = await loop.run_in_executor(
            None, _fetch_meta_sync, tfidf_only[:20], uid
        )

    results = _merge_and_score(fts_rows, tfidf_hits, words, limit, extra_meta)
    return {"results": results, "index_ready": True}


@router.post("/rebuild-index")
async def rebuild_index_endpoint(request: Request):
    """Superadmin: trigger an immediate TF-IDF index rebuild.

    Returns immediately; rebuild runs in background.
    """
    _uid(request)  # 401 if not authenticated
    if request.session.get("role") != "superadmin":
        raise HTTPException(status_code=403)
    asyncio.create_task(search_index.rebuild_index())
    return {"status": "rebuilding", "message": "Rebuild started in background."}
