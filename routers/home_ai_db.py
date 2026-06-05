"""DB helpers for the AI Dashboard homespace page.

Queries ai_usage_log for per-user overview stats and chat history.
All DB access via get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

import math

from database import get_db

_HISTORY_PER_PAGE = 20


async def get_ai_overview(uid: int, days: int = 30) -> dict:
    """Return summary stats + per-day breakdowns for charts.

    Returns:
        {
          summary: {total_queries, total_input, total_output, total_tokens, total_cost},
          daily:   [{day, queries, input_tokens, output_tokens, cost_usd}],  # oldest→newest
          models:  [{model, count}],
        }
    """
    days = max(1, min(days, 365))
    async with get_db() as db:
        # ── Summary totals ────────────────────────────────────────────────
        cur = await db.execute(
            """
            SELECT
                COUNT(*)              AS total_queries,
                COALESCE(SUM(input_tokens),  0) AS total_input,
                COALESCE(SUM(output_tokens), 0) AS total_output,
                COALESCE(SUM(input_tokens) + SUM(output_tokens), 0) AS total_tokens,
                SUM(cost_usd)         AS total_cost
            FROM ai_usage_log
            WHERE user_id = ?
              AND queried_at >= datetime('now', ? || ' days')
            """,
            (uid, f"-{days}"),
        )
        row = await cur.fetchone()
        summary = dict(row) if row else {}
        summary.setdefault("total_queries", 0)
        summary.setdefault("total_input",   0)
        summary.setdefault("total_output",  0)
        summary.setdefault("total_tokens",  0)
        summary["total_cost"] = summary.get("total_cost") or 0.0

        # ── Per-day breakdown ─────────────────────────────────────────────
        cur = await db.execute(
            """
            SELECT
                DATE(queried_at)                AS day,
                COUNT(*)                        AS queries,
                COALESCE(SUM(input_tokens),  0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd),      0) AS cost_usd
            FROM ai_usage_log
            WHERE user_id = ?
              AND queried_at >= datetime('now', ? || ' days')
            GROUP BY DATE(queried_at)
            ORDER BY DATE(queried_at) ASC
            """,
            (uid, f"-{days}"),
        )
        daily = [dict(r) for r in await cur.fetchall()]

        # ── Model breakdown ───────────────────────────────────────────────
        cur = await db.execute(
            """
            SELECT model, COUNT(*) AS count
            FROM ai_usage_log
            WHERE user_id = ?
              AND queried_at >= datetime('now', ? || ' days')
            GROUP BY model
            ORDER BY count DESC
            """,
            (uid, f"-{days}"),
        )
        models = [dict(r) for r in await cur.fetchall()]

    return {"summary": summary, "daily": daily, "models": models}


async def get_ai_history(
    uid: int,
    page: int = 1,
    q: str = "",
) -> dict:
    """Return paginated AI chat history, newest first.

    Returns:
        {
          items:      [{id, query_text, answer_text, model, queried_at,
                        input_tokens, output_tokens, cost_usd}],
          total:      int,
          page:       int,
          total_pages: int,
          has_more:   bool,
        }
    """
    page   = max(1, page)
    offset = (page - 1) * _HISTORY_PER_PAGE

    async with get_db() as db:
        if q:
            like = f"%{q}%"
            cur = await db.execute(
                "SELECT COUNT(*) FROM ai_usage_log "
                "WHERE user_id = ? AND (query_text LIKE ? OR answer_text LIKE ?)",
                (uid, like, like),
            )
        else:
            cur = await db.execute(
                "SELECT COUNT(*) FROM ai_usage_log WHERE user_id = ?",
                (uid,),
            )
        total = (await cur.fetchone())[0]

        if q:
            like = f"%{q}%"
            cur = await db.execute(
                """
                SELECT id, query_text, answer_text, model,
                       queried_at, input_tokens, output_tokens, cost_usd
                FROM ai_usage_log
                WHERE user_id = ?
                  AND (query_text LIKE ? OR answer_text LIKE ?)
                ORDER BY queried_at DESC
                LIMIT ? OFFSET ?
                """,
                (uid, like, like, _HISTORY_PER_PAGE, offset),
            )
        else:
            cur = await db.execute(
                """
                SELECT id, query_text, answer_text, model,
                       queried_at, input_tokens, output_tokens, cost_usd
                FROM ai_usage_log
                WHERE user_id = ?
                ORDER BY queried_at DESC
                LIMIT ? OFFSET ?
                """,
                (uid, _HISTORY_PER_PAGE, offset),
            )
        items = [dict(r) for r in await cur.fetchall()]

    total_pages = max(1, math.ceil(total / _HISTORY_PER_PAGE))
    return {
        "items":       items,
        "total":       total,
        "page":        page,
        "total_pages": total_pages,
        "has_more":    page < total_pages,
    }
