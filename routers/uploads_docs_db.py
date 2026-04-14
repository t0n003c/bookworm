"""DB helpers for Document Studio (home_uploads_docs.py).

Uses get_db() exclusively — never raw aiosqlite.connect().
Two helpers here; the rest of the writes go through existing
create_page_upload() in uploads_db.py.
"""
from __future__ import annotations

from database import get_db


async def update_page_upload_size(upload_id: int, user_id: int, size: int) -> None:
    """Update the stored byte-size after an in-place edit or signature stamp."""
    async with get_db() as db:
        await db.execute(
            "UPDATE page_uploads SET size = ? WHERE id = ? AND user_id = ?",
            (size, upload_id, user_id),
        )
        await db.commit()


async def get_page_upload_owned_bulk(
    ids: list[int], user_id: int
) -> list[dict]:
    """Fetch multiple page_uploads rows that all belong to user_id.

    Returns rows preserving the order of `ids`.
    Rows not found (missing or wrong owner) are silently omitted —
    caller must check ``len(result) == len(ids)`` to detect partial misses.
    """
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT id, page_id, filename, original_name, mime_type, size "
            f"FROM page_uploads "
            f"WHERE id IN ({placeholders}) AND user_id = ?",
            (*ids, user_id),
        )
        rows = await cur.fetchall()
    by_id = {r["id"]: dict(r) for r in rows}
    return [by_id[i] for i in ids if i in by_id]
