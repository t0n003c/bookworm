"""DB helpers for the Grid Homespace page (home_grid_cells table).

All functions use get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

from database import get_db


async def get_grid_cells(page_id: int) -> list[dict]:
    """Return all cells for a page ordered by position.
    LEFT JOIN page_uploads to add file_url, mime_type, original_name.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT c.*,
                   CASE WHEN pu.filename IS NOT NULL
                        THEN '/uploads/' || pu.filename
                        ELSE NULL END AS file_url,
                   pu.mime_type,
                   pu.original_name,
                   pu.page_id AS uploads_page_id
            FROM home_grid_cells c
            LEFT JOIN page_uploads pu ON pu.id = c.upload_id
            WHERE c.page_id = ?
            ORDER BY c.position, c.id
            """,
            (page_id,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def add_grid_cell(
    page_id: int,
    cell_type: str = "empty",
    upload_id: int | None = None,
    aspect: str = "1:1",
    caption: str = "",
) -> int:
    """INSERT a new cell at position 0 (newest-first).

    All existing cells for the page are shifted down by 1 first so the
    new item always appears top-left without disturbing manual drag order.
    """
    async with get_db() as db:
        # Shift every existing cell down to make room at position 0
        await db.execute(
            "UPDATE home_grid_cells SET position = position + 1 WHERE page_id = ?",
            (page_id,),
        )
        cur = await db.execute(
            "INSERT INTO home_grid_cells"
            "(page_id, position, cell_type, upload_id, aspect, caption)"
            " VALUES (?,0,?,?,?,?)",
            (page_id, cell_type, upload_id, aspect, caption),
        )
        await db.commit()
        return cur.lastrowid


async def update_grid_cell(
    cell_id: int,
    page_id: int,           # WHERE guard — prevents cross-page tampering
    uid: int,               # ownership check for upload_id
    position: int | None = None,
    cell_type: str | None = None,
    upload_id: int | None = None,
    clear_upload: bool = False,   # True → set upload_id = NULL explicitly
    aspect: str | None = None,
    caption: str | None = None,
) -> None:
    """Partial UPDATE — only touches supplied fields.

    When clear_upload=True, sets upload_id to NULL and cell_type to 'empty'
    regardless of upload_id arg.
    When upload_id is provided, verifies page_uploads row belongs to uid.
    """
    async with get_db() as db:
        # Ownership check on new upload_id
        if upload_id is not None and not clear_upload:
            chk = await db.execute(
                "SELECT id FROM page_uploads WHERE id=? AND user_id=?",
                (upload_id, uid),
            )
            if not await chk.fetchone():
                raise ValueError("upload not owned by user")

        sets: list[str] = []
        params: list = []

        if position is not None:
            sets.append("position=?")
            params.append(position)
        if cell_type is not None:
            sets.append("cell_type=?")
            params.append(cell_type)
        if clear_upload:
            sets.append("upload_id=NULL")
            sets.append("cell_type='empty'")
        elif upload_id is not None:
            sets.append("upload_id=?")
            params.append(upload_id)
        if aspect is not None:
            sets.append("aspect=?")
            params.append(aspect)
        if caption is not None:
            sets.append("caption=?")
            params.append(caption)

        if not sets:
            return

        params += [cell_id, page_id]
        await db.execute(
            f"UPDATE home_grid_cells SET {', '.join(sets)} WHERE id=? AND page_id=?",
            params,
        )
        await db.commit()


async def delete_grid_cell(cell_id: int, page_id: int) -> None:
    """DELETE WHERE id=? AND page_id=? — page_id guard prevents cross-page ops."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM home_grid_cells WHERE id=? AND page_id=?",
            (cell_id, page_id),
        )
        await db.commit()


async def reorder_grid_cells(page_id: int, ordered_ids: list[int]) -> None:
    """Bulk-update position field according to ordered_ids list."""
    async with get_db() as db:
        for idx, cell_id in enumerate(ordered_ids):
            await db.execute(
                "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
                (idx, cell_id, page_id),
            )
        await db.commit()


async def swap_grid_cells(page_id: int, a: int, b: int) -> None:
    """Swap positions of cells a and b atomically."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, position FROM home_grid_cells WHERE id IN (?,?) AND page_id=?",
            (a, b, page_id),
        )
        rows = {r[0]: r[1] for r in await cur.fetchall()}
        if len(rows) != 2:
            return  # one or both ids not found — silent no-op
        await db.execute(
            "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
            (rows[b], a, page_id),
        )
        await db.execute(
            "UPDATE home_grid_cells SET position=? WHERE id=? AND page_id=?",
            (rows[a], b, page_id),
        )
        await db.commit()
