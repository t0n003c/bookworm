"""DB helpers for upload_catalogs CRUD and catalog-file junction table."""
from __future__ import annotations
from typing import Optional
from database import get_db


# ── private helpers ───────────────────────────────────────────────────────────

async def _catalog_owned(catalog_id: int, user_id: int, db) -> dict:
    """Return the catalog row or raise KeyError if not found / not owned."""
    cur = await db.execute(
        "SELECT id, page_id, user_id, name, parent_id, sort_order "
        "FROM upload_catalogs WHERE id = ? AND user_id = ?",
        (catalog_id, user_id),
    )
    row = await cur.fetchone()
    if not row:
        raise KeyError(catalog_id)
    return dict(row)


def _is_descendant(
    catalog_id: int,
    candidate_parent_id: Optional[int],
    all_catalogs: list[dict],
) -> bool:
    """
    Return True if candidate_parent_id is the same as catalog_id or is a
    descendant of it.  Prevents circular re-parenting via DnD.
    """
    if candidate_parent_id is None:
        return False
    if candidate_parent_id == catalog_id:
        return True
    visited: set[int] = set()
    current: Optional[int] = candidate_parent_id
    by_id = {c["id"]: c for c in all_catalogs}
    while current is not None:
        if current in visited:
            break  # cycle guard
        visited.add(current)
        node = by_id.get(current)
        if node is None:
            break
        parent = node["parent_id"]
        if parent == catalog_id:
            return True
        current = parent
    return False


# ── catalog CRUD ─────────────────────────────────────────────────────────────

async def get_catalogs_for_page(page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_catalogs "
            "WHERE page_id = ? AND user_id = ? AND deleted_at IS NULL "
            "ORDER BY parent_id NULLS FIRST, sort_order, name",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_catalog(
    page_id: int,
    user_id: int,
    name: str,
    parent_id: Optional[int],
) -> dict:
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO upload_catalogs (page_id, user_id, name, parent_id) "
            "VALUES (?, ?, ?, ?)",
            (page_id, user_id, name, parent_id),
        )
        new_id = cur.lastrowid
        await db.commit()
        cur2 = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_catalogs WHERE id = ?",
            (new_id,),
        )
        row = await cur2.fetchone()
    return dict(row)


async def update_catalog(
    catalog_id: int,
    user_id: int,
    name: Optional[str],
    parent_id,          # int | None (root) | sentinel — caller passes is_parent_set
    is_parent_set: bool,
    all_catalogs: list[dict],
    sort_order: Optional[int] = None,
) -> dict:
    """
    Update name and/or parent_id.
    Raises KeyError if not found / not owned.
    Raises ValueError('circular') on cycle detection.
    """
    async with get_db() as db:
        catalog = await _catalog_owned(catalog_id, user_id, db)

        if is_parent_set and parent_id is not None:
            if _is_descendant(catalog_id, parent_id, all_catalogs):
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
            vals += [catalog_id, user_id]
            await db.execute(
                f"UPDATE upload_catalogs SET {', '.join(sets)} "
                "WHERE id = ? AND user_id = ?",
                vals,
            )
            await db.commit()

        cur = await db.execute(
            "SELECT id, page_id, user_id, name, parent_id, sort_order "
            "FROM upload_catalogs WHERE id = ?",
            (catalog_id,),
        )
        row = await cur.fetchone()
    return dict(row)


async def soft_delete_catalog(catalog_id: int, user_id: int) -> bool:
    """
    Soft-delete a catalog: stamp deleted_at and orphan direct children.
    Junction rows (file ↔ catalog) are left in place so restore can keep them.
    Returns True if a row was updated.
    """
    async with get_db() as db:
        # Orphan direct children so they surface as root-level catalogs
        await db.execute(
            "UPDATE upload_catalogs SET parent_id = NULL "
            "WHERE parent_id = ? AND user_id = ? AND deleted_at IS NULL",
            (catalog_id, user_id),
        )
        cur = await db.execute(
            "UPDATE upload_catalogs "
            "SET deleted_at = datetime('now') "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (catalog_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def get_trashed_catalogs(page_id: int, user_id: int) -> list[dict]:
    """Return soft-deleted catalogs still within the 7-day window."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, name, deleted_at "
            "FROM upload_catalogs "
            "WHERE page_id = ? AND user_id = ? AND deleted_at IS NOT NULL "
            "ORDER BY deleted_at DESC",
            (page_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def restore_catalog(catalog_id: int, user_id: int) -> bool:
    """Clear deleted_at so the catalog reappears in the active tree (at root)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE upload_catalogs SET deleted_at = NULL "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (catalog_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def hard_delete_catalog(catalog_id: int, user_id: int) -> bool:
    """Permanently delete a soft-deleted catalog (user-triggered purge).
    ON DELETE CASCADE removes upload_catalog_files rows automatically."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM upload_catalogs "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (catalog_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def purge_expired_catalogs(page_id: int, user_id: int) -> int:
    """Delete catalogs soft-deleted more than 7 days ago.  Returns row count."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM upload_catalogs "
            "WHERE page_id = ? AND user_id = ? "
            "AND deleted_at IS NOT NULL "
            "AND deleted_at < datetime('now', '-7 days')",
            (page_id, user_id),
        )
        await db.commit()
    return cur.rowcount or 0

# ── junction table: file ↔ catalog ────────────────────────────────────────────

async def get_file_catalogs(upload_id: int, user_id: int) -> list[dict]:
    """Return all catalogs a given page_uploads file belongs to."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT uc.id, uc.name, uc.parent_id "
            "FROM upload_catalog_files ucf "
            "JOIN upload_catalogs uc ON uc.id = ucf.catalog_id "
            "WHERE ucf.upload_id = ? AND ucf.user_id = ? "
            "ORDER BY uc.name",
            (upload_id, user_id),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def add_file_to_catalog(
    catalog_id: int,
    upload_id: int,
    user_id: int,
) -> bool:
    """Assign a file to a catalog.  Idempotent (INSERT OR IGNORE).
    Returns True if a new row was inserted."""
    async with get_db() as db:
        cur = await db.execute(
            "INSERT OR IGNORE INTO upload_catalog_files "
            "(catalog_id, upload_id, user_id) VALUES (?, ?, ?)",
            (catalog_id, upload_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


async def remove_file_from_catalog(
    catalog_id: int,
    upload_id: int,
    user_id: int,
) -> bool:
    """Unassign a file from a catalog.  Returns True if a row was removed."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM upload_catalog_files "
            "WHERE catalog_id = ? AND upload_id = ? AND user_id = ?",
            (catalog_id, upload_id, user_id),
        )
        await db.commit()
    return (cur.rowcount or 0) > 0
