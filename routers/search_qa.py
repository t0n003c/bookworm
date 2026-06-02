"""Full-text search Q&A endpoint — Phase 1 (FTS5 + BM25).

Prefix: /qa
Isolated from all other routers — no wildcard /{param} routes here,
so the Starlette routing trap documented in CODEPUPPY_NOTES cannot apply.

User isolation: enforced via JOIN workspaces w ON w.id = n.workspace_id
AND w.user_id = ?  Notes in trashed workspaces (deleted_at IS NOT NULL)
are excluded — same behaviour as the main note search.

Snippet XSS mitigation: char(2)/char(3) (ASCII STX/ETX) are used as
highlight markers. The JS helper HTML-escapes the full snippet string
FIRST, then replaces \\u0002/\\u0003 with <mark>/</mark> — so any HTML
in note content is neutralised before markers are injected.
"""
import re

from fastapi import APIRouter, HTTPException, Request

from database import get_db

router = APIRouter(prefix="/qa", tags=["search-qa"])

# Max tokens accepted in a query — caps FTS5 expression length
_MAX_TOKENS = 20
# Upper bound the caller may request
_MAX_LIMIT = 50


@router.get("/search")
async def fts_search(request: Request, q: str = "", limit: int = 12):
    """Auth-gated FTS5 search over the requesting user's notes.

    Returns:
        {results: [{note_id, title, snippet, score,
                    workspace_name, workspace_emoji}]}

    BM25 score: more-negative = better match (standard FTS5 convention).
    Score is included in the response for Phase 2 hybrid-ranking use;
    the Phase 1 UI does not display it.

    Notes in trashed workspaces (deleted_at IS NOT NULL) are excluded.
    Shared notes are scoped to the owner only in Phase 1.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)

    q = (q or "").strip()
    if not q:
        return {"results": []}

    limit = max(1, min(limit, _MAX_LIMIT))

    # Build a safe FTS5 prefix query.
    # Strip FTS5 operator characters that could cause syntax errors,
    # then suffix each token with * for prefix matching ("meet" → "meet*").
    words = re.sub(r'["\'\\^*():\-]', " ", q).split()
    if not words:
        return {"results": []}
    fts_query = " ".join(w + "*" for w in words[:_MAX_TOKENS])

    sql = """
        SELECT
            n.id                                                          AS note_id,
            n.title,
            snippet(notes_fts, 1, char(2), char(3), '\u2026', 32)              AS snippet,
            bm25(notes_fts)                                               AS score,
            w.name                                                        AS workspace_name,
            w.emoji                                              AS workspace_emoji
        FROM  notes_fts
        JOIN  notes      n ON n.id  = notes_fts.rowid
        JOIN  workspaces w ON w.id  = n.workspace_id
                          AND w.user_id      = ?
                          AND w.deleted_at   IS NULL
        WHERE notes_fts MATCH ?
        ORDER BY bm25(notes_fts)
        LIMIT ?
    """
    try:
        async with get_db() as db:
            cur  = await db.execute(sql, (uid, fts_query, limit))
            rows = await cur.fetchall()
    except Exception:
        # Malformed FTS5 query or other DB error — return empty gracefully
        # rather than a 500 that would confuse the user.
        return {"results": []}

    results = []
    for r in rows:
        results.append({
            "note_id":         r["note_id"],
            "title":           r["title"] or "Untitled",
            "snippet":         r["snippet"] or "",
            "score":           r["score"],
            "workspace_name":  r["workspace_name"] or "",
            "workspace_emoji": r["workspace_emoji"] or "📁",
        })
    return {"results": results}
