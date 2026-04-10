"""DB helpers for the RSS Reader page type.

Tables:
  rss_page_feeds  — feeds subscribed to a specific RSS Reader page
  rss_read_items  — per-user read-state (guid = item identifier from the feed)
"""
from __future__ import annotations
from database import get_db

# ── Palette for auto-coloring new feeds ──────────────────────────────────────
_COLORS = [
    "#0053e2", "#ea1100", "#2a8703", "#995213",
    "#7c3aed", "#0891b2", "#db2777", "#d97706",
]


async def get_page_feeds(page_id: int, user_id: int) -> list[dict]:
    """Return all feeds for a page, ordered by sort_order."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, url, label, color, sort_order "
            "FROM rss_page_feeds "
            "WHERE page_id=? AND user_id=? "
            "ORDER BY sort_order, id",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_page_feed(
    page_id: int, user_id: int, url: str, label: str = "", color: str = ""
) -> list[dict]:
    """Add a feed (idempotent on url).  Returns updated feed list."""
    async with get_db() as db:
        # Auto-pick a color from the palette if none supplied
        if not color:
            cur = await db.execute(
                "SELECT COUNT(*) FROM rss_page_feeds WHERE page_id=? AND user_id=?",
                (page_id, user_id),
            )
            row = await cur.fetchone()
            n = row[0] if row else 0
            color = _COLORS[n % len(_COLORS)]

        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 "
            "FROM rss_page_feeds WHERE page_id=? AND user_id=?",
            (page_id, user_id),
        )
        row = await cur.fetchone()
        sort = row[0] if row else 1

        await db.execute(
            "INSERT OR IGNORE INTO rss_page_feeds"
            "(page_id, user_id, url, label, color, sort_order)"
            " VALUES (?,?,?,?,?,?)",
            (page_id, user_id, url.strip(), label.strip(), color, sort),
        )
        await db.commit()

    return await get_page_feeds(page_id, user_id)


async def delete_page_feed(
    feed_id: int, page_id: int, user_id: int
) -> list[dict]:
    """Delete a feed.  Returns updated feed list."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM rss_page_feeds WHERE id=? AND page_id=? AND user_id=?",
            (feed_id, page_id, user_id),
        )
        await db.commit()
    return await get_page_feeds(page_id, user_id)


# ── Read state ────────────────────────────────────────────────────────────────

async def get_read_guids(page_id: int, user_id: int) -> set[str]:
    """Return the set of item guids already read by this user on this page."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT item_guid FROM rss_read_items WHERE page_id=? AND user_id=?",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
        return {r[0] for r in rows}


async def mark_read(page_id: int, user_id: int, guids: list[str]) -> None:
    """Mark a batch of guids as read (upsert)."""
    if not guids:
        return
    async with get_db() as db:
        await db.executemany(
            "INSERT OR IGNORE INTO rss_read_items(user_id, page_id, item_guid)"
            " VALUES (?,?,?)",
            [(user_id, page_id, g) for g in guids],
        )
        await db.commit()
