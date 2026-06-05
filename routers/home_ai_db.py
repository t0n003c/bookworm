"""DB helpers for the AI Dashboard homespace page.

Queries ai_usage_log for per-user overview stats and chat history.
All DB access via get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

import math

from database import get_db

_HISTORY_PER_PAGE = 20


import re as _re

_DATE_RE = _re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _build_time_clause(
    days: int,
    start_date: str,
    end_date: str,
) -> tuple[str, tuple]:
    """Return (WHERE fragment, params-tuple) for the time window.

    Custom range wins when both start_date and end_date are valid ISO dates.
    Falls back to rolling-window otherwise.
    """
    if (
        start_date
        and end_date
        and _DATE_RE.match(start_date)
        and _DATE_RE.match(end_date)
        and start_date <= end_date
    ):
        return "DATE(queried_at) BETWEEN ? AND ?", (start_date, end_date)
    days = max(1, min(days, 3650))
    return "queried_at >= datetime('now', ? || ' days')", (f"-{days}",)


async def get_ai_overview(
    uid: int,
    days: int = 30,
    start_date: str = "",
    end_date: str = "",
) -> dict:
    """Return summary stats + per-day breakdowns for charts.

    Accepts either a rolling ``days`` window OR an explicit ``start_date``/
    ``end_date`` pair (YYYY-MM-DD).  When both dates are provided and valid,
    the explicit range takes priority.

    Returns::

        {
          summary:      {total_queries, total_input, total_output,
                         total_tokens, total_cost},
          daily:        [{day, queries, input_tokens, output_tokens, cost_usd}],
          models:       [{model, count}],
          period_label: str,   # human-readable e.g. "Last 30 days" or "Jan 1 – Mar 31"
        }
    """
    time_clause, time_params = _build_time_clause(days, start_date, end_date)

    async with get_db() as db:
        # ── Summary totals ────────────────────────────────────────────────
        cur = await db.execute(
            f"""
            SELECT
                COUNT(*)                                              AS total_queries,
                COALESCE(SUM(input_tokens),  0)                       AS total_input,
                COALESCE(SUM(output_tokens), 0)                       AS total_output,
                COALESCE(SUM(input_tokens) + SUM(output_tokens), 0)   AS total_tokens,
                SUM(cost_usd)                                         AS total_cost
            FROM ai_usage_log
            WHERE user_id = ? AND {time_clause}
            """,
            (uid,) + time_params,
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
            f"""
            SELECT
                DATE(queried_at)                AS day,
                COUNT(*)                        AS queries,
                COALESCE(SUM(input_tokens),  0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd),      0) AS cost_usd
            FROM ai_usage_log
            WHERE user_id = ? AND {time_clause}
            GROUP BY DATE(queried_at)
            ORDER BY DATE(queried_at) ASC
            """,
            (uid,) + time_params,
        )
        daily = [dict(r) for r in await cur.fetchall()]

        # ── Model breakdown ───────────────────────────────────────────────
        cur = await db.execute(
            f"""
            SELECT model, COUNT(*) AS count
            FROM ai_usage_log
            WHERE user_id = ? AND {time_clause}
            GROUP BY model
            ORDER BY count DESC
            """,
            (uid,) + time_params,
        )
        models = [dict(r) for r in await cur.fetchall()]

    # ── Human-readable period label sent to the frontend ─────────────────
    if start_date and end_date and _DATE_RE.match(start_date) and _DATE_RE.match(end_date):
        period_label = f"{_fmt_date(start_date)} – {_fmt_date(end_date)}"
    else:
        period_label = f"Last {days} day{'s' if days != 1 else ''}"

    return {
        "summary":      summary,
        "daily":        daily,
        "models":       models,
        "period_label": period_label,
    }


def _fmt_date(iso: str) -> str:
    """'2025-01-07' → 'Jan 7, 2025'."""
    try:
        from datetime import date
        d = date.fromisoformat(iso)
        return d.strftime("%b %-d, %Y")  # Linux/Mac
    except ValueError:
        try:
            from datetime import date
            d = date.fromisoformat(iso)
            return d.strftime("%b %#d, %Y")  # Windows
        except Exception:
            return iso


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
