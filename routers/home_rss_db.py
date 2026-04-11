"""DB helpers for the RSS Reader page type.

Tables:
  rss_page_feeds  — feeds subscribed to a specific RSS Reader page
  rss_read_items  — per-user read-state (guid = item identifier from the feed)
"""
from __future__ import annotations
import json
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
            "SELECT id, url, label, color, sort_order, category "
            "FROM rss_page_feeds "
            "WHERE page_id=? AND user_id=? "
            "ORDER BY sort_order, id",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_page_feed(
    page_id: int, user_id: int, url: str,
    label: str = "", color: str = "", category: str = ""
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
            "(page_id, user_id, url, label, color, sort_order, category)"
            " VALUES (?,?,?,?,?,?,?)",
            (page_id, user_id, url.strip(), label.strip(), color, sort, category.strip()),
        )
        await db.commit()

    return await get_page_feeds(page_id, user_id)


async def update_page_feed(
    feed_id: int, page_id: int, user_id: int,
    label: str, color: str, category: str
) -> list[dict]:
    """Update label, color, and category for a feed.  Returns updated feed list."""
    async with get_db() as db:
        await db.execute(
            "UPDATE rss_page_feeds SET label=?, color=?, category=? "
            "WHERE id=? AND page_id=? AND user_id=?",
            (label.strip(), color.strip(), category.strip(), feed_id, page_id, user_id),
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


# ── One-way widget → RSS reader page sync ────────────────────────────────────

async def sync_widget_feeds_to_rss_pages(
    user_id: int,
    widget_feeds: list[dict],
) -> None:
    """Push feeds from an rss_feed widget into all RSS Reader pages for this user.

    Rules (deliberately one-way):
    - Feeds present in the widget but missing from a reader page are ADDED.
    - Feeds already in the reader page are left untouched (no overwrite).
    - Feeds deleted from the widget are NOT removed from the reader page.
    - New feeds added directly in the reader page never flow back to the widget.

    Idempotent: safe to call on every widget create / config save.
    """
    if not widget_feeds:
        return

    async with get_db() as db:
        # Find all RSS reader pages belonging to this user.
        cur = await db.execute(
            "SELECT id FROM home_pages WHERE user_id=? AND page_type='rss'",
            (user_id,),
        )
        rss_pages = [r[0] for r in await cur.fetchall()]

    if not rss_pages:
        return

    for page_id in rss_pages:
        existing = await get_page_feeds(page_id, user_id)
        existing_urls = {f["url"] for f in existing}

        # Determine how many feeds already exist so we pick a good palette color.
        offset = len(existing_urls)

        for i, feed in enumerate(widget_feeds):
            url = (feed.get("url") or "").strip()
            if not url or url in existing_urls:
                continue  # skip blank or already-present feeds

            label = (feed.get("label") or "").strip()
            color = (feed.get("color") or "").strip()
            if not color:
                color = _COLORS[(offset + i) % len(_COLORS)]

            async with get_db() as db:
                cur = await db.execute(
                    "SELECT COALESCE(MAX(sort_order), 0) + 1 "
                    "FROM rss_page_feeds WHERE page_id=? AND user_id=?",
                    (page_id, user_id),
                )
                row = await cur.fetchone()
                sort = row[0] if row else 1

                await db.execute(
                    "INSERT OR IGNORE INTO rss_page_feeds"
                    "(page_id, user_id, url, label, color, sort_order, category)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (page_id, user_id, url, label, color, sort, ''),
                )
                await db.commit()

            existing_urls.add(url)  # prevent double-insert within same call
            offset += 1


async def get_all_rss_widget_feeds(user_id: int) -> list[dict]:
    """Collect every feed URL configured in any rss_feed widget owned by this user.

    Used at RSS reader page load time to auto-import feeds from existing widgets
    (handles the one-time migration case for widgets created before the sync
    logic was wired in).
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT hw.config_json "
            "FROM home_widgets hw "
            "JOIN home_pages hp ON hw.page_id = hp.id "
            "WHERE hp.user_id=? AND hw.widget_type='rss_feed'",
            (user_id,),
        )
        rows = await cur.fetchall()

    feeds: list[dict] = []
    seen_urls: set[str] = set()
    for row in rows:
        try:
            cfg = json.loads(row[0] or "{}")
        except Exception:
            continue
        for f in cfg.get("feeds") or []:
            url = (f.get("url") or "").strip()
            if url and url not in seen_urls:
                feeds.append(f)
                seen_urls.add(url)
    return feeds
