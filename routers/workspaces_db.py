"""Workspace CRUD helpers."""
from typing import Optional
from database import get_db


async def get_all_workspaces() -> list[dict]:
    """Return all active (non-trashed) workspaces ordered by sort_order."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at "
            "FROM workspaces WHERE deleted_at IS NULL ORDER BY sort_order ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_descendant_ids(root_id: int) -> set[int]:
    """Return root_id plus the IDs of every workspace nested beneath it."""
    all_ws = await get_all_workspaces()
    by_parent: dict[int, list[int]] = {}
    for ws in all_ws:
        pid = ws.get("parent_id")
        if pid:
            by_parent.setdefault(pid, []).append(ws["id"])
    # BFS from root
    result: set[int] = set()
    queue = [root_id]
    while queue:
        current = queue.pop()
        result.add(current)
        queue.extend(by_parent.get(current, []))
    return result


async def get_workspace_tree() -> list[dict]:
    """Return all workspaces as a nested tree (each node has a 'children' list)."""
    all_ws = await get_all_workspaces()
    by_id: dict[int, dict] = {ws["id"]: {**ws, "children": []} for ws in all_ws}
    roots: list[dict] = []
    for ws in all_ws:
        pid = ws.get("parent_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(by_id[ws["id"]])
        else:
            roots.append(by_id[ws["id"]])
    return roots


async def get_workspace_breadcrumb(workspace_id: int) -> list[dict]:
    """Return the ancestor chain from root → workspace (inclusive)."""
    all_ws = await get_all_workspaces()
    by_id = {ws["id"]: ws for ws in all_ws}
    path: list[dict] = []
    current_id: Optional[int] = workspace_id
    visited: set[int] = set()
    while current_id and current_id not in visited:
        visited.add(current_id)
        ws = by_id.get(current_id)
        if not ws:
            break
        path.insert(0, ws)
        current_id = ws.get("parent_id")
    return path


async def get_open_workspaces() -> list[dict]:
    """Return only active workspaces currently pinned to the top bar."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at "
            "FROM workspaces WHERE is_open = 1 AND deleted_at IS NULL "
            "ORDER BY sort_order ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_workspace_by_id(workspace_id: int) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at "
            "FROM workspaces WHERE id = ? AND deleted_at IS NULL",
            (workspace_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def open_workspace(workspace_id: int) -> None:
    """Mark a workspace as open (visible in top bar)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE workspaces SET is_open = 1 WHERE id = ?", (workspace_id,)
        )
        await db.commit()


async def close_workspace(workspace_id: int) -> None:
    """Remove a workspace from the top bar (does NOT delete it)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE workspaces SET is_open = 0 WHERE id = ?", (workspace_id,)
        )
        await db.commit()


async def create_workspace(
    name: str,
    emoji: str = "\U0001f4c1",
    parent_id: Optional[int] = None,
) -> int:
    """Insert a workspace and return its new id.

    sort_order is set to max(siblings) + 10 so the new workspace
    naturally lands at the bottom of its sibling group.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL",
            (parent_id,),
        )
        row = await cur.fetchone()
        new_sort_order = (row[0] if row else -10) + 10
        cursor = await db.execute(
            "INSERT INTO workspaces (name, emoji, parent_id, sort_order) "
            "VALUES (?, ?, ?, ?)",
            (name.strip(), emoji, parent_id, new_sort_order),
        )
        await db.commit()
        return cursor.lastrowid


async def update_workspace(
    workspace_id: int,
    name: str,
    emoji: str,
    parent_id: Optional[int] = None,
) -> None:
    """Update a workspace's name, emoji and optional parent."""
    async with get_db() as db:
        await db.execute(
            "UPDATE workspaces SET name = ?, emoji = ?, parent_id = ? WHERE id = ?",
            (name.strip(), emoji, parent_id, workspace_id),
        )
        await db.commit()


async def get_first_workspace_id() -> Optional[int]:
    """Return the id of the oldest active workspace (fallback default)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def get_favorite_workspaces() -> list[dict]:
    """Return active workspaces marked as favorite, ordered by name."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, created_at "
            "FROM workspaces WHERE is_favorite = 1 AND deleted_at IS NULL ORDER BY name ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def toggle_workspace_favorite(workspace_id: int) -> bool:
    """Flip is_favorite for a workspace. Returns the new value (True = favorited)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT is_favorite FROM workspaces WHERE id = ?", (workspace_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return False
        new_val = 0 if row[0] else 1
        await db.execute(
            "UPDATE workspaces SET is_favorite = ? WHERE id = ?", (new_val, workspace_id)
        )
        await db.commit()
        return bool(new_val)


async def delete_workspace(workspace_id: int) -> set[int]:
    """Soft-delete a workspace AND every workspace nested beneath it.

    Moves the whole subtree to the trash (sets deleted_at) and unpins them
    from the top bar.  Returns the set of IDs that were trashed so the
    caller can decide where to navigate next.
    """
    ids_to_trash = await get_descendant_ids(workspace_id)
    if not ids_to_trash:
        ids_to_trash = {workspace_id}
    placeholders = ",".join("?" * len(ids_to_trash))
    async with get_db() as db:
        await db.execute(
            f"UPDATE workspaces "
            f"SET deleted_at = CURRENT_TIMESTAMP, is_open = 0 "
            f"WHERE id IN ({placeholders})",
            tuple(ids_to_trash),
        )
        await db.commit()
    return ids_to_trash


async def restore_workspace(workspace_id: int) -> None:
    """Recover a workspace from the trash (clears deleted_at, keeps original parent)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE workspaces SET deleted_at = NULL WHERE id = ?",
            (workspace_id,),
        )
        await db.commit()


