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


# ── pdf_annotations helpers (Phase 8 / B2) ───────────────────────────────────

async def get_annotations(file_id: int, user_id: int) -> list[dict]:
    """Return all annotations for a file, ordered by creation time."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, page_num, type, x_pct, y_pct, width_pct, height_pct, "
            "color, content, created_at "
            "FROM pdf_annotations WHERE file_id=? AND user_id=? ORDER BY created_at",
            (file_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_annotation(file_id: int, user_id: int, data) -> int:
    """Insert one annotation row. Returns the new row id."""
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO pdf_annotations "
            "(user_id, file_id, page_num, type, x_pct, y_pct, "
            " width_pct, height_pct, color, content) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                user_id, file_id, data.page_num, data.type,
                data.x_pct, data.y_pct, data.width_pct, data.height_pct,
                data.color, data.content,
            ),
        )
        await db.commit()
    return cur.lastrowid


async def update_annotation(annot_id: int, user_id: int, data) -> int:
    """Update position + content. Returns affected rowcount (0 = not found/not owned).

    Note: page_num and type are intentionally excluded — annotations do not
    switch pages or change type after creation.
    """
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE pdf_annotations "
            "SET x_pct=?, y_pct=?, width_pct=?, height_pct=?, color=?, content=? "
            "WHERE id=? AND user_id=?",
            (
                data.x_pct, data.y_pct, data.width_pct, data.height_pct,
                data.color, data.content, annot_id, user_id,
            ),
        )
        await db.commit()
    return cur.rowcount


async def delete_annotation(annot_id: int, user_id: int) -> int:
    """Delete one annotation. Returns affected rowcount (0 = not found/not owned)."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM pdf_annotations WHERE id=? AND user_id=?",
            (annot_id, user_id),
        )
        await db.commit()
    return cur.rowcount


async def delete_all_annotations(file_id: int, user_id: int) -> int:
    """Delete ALL annotations for a file owned by this user. Returns deleted count."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM pdf_annotations WHERE file_id=? AND user_id=?",
            (file_id, user_id),
        )
        await db.commit()
    return cur.rowcount
