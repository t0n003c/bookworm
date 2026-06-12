"""DB helpers for upload_folders CRUD and file-folder assignment."""
from __future__ import annotations
from typing import Optional
from database import get_db


# ── helpers ──────────────────────────────────────────────────────────────────

async def _folder_owned(folder_id: int, user_id: int, db) -> dict:
    """Return the folder row or raise KeyError if not found / not owned."""
    cur = await db.execute(
        "SELECT id, page_id, user_id, name, parent_id, sort_order "
        "FROM upload_folders WHERE id = ? AND user_id = ?",
        (folder_id, user_id),
    )
    row = await cur.fetchone()
    if not row:
        raise KeyError(folder_id)
    return dict(row)


def _is_descendant(
    folder_id: int,
    candidate_parent_id: Optional[int],
    all_folders: list[dict],
) -> bool:
    """
    Return True if candidate_parent_id is the same as folder_id or is a
    descendant of it.  Used to prevent circular re-parenting.
    """
    if candidate_parent_id is None:
        return False
    if candidate_parent_id == folder_id:
        return True
    # Walk upward from candidate through the flat list
    visited: set[int] = set()
    current: Optional[int] = candidate_parent_id
    by_id = {f["id"]: f for f in all_folders}
    while current is not None:
        if current in visited:
            break  # cycle guard
        visited.add(current)
        node = by_id.get(current)
        if node is None:
            break
        parent = node["parent_id"]
        if parent == folder_id:
            return True
        current = parent
    return False


# ── public API ────────────────────────────────────────────────────────────────

async def get_folders_for_page(page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_folders "
            "WHERE page_id = ? AND user_id = ? AND deleted_at IS NULL "
            "ORDER BY parent_id NULLS FIRST, sort_order, name",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_folder(
    page_id: int,
    user_id: int,
    name: str,
    parent_id: Optional[int],
) -> dict:
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO upload_folders (page_id, user_id, name, parent_id) "
            "VALUES (?, ?, ?, ?)",
            (page_id, user_id, name, parent_id),
        )
        new_id = cur.lastrowid
        await db.commit()
        cur2 = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_folders WHERE id = ?",
            (new_id,),
        )
        row = await cur2.fetchone()
    return dict(row)


async def update_folder(
    folder_id: int,
    user_id: int,
    name: Optional[str],
    parent_id,        # can be int, None (move to root), or sentinel MISSING
    is_parent_set: bool,
    all_folders: list[dict],
    sort_order: Optional[int] = None,
) -> dict:
    """
    Update name and/or parent_id.  is_parent_set indicates the caller explicitly
    provided parent_id (even if None = move to root).
    Raises KeyError if not found.  Raises ValueError on cycle.
    """
    async with get_db() as db:
        folder = await _folder_owned(folder_id, user_id, db)

        if is_parent_set and parent_id is not None:
            if _is_descendant(folder_id, parent_id, all_folders):
                raise ValueError("circular")

        sets, vals = [], []
        if name is not None:
            sets.append("name = ?")
            vals.append(name)
        if is_parent_set:
            sets.append("parent_id = ?")
            vals.append(parent_id)
        if sort_order is not None:
            sets.append("sort_order = ?")
            vals.append(sort_order)

        if sets:
            vals += [folder_id, user_id]
            await db.execute(
                f"UPDATE upload_folders SET {', '.join(sets)} "
                "WHERE id = ? AND user_id = ?",
                vals,
            )
            await db.commit()

        cur = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_folders WHERE id = ?",
            (folder_id,),
        )
        row = await cur.fetchone()
    return dict(row)


async def soft_delete_folder(folder_id: int, user_id: int) -> bool:
    """
    Soft-delete a folder: stamp deleted_at and orphan direct children so they
    remain visible at root level.  Files assigned to this folder become unfiled.
    Returns True if a row was updated.
    """
    async with get_db() as db:
        # Orphan direct children (parent_id → NULL) before stamping the parent.
        # Only direct children — deeper descendants stay attached to their
        # immediate parent, which is still active.
        await db.execute(
            "UPDATE upload_folders SET parent_id = NULL "
            "WHERE parent_id = ? AND user_id = ? AND deleted_at IS NULL",
            (folder_id, user_id),
        )
        # Unfile files that were in this folder
        await db.execute(
            "UPDATE page_uploads SET folder_id = NULL "
            "WHERE folder_id = ? AND user_id = ?",
            (folder_id, user_id),
        )
        # Stamp the folder as deleted
        cur = await db.execute(
            "UPDATE upload_folders "
            "SET deleted_at = datetime('now') "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (folder_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def get_trashed_folders(page_id: int, user_id: int) -> list[dict]:
    """Return soft-deleted folders still within the 7-day window."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, name, deleted_at "
            "FROM upload_folders "
            "WHERE page_id = ? AND user_id = ? AND deleted_at IS NOT NULL "
            "ORDER BY deleted_at DESC",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def restore_folder(folder_id: int, user_id: int) -> bool:
    """Clear deleted_at so the folder reappears in the active tree (at root)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE upload_folders SET deleted_at = NULL "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (folder_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def hard_delete_folder(folder_id: int, user_id: int) -> bool:
    """Permanently delete a soft-deleted folder (user-triggered purge)."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM upload_folders "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (folder_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def purge_expired_folders(page_id: int, user_id: int) -> int:
    """Delete folders soft-deleted more than 7 days ago.  Returns row count."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM upload_folders "
            "WHERE page_id = ? AND user_id = ? "
            "AND deleted_at IS NOT NULL "
            "AND deleted_at < datetime('now', '-7 days')",
            (page_id, user_id),
        )
        await db.commit()
    return cur.rowcount or 0


async def assign_file_folder(
    upload_id: int,
    user_id: int,
    folder_id: Optional[int],
) -> bool:
    """Assign or unassign a page_uploads file to a folder."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE page_uploads SET folder_id = ? WHERE id = ? AND user_id = ?",
            (folder_id, upload_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0