async def reorder_workspace(
    workspace_id: int,
    relative_to_id: int,
    position: str,  # 'before' | 'after'
) -> None:
    """Reorder workspace_id relative to relative_to_id.

    Inserts workspace_id before or after relative_to_id in the sibling list,
    re-homing it under relative_to_id's parent when necessary.
    Reassigns dense sort_order values (multiples of 10) to all siblings.
    """
    async with get_db() as db:
        # 1. Resolve the destination parent from the reference workspace
        cur = await db.execute(
            "SELECT parent_id FROM workspaces WHERE id = ? AND deleted_at IS NULL",
            (relative_to_id,),
        )
        row = await cur.fetchone()
        if row is None:
            return  # reference workspace gone — no-op
        dest_parent_id: Optional[int] = row[0]

        # 2. Build the ordered sibling list at the destination (excluding the mover)
        cur = await db.execute(
            "SELECT id FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL "
            "ORDER BY sort_order ASC",
            (dest_parent_id,),
        )
        siblings: list[int] = [r[0] for r in await cur.fetchall()]
        siblings = [s for s in siblings if s != workspace_id]  # remove if already here

        # 3. Insert at the right position
        try:
            ref_idx = siblings.index(relative_to_id)
        except ValueError:
            ref_idx = len(siblings)  # reference gone? append
        insert_at = ref_idx if position == 'before' else ref_idx + 1
        siblings.insert(insert_at, workspace_id)

        # 4. Persist: update sort_order for all siblings, move mover to new parent
        for rank, sid in enumerate(siblings):
            await db.execute(
                "UPDATE workspaces SET sort_order = ? WHERE id = ?",
                (rank * 10, sid),
            )
        await db.execute(
            "UPDATE workspaces SET parent_id = ? WHERE id = ?",
            (dest_parent_id, workspace_id),
        )
        await db.commit()


async def reparent_workspace(workspace_id: int, new_parent_id: Optional[int]) -> None:
    """Change the parent of a workspace and append it at the end of new siblings.

    Pass new_parent_id=None to promote the workspace to the root level.
    Cycle-safety must be enforced by the caller before invoking this.
    """
    async with get_db() as db:
        # Find the max sort_order among the new siblings so we append at the end
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL AND id != ?",
            (new_parent_id, workspace_id),
        )
        row = await cur.fetchone()
        new_sort_order = (row[0] if row else -10) + 10
        await db.execute(
            "UPDATE workspaces SET parent_id = ?, sort_order = ? WHERE id = ?",
            (new_parent_id, new_sort_order, workspace_id),
        )
        await db.commit()


async def permanent_delete_workspace(workspace_id: int) -> None:
    """Permanently destroy a trashed workspace, ALL its descendants, and their notes.

    Uses a BFS over the full workspaces table (including trashed rows) so that
    children trashed alongside the parent are also wiped.
    """
    async with get_db() as db:
        # Build parent→children map across ALL workspaces (including trashed)
        cursor = await db.execute("SELECT id, parent_id FROM workspaces")
        rows = await cursor.fetchall()
        by_parent: dict[int, list[int]] = {}
        for row in rows:
            pid = row["parent_id"]
            if pid:
                by_parent.setdefault(pid, []).append(row["id"])

        # BFS to collect root + every descendant
        ids_to_delete: set[int] = set()
        queue = [workspace_id]
        while queue:
            current = queue.pop()
            ids_to_delete.add(current)
            queue.extend(by_parent.get(current, []))

        placeholders = ",".join("?" * len(ids_to_delete))
        id_tuple = tuple(ids_to_delete)
        await db.execute(
            f"DELETE FROM notes WHERE workspace_id IN ({placeholders})", id_tuple
        )
        await db.execute(
            f"DELETE FROM workspaces WHERE id IN ({placeholders})", id_tuple
        )
        await db.commit()


async def get_trashed_workspaces() -> list[dict]:
    """Return workspaces currently in the trash, with days_remaining computed."""
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, name, emoji, deleted_at,
                   MAX(0, 30 - CAST(
                       (julianday('now') - julianday(deleted_at))
                   AS INTEGER)) AS days_remaining
            FROM workspaces
            WHERE deleted_at IS NOT NULL
            ORDER BY deleted_at DESC
            """
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def purge_expired_trash() -> int:
    """Hard-delete workspaces that have been in the trash for >30 days.

    Returns the number of workspaces permanently removed.
    """
    async with get_db() as db:
        # Find expired IDs first so we can cascade-delete notes
        cursor = await db.execute(
            "SELECT id FROM workspaces "
            "WHERE deleted_at IS NOT NULL "
            "AND julianday('now') - julianday(deleted_at) > 30"
        )
        expired = [r[0] for r in await cursor.fetchall()]
        for ws_id in expired:
            await db.execute("DELETE FROM notes WHERE workspace_id = ?", (ws_id,))
            await db.execute(
                "UPDATE workspaces SET parent_id = NULL WHERE parent_id = ?", (ws_id,)
            )
            await db.execute("DELETE FROM workspaces WHERE id = ?", (ws_id,))
        await db.commit()
        return len(expired)
