"""DB helper functions for workspace database cards.

All access via get_db() — never raw aiosqlite.connect().
Mirrors the trip_locations + trip_location_attrs pattern from home_trip_db.py.
"""
from __future__ import annotations

from typing import Optional

from database import get_db


# ── private ────────────────────────────────────────────────────────────────────

def _collapse_card_rows(rows: list) -> list[dict]:
    """Collapse a LEFT JOIN result (card × attr rows) into card dicts with nested attrs."""
    cards: dict[int, dict] = {}
    order: list[int] = []
    for r in rows:
        cid = r["id"]
        if cid not in cards:
            order.append(cid)
            cards[cid] = {
                "id":              cid,
                "db_id":           r["db_id"],
                "user_id":         r["user_id"],
                "title":           r["title"],
                "cover_url":       r["cover_url"],
                "cover_upload_id": r["cover_upload_id"],
                "note_content":    r["note_content"],
                "note_box_height": r["note_box_height"],
                "sort_order":      r["sort_order"],
                "created_at":      r["created_at"],
                "updated_at":      r["updated_at"],
                "attrs":           [],
            }
        if r["attr_id"] is not None:
            cards[cid]["attrs"].append({
                "id":           r["attr_id"],
                "attr_key":     r["attr_key"],
                "attr_value":   r["attr_value"],
                "attr_type":    r["attr_type"],
                "attr_options": r["attr_options"],
                "sort_order":   r["attr_sort"],
            })
    return [cards[cid] for cid in order]


# ── public helpers ─────────────────────────────────────────────────────────────

async def get_db_cards(db_id: int, user_id: int) -> list[dict]:
    """Return all cards for a database, with nested attrs — no N+1."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT c.id, c.db_id, c.user_id, c.title, c.cover_url, c.cover_upload_id,"
            "       c.note_content, c.note_box_height, c.sort_order, c.created_at, c.updated_at,"
            "       a.id AS attr_id, a.attr_key, a.attr_value, "
            "       a.attr_type, a.attr_options, a.sort_order AS attr_sort "
            "  FROM db_cards c "
            "  LEFT JOIN db_card_attrs a ON a.card_id = c.id "
            " WHERE c.db_id = ? AND c.user_id = ? "
            " ORDER BY c.sort_order ASC, c.id ASC, a.sort_order ASC",
            (db_id, user_id),
        )
        rows = await cursor.fetchall()
        return _collapse_card_rows([dict(r) for r in rows])


async def create_db_card(db_id: int, user_id: int, title: str = "Untitled") -> dict:
    """Insert a new card and return the full card dict (attrs=[])."""
    async with get_db() as db:
        cur_sort = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM db_cards WHERE db_id = ?",
            (db_id,),
        )
        row = await cur_sort.fetchone()
        new_sort = (row[0] if row else -10) + 10
        cur = await db.execute(
            "INSERT INTO db_cards (db_id, user_id, title, sort_order) VALUES(?,?,?,?)",
            (db_id, user_id, title, new_sort),
        )
        new_id = cur.lastrowid
        await db.commit()
        fetch = await db.execute(
            "SELECT id, db_id, user_id, title, cover_url, cover_upload_id, note_content, "
            "note_box_height, sort_order, created_at, updated_at "
            "FROM db_cards WHERE id = ?",
            (new_id,),
        )
        row = await fetch.fetchone()
        card = dict(row)
        card["attrs"] = []
        return card


async def get_db_card(card_id: int, db_id: int, user_id: int) -> Optional[dict]:
    """Return a single card with nested attrs, or None if not found / wrong owner."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT c.id, c.db_id, c.user_id, c.title, c.cover_url, c.cover_upload_id,"
            "       c.note_content, c.note_box_height, c.sort_order, c.created_at, c.updated_at,"
            "       a.id AS attr_id, a.attr_key, a.attr_value, "
            "       a.attr_type, a.attr_options, a.sort_order AS attr_sort "
            "  FROM db_cards c "
            "  LEFT JOIN db_card_attrs a ON a.card_id = c.id "
            " WHERE c.id = ? AND c.db_id = ? AND c.user_id = ? "
            " ORDER BY a.sort_order ASC",
            (card_id, db_id, user_id),
        )
        rows = await cursor.fetchall()
        if not rows:
            return None
        collapsed = _collapse_card_rows([dict(r) for r in rows])
        return collapsed[0] if collapsed else None


async def update_db_card(
    card_id: int,
    db_id: int,
    user_id: int,
    title: str,
    cover_url: str,
    note_content: str,
    cover_upload_id: Optional[int] = None,
    clear_cover_upload: bool = False,
) -> Optional[str]:
    """Update card fields. Returns updated_at string, or None if not found.

    cover_upload_id  — pass the new page_uploads.id when setting an uploaded cover.
    clear_cover_upload=True — explicitly NULL out cover_upload_id (e.g. when
                              cover is removed or replaced with an external URL).
    """
    async with get_db() as db:
        if clear_cover_upload:
            cur = await db.execute(
                "UPDATE db_cards SET title=?, cover_url=?, note_content=?, cover_upload_id=NULL "
                "WHERE id=? AND db_id=? AND user_id=?",
                (title, cover_url, note_content, card_id, db_id, user_id),
            )
        elif cover_upload_id is not None:
            cur = await db.execute(
                "UPDATE db_cards SET title=?, cover_url=?, note_content=?, cover_upload_id=? "
                "WHERE id=? AND db_id=? AND user_id=?",
                (title, cover_url, note_content, cover_upload_id, card_id, db_id, user_id),
            )
        else:
            cur = await db.execute(
                "UPDATE db_cards SET title=?, cover_url=?, note_content=? "
                "WHERE id=? AND db_id=? AND user_id=?",
                (title, cover_url, note_content, card_id, db_id, user_id),
            )
        await db.commit()
        if cur.rowcount == 0:
            return None
        fetch = await db.execute(
            "SELECT updated_at FROM db_cards WHERE id=?", (card_id,)
        )
        row = await fetch.fetchone()
        return row["updated_at"] if row else None


async def delete_db_card(card_id: int, db_id: int, user_id: int) -> bool:
    """Delete a card. Returns True if a row was deleted."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM db_cards WHERE id=? AND db_id=? AND user_id=?",
            (card_id, db_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def update_card_note_height(
    card_id: int, db_id: int, user_id: int, height: int
) -> bool:
    """Update note_box_height. Returns True if the card was found."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE db_cards SET note_box_height=? WHERE id=? AND db_id=? AND user_id=?",
            (max(80, height), card_id, db_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def upsert_card_attr(
    card_id: int,
    user_id: int,
    attr_key: str,
    attr_value: str,
    attr_type: str = "text",
    attr_options: str = "",
) -> Optional[dict]:
    """Insert or update a custom attribute. Returns the full attr dict or None."""
    async with get_db() as db:
        # Verify card ownership before touching attrs
        check = await db.execute(
            "SELECT id FROM db_cards WHERE id=? AND user_id=?", (card_id, user_id)
        )
        if not await check.fetchone():
            return None
        # Try update first (keep sort_order; update type + options too)
        cur = await db.execute(
            "UPDATE db_card_attrs "
            "SET attr_value=?, attr_type=?, attr_options=? "
            "WHERE card_id=? AND attr_key=?",
            (attr_value, attr_type, attr_options, card_id, attr_key),
        )
        if cur.rowcount == 0:
            sort_cur = await db.execute(
                "SELECT COALESCE(MAX(sort_order), -10) FROM db_card_attrs WHERE card_id=?",
                (card_id,),
            )
            sort_row = await sort_cur.fetchone()
            new_sort = (sort_row[0] if sort_row else -10) + 10
            await db.execute(
                "INSERT INTO db_card_attrs "
                "(card_id, attr_key, attr_value, attr_type, attr_options, sort_order) "
                "VALUES(?,?,?,?,?,?)",
                (card_id, attr_key, attr_value, attr_type, attr_options, new_sort),
            )
        await db.commit()
        fetch = await db.execute(
            "SELECT id, attr_key, attr_value, attr_type, attr_options "
            "FROM db_card_attrs WHERE card_id=? AND attr_key=?",
            (card_id, attr_key),
        )
        row = await fetch.fetchone()
        return dict(row) if row else None


async def delete_card_attr(attr_id: int, card_id: int) -> bool:
    """Delete an attribute. Returns True if deleted."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM db_card_attrs WHERE id=? AND card_id=?", (attr_id, card_id)
        )
        await db.commit()
        return cur.rowcount > 0


async def sync_attr_to_workspace(
    ws_id: int,
    user_id: int,
    attr_key: str,
    attr_type: str = "text",
    attr_options: str = "",
    source_card_id: Optional[int] = None,
    source_attr_value: str = "",
) -> None:
    """Broadcast an attribute definition to every card in a workspace.

    - Source card: full UPSERT (value + type + options).
    - All other cards: UPDATE type/options (keep existing value);
      INSERT with empty value for cards that don’t have this attr yet.
    """
    async with get_db() as db:
        # Get all card IDs owned by this user in this workspace
        cur = await db.execute(
            "SELECT id FROM db_cards WHERE db_id=? AND user_id=?",
            (ws_id, user_id),
        )
        rows = await cur.fetchall()
        card_ids = [r["id"] for r in rows]

        for cid in card_ids:
            is_source = cid == source_card_id
            val = source_attr_value if is_source else ""

            # Attempt UPDATE (type + options always; value only for source)
            if is_source:
                upd = await db.execute(
                    "UPDATE db_card_attrs "
                    "SET attr_value=?, attr_type=?, attr_options=? "
                    "WHERE card_id=? AND attr_key=?",
                    (val, attr_type, attr_options, cid, attr_key),
                )
            else:
                upd = await db.execute(
                    "UPDATE db_card_attrs "
                    "SET attr_type=?, attr_options=? "
                    "WHERE card_id=? AND attr_key=?",
                    (attr_type, attr_options, cid, attr_key),
                )

            if upd.rowcount == 0:
                # Card doesn’t have this attr yet — insert with appropriate value
                sort_cur = await db.execute(
                    "SELECT COALESCE(MAX(sort_order), -10) FROM db_card_attrs WHERE card_id=?",
                    (cid,),
                )
                sort_row = await sort_cur.fetchone()
                new_sort = (sort_row[0] or 0) + 10
                await db.execute(
                    "INSERT INTO db_card_attrs "
                    "(card_id, attr_key, attr_value, attr_type, attr_options, sort_order) "
                    "VALUES (?,?,?,?,?,?)",
                    (cid, attr_key, val, attr_type, attr_options, new_sort),
                )

        await db.commit()


async def delete_attr_from_workspace(ws_id: int, user_id: int, attr_key: str) -> None:
    """Remove an attribute (by key) from every card in a workspace."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM db_card_attrs "
            "WHERE card_id IN "
            "  (SELECT id FROM db_cards WHERE db_id=? AND user_id=?) "
            "AND attr_key=?",
            (ws_id, user_id, attr_key),
        )
        await db.commit()


async def rename_attr_in_workspace(
    ws_id: int,
    user_id: int,
    old_key: str,
    new_key: str,
    attr_type: str = "text",
    attr_options: str = "",
) -> None:
    """Rename an attribute key across all cards in a workspace, updating type/options too.

    Values are preserved. Cards that don’t have old_key are unaffected.
    """
    async with get_db() as db:
        await db.execute(
            "UPDATE db_card_attrs "
            "SET attr_key=?, attr_type=?, attr_options=? "
            "WHERE card_id IN "
            "  (SELECT id FROM db_cards WHERE db_id=? AND user_id=?) "
            "AND attr_key=?",
            (new_key, attr_type, attr_options, ws_id, user_id, old_key),
        )
        await db.commit()
