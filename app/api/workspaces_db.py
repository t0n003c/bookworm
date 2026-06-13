"""Workspace CRUD helpers."""
from typing import Optional
from database import get_db


# ── private helpers ───────────────────────────────────────────

async def _all_workspaces_raw() -> list[dict]:
    """All non-trashed workspaces, no user filter (for internal BFS ops)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at, user_id, ws_type "
            "FROM workspaces WHERE deleted_at IS NULL ORDER BY sort_order ASC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ── public user-scoped queries ────────────────────────────────

async def get_all_workspaces(user_id: int) -> list[dict]:
    """Return all active (non-trashed) workspaces for a given user."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at, ws_type, db_card_preview "
            "FROM workspaces WHERE deleted_at IS NULL AND user_id = ? "
            "ORDER BY sort_order ASC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_descendant_ids(root_id: int, user_id: Optional[int] = None) -> set[int]:
    """Return root_id plus the IDs of every workspace nested beneath it.

    Uses the raw (unfiltered) workspace list so it correctly traverses
    the full tree even when called from internal bulk operations.
    """
    all_ws = await _all_workspaces_raw()
    by_parent: dict[int, list[int]] = {}
    for ws in all_ws:
        pid = ws.get("parent_id")
        if pid:
            by_parent.setdefault(pid, []).append(ws["id"])
    result: set[int] = set()
    queue = [root_id]
    while queue:
        current = queue.pop()
        result.add(current)
        queue.extend(by_parent.get(current, []))
    return result


async def get_workspace_tree(user_id: int) -> list[dict]:
    """Return a user's workspaces as a nested tree (each node has 'children')."""
    all_ws = await get_all_workspaces(user_id)
    by_id: dict[int, dict] = {ws["id"]: {**ws, "children": []} for ws in all_ws}
    roots: list[dict] = []
    for ws in all_ws:
        pid = ws.get("parent_id")
        if pid and pid in by_id:
            by_id[pid]["children"].append(by_id[ws["id"]])
        else:
            roots.append(by_id[ws["id"]])
    return roots


async def get_workspace_breadcrumb(workspace_id: int, user_id: int) -> list[dict]:
    """Return the ancestor chain from root → workspace (inclusive)."""
    all_ws = await get_all_workspaces(user_id)
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


async def get_open_workspaces(user_id: int) -> list[dict]:
    """Return workspaces currently pinned to the top bar for a given user."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at, ws_type "
            "FROM workspaces WHERE is_open = 1 AND deleted_at IS NULL "
            "AND user_id = ? ORDER BY sort_order ASC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_workspace_by_id(workspace_id: int) -> Optional[dict]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, "
            "       sort_order, created_at, user_id, ws_type, db_card_preview "
            "FROM workspaces WHERE id = ? AND deleted_at IS NULL",
            (workspace_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def set_db_card_preview(ws_id: int, user_id: int, mode: str) -> bool:
    """Set a database workspace's card preview mode ('cover' | 'content').

    Ownership is enforced in the SQL (user_id match). Returns True if a row was
    updated. Caller validates `mode` and the ws_type='database' guard.
    """
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE workspaces SET db_card_preview = ? "
            "WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (mode, ws_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


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


async def _unique_sibling_name(
    db,
    base_name: str,
    user_id: int,
    parent_id: Optional[int],
    exclude_id: Optional[int] = None,
) -> str:
    """Return base_name if unique among active siblings, else 'base_name (2)', etc."""
    sql = (
        "SELECT name FROM workspaces "
        "WHERE user_id=? AND deleted_at IS NULL "
        "AND (parent_id IS ? OR parent_id=?)"
    )
    params: list = [user_id, parent_id, parent_id]
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    cur = await db.execute(sql, params)
    taken = {r[0].strip().lower() for r in await cur.fetchall()}
    candidate = base_name.strip()
    if candidate.lower() not in taken:
        return candidate
    n = 2
    while f"{candidate} ({n})".lower() in taken:
        n += 1
    return f"{candidate} ({n})"


async def create_workspace(
    name: str,
    user_id: int,
    emoji: str = "\U0001f4c1",
    parent_id: Optional[int] = None,
    ws_type: str = "workspace",
) -> int:
    """Insert a workspace for the given user and return its new id.

    Name is auto-suffixed '(2)', '(3)' … when a sibling with the same
    name already exists (case-insensitive).
    sort_order is set to max(siblings) + 10 so the new workspace
    naturally lands at the bottom of its sibling group.
    """
    async with get_db() as db:
        unique_name = await _unique_sibling_name(db, name, user_id, parent_id)
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL AND user_id = ?",
            (parent_id, user_id),
        )
        row = await cur.fetchone()
        new_sort_order = (row[0] if row else -10) + 10
        cursor = await db.execute(
            "INSERT INTO workspaces (name, emoji, parent_id, sort_order, user_id, ws_type) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (unique_name, emoji, parent_id, new_sort_order, user_id, ws_type),
        )
        await db.commit()
        return cursor.lastrowid


async def update_workspace(
    workspace_id: int,
    name: str,
    emoji: str,
    parent_id: Optional[int] = None,
) -> None:
    """Update a workspace's name, emoji and optional parent.

    If the new name collides with a sibling's name the name is
    auto-suffixed '(2)', '(3)' … (case-insensitive, excludes self).
    """
    async with get_db() as db:
        row = await (await db.execute(
            "SELECT user_id FROM workspaces WHERE id=?", (workspace_id,)
        )).fetchone()
        user_id = row[0] if row else None
        unique_name = (
            await _unique_sibling_name(db, name, user_id, parent_id, exclude_id=workspace_id)
            if user_id is not None else name.strip()
        )
        await db.execute(
            "UPDATE workspaces SET name = ?, emoji = ?, parent_id = ? WHERE id = ?",
            (unique_name, emoji, parent_id, workspace_id),
        )
        await db.commit()


async def get_first_workspace_id(user_id: int) -> Optional[int]:
    """Return the id of the oldest active workspace for a user (fallback default)."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM workspaces WHERE deleted_at IS NULL AND user_id = ? "
            "ORDER BY created_at ASC LIMIT 1",
            (user_id,),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


QUICK_NOTES_WS_NAME = "Quick Notes"


async def get_or_create_quick_notes_workspace(user_id: int) -> int:
    """Return the id of the user's dedicated 'Quick Notes' workspace, creating
    it (root-level, 📥) on first use.

    Backs the PWA 'New Note' app-shortcut so every quick capture always lands
    in one predictable, findable place instead of an ambiguous/empty workspace.
    Matches an existing root workspace by exact name so we never spawn
    'Quick Notes (2)' — the check runs before create_workspace (which would
    otherwise auto-suffix a duplicate sibling name).
    """
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM workspaces "
            "WHERE user_id = ? AND deleted_at IS NULL AND parent_id IS NULL "
            "AND name = ? ORDER BY id ASC LIMIT 1",
            (user_id, QUICK_NOTES_WS_NAME),
        )
        row = await cursor.fetchone()
        if row:
            return row[0]
    # None yet — create it. Separate call (create_workspace opens its own db).
    return await create_workspace(QUICK_NOTES_WS_NAME, user_id, emoji="\U0001F4E5")


async def get_favorite_workspaces(user_id: int) -> list[dict]:
    """Return active workspaces marked as favorite for a user, ordered by name."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, emoji, is_open, is_favorite, parent_id, created_at, ws_type "
            "FROM workspaces WHERE is_favorite = 1 AND deleted_at IS NULL "
            "AND user_id = ? ORDER BY name ASC",
            (user_id,),
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
        await db.executemany(
            "UPDATE workspaces SET sort_order = ? WHERE id = ?",
            [(rank * 10, sid) for rank, sid in enumerate(siblings)],
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


async def duplicate_workspace(workspace_id: int, user_id: int) -> int:
    """Deep-copy a workspace and its entire subtree as a sibling.

    Copies (BFS, one transaction):
      - workspace rows (name → "name (copy)", same emoji + parent)
      - workspace_categories
      - notes: title, content, meeting_date, icon
      - note_categories + note_attributes per note

    Attachment *files* are intentionally skipped — copying binary blobs
    across disk paths is I/O-heavy for questionable gain.  Duplicated notes
    start clean without attachments.

    Returns the id of the newly-created root clone.
    """
    async with get_db() as db:
        # ── fetch source root ────────────────────────────────────────────
        cur = await db.execute(
            "SELECT name, emoji, parent_id, ws_type FROM workspaces "
            "WHERE id = ? AND deleted_at IS NULL",
            (workspace_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise ValueError(f"Workspace {workspace_id} not found")
        src_name    = row["name"]
        src_emoji   = row["emoji"]
        src_parent  = row["parent_id"]
        src_type    = row["ws_type"] or "workspace"

        # ── create root clone ────────────────────────────────────────────
        clone_name = await _unique_sibling_name(
            db, f"{src_name} (copy)", user_id, src_parent
        )
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) FROM workspaces "
            "WHERE parent_id IS ? AND deleted_at IS NULL AND user_id = ?",
            (src_parent, user_id),
        )
        new_sort = (await cur.fetchone())[0] + 10

        cur = await db.execute(
            "INSERT INTO workspaces(name, emoji, parent_id, sort_order, user_id, is_open, ws_type) "
            "VALUES(?, ?, ?, ?, ?, 1, ?)",
            (clone_name, src_emoji, src_parent, new_sort, user_id, src_type),
        )
        new_root_id = cur.lastrowid

        # ── BFS: (source_ws_id, new_clone_id) ───────────────────────────
        queue: list[tuple[int, int]] = [(workspace_id, new_root_id)]

        while queue:
            src_id, new_id = queue.pop(0)

            # workspace_categories
            cat_cur = await db.execute(
                "SELECT category_id FROM workspace_categories WHERE workspace_id = ?",
                (src_id,),
            )
            for cr in await cat_cur.fetchall():
                await db.execute(
                    "INSERT OR IGNORE INTO workspace_categories(workspace_id, category_id) "
                    "VALUES(?, ?)",
                    (new_id, cr[0]),
                )

            # notes + their tags + attributes
            note_cur = await db.execute(
                "SELECT id, title, content, meeting_date, icon FROM notes "
                "WHERE workspace_id = ?",
                (src_id,),
            )
            for note in await note_cur.fetchall():
                nc = await db.execute(
                    "INSERT INTO notes(workspace_id, title, content, meeting_date, icon) "
                    "VALUES(?, ?, ?, ?, ?)",
                    (new_id, note["title"], note["content"],
                     note["meeting_date"], note["icon"]),
                )
                new_note_id = nc.lastrowid

                # note_categories
                ncat_cur = await db.execute(
                    "SELECT category_id FROM note_categories WHERE note_id = ?",
                    (note["id"],),
                )
                for ncr in await ncat_cur.fetchall():
                    await db.execute(
                        "INSERT OR IGNORE INTO note_categories(note_id, category_id) "
                        "VALUES(?, ?)",
                        (new_note_id, ncr[0]),
                    )

                # note_attributes
                attr_cur = await db.execute(
                    "SELECT key, value, attr_def_id FROM note_attributes "
                    "WHERE note_id = ?",
                    (note["id"],),
                )
                for ar in await attr_cur.fetchall():
                    await db.execute(
                        "INSERT INTO note_attributes(note_id, key, value, attr_def_id) "
                        "VALUES(?, ?, ?, ?)",
                        (new_note_id, ar["key"], ar["value"], ar["attr_def_id"]),
                    )

            # db_cards + db_card_attrs (only for database-type nodes)
            src_type_cur = await db.execute(
                "SELECT ws_type FROM workspaces WHERE id = ?", (src_id,)
            )
            src_type_row = await src_type_cur.fetchone()
            if src_type_row and (src_type_row[0] or "workspace") == "database":
                cards_cur = await db.execute(
                    "SELECT id, title, cover_url, note_content, note_box_height, sort_order "
                    "FROM db_cards WHERE db_id = ?", (src_id,)
                )
                for card_row in await cards_cur.fetchall():
                    nc = await db.execute(
                        "INSERT INTO db_cards (db_id, user_id, title, cover_url, "
                        "note_content, note_box_height, sort_order) VALUES(?,?,?,?,?,?,?)",
                        (new_id, user_id, card_row["title"], card_row["cover_url"],
                         card_row["note_content"], card_row["note_box_height"],
                         card_row["sort_order"]),
                    )
                    new_card_id = nc.lastrowid
                    a_cur = await db.execute(
                        "SELECT attr_key, attr_value, attr_type, attr_options, sort_order "
                        "FROM db_card_attrs WHERE card_id = ?", (card_row["id"],)
                    )
                    for a in await a_cur.fetchall():
                        await db.execute(
                            "INSERT INTO db_card_attrs "
                            "(card_id, attr_key, attr_value, attr_type, attr_options, sort_order) "
                            "VALUES(?,?,?,?,?,?)",
                            (new_card_id, a["attr_key"], a["attr_value"],
                             a["attr_type"], a["attr_options"], a["sort_order"]),
                        )

            # enqueue children
            child_cur = await db.execute(
                "SELECT id, name, emoji, sort_order, ws_type FROM workspaces "
                "WHERE parent_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC",
                (src_id,),
            )
            for child in await child_cur.fetchall():
                child_name = await _unique_sibling_name(
                    db, child["name"], user_id, new_id
                )
                nc2 = await db.execute(
                    "INSERT INTO workspaces(name, emoji, parent_id, sort_order, user_id, is_open, ws_type) "
                    "VALUES(?, ?, ?, ?, ?, 0, ?)",
                    (child_name, child["emoji"], new_id, child["sort_order"], user_id,
                     child["ws_type"] or "workspace"),
                )
                queue.append((child["id"], nc2.lastrowid))

        await db.commit()
        return new_root_id


async def permanent_delete_workspace(workspace_id: int) -> None:
    """Permanently destroy a trashed workspace, ALL its descendants, and their notes.

    Uses a BFS over the full workspaces table (including trashed rows) so that
    children trashed alongside the parent are also wiped.
    Cleans up attachment files on disk after the DB transaction commits.
    """
    from app.api.attachments_db import UPLOAD_DIR  # local import avoids circularity
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

        # Collect attachment filenames before cascade-delete wipes them
        cur = await db.execute(
            f"SELECT na.filename FROM note_attachments na "
            f"JOIN notes n ON n.id = na.note_id "
            f"WHERE n.workspace_id IN ({placeholders})",
            id_tuple,
        )
        filenames = [r[0] for r in await cur.fetchall()]

        await db.execute(
            f"DELETE FROM notes WHERE workspace_id IN ({placeholders})", id_tuple
        )
        await db.execute(
            f"DELETE FROM workspaces WHERE id IN ({placeholders})", id_tuple
        )
        await db.commit()

    # Clean up orphaned files after the transaction commits
    for fname in filenames:
        p = UPLOAD_DIR / fname
        if p.exists():
            p.unlink(missing_ok=True)


async def get_trashed_workspaces(user_id: int) -> list[dict]:
    """Return trashed workspaces for a given user, with days_remaining."""
    async with get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, name, emoji, deleted_at,
                   MAX(0, 30 - CAST(
                       (julianday('now') - julianday(deleted_at))
                   AS INTEGER)) AS days_remaining
            FROM workspaces
            WHERE deleted_at IS NOT NULL AND user_id = ?
            ORDER BY deleted_at DESC
            """,
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def empty_workspace_trash(user_id: int) -> int:
    """Permanently delete ALL trashed workspaces (and every descendant) for a user.

    Uses the same BFS cascade as permanent_delete_workspace but processes all
    trashed roots in one transaction. Returns count of top-level items deleted.
    """
    from app.api.attachments_db import UPLOAD_DIR  # local import avoids circularity

    filenames_to_purge: list[str] = []
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM workspaces WHERE deleted_at IS NOT NULL AND user_id = ?",
            (user_id,),
        )
        trashed_roots = [r[0] for r in await cur.fetchall()]
        if not trashed_roots:
            return 0

        # BFS: collect all descendants (including non-trashed children of trashed parents)
        all_cur = await db.execute("SELECT id, parent_id FROM workspaces")
        by_parent: dict[int, list[int]] = {}
        for row in await all_cur.fetchall():
            if row["parent_id"]:
                by_parent.setdefault(row["parent_id"], []).append(row["id"])

        ids_to_delete: set[int] = set()
        queue = list(trashed_roots)
        while queue:
            current = queue.pop()
            ids_to_delete.add(current)
            queue.extend(by_parent.get(current, []))

        placeholders = ",".join("?" * len(ids_to_delete))
        id_tuple = tuple(ids_to_delete)

        att_cur = await db.execute(
            f"SELECT na.filename FROM note_attachments na "
            f"JOIN notes n ON n.id = na.note_id "
            f"WHERE n.workspace_id IN ({placeholders})",
            id_tuple,
        )
        filenames_to_purge = [r[0] for r in await att_cur.fetchall()]

        await db.execute(
            f"DELETE FROM notes WHERE workspace_id IN ({placeholders})", id_tuple
        )
        await db.execute(
            f"DELETE FROM workspaces WHERE id IN ({placeholders})", id_tuple
        )
        await db.commit()

    for fname in filenames_to_purge:
        p = UPLOAD_DIR / fname
        if p.exists():
            p.unlink(missing_ok=True)

    return len(trashed_roots)


async def purge_expired_trash() -> int:
    """Hard-delete workspaces that have been in the trash for >30 days.

    Returns the number of workspaces permanently removed.
    Cleans up attachment files on disk after the DB transaction commits.
    """
    from app.api.attachments_db import UPLOAD_DIR  # local import avoids circularity
    filenames_to_purge: list[str] = []
    async with get_db() as db:
        # Find expired IDs first so we can cascade-delete notes
        cursor = await db.execute(
            "SELECT id FROM workspaces "
            "WHERE deleted_at IS NOT NULL "
            "AND julianday('now') - julianday(deleted_at) > 30"
        )
        expired = [r[0] for r in await cursor.fetchall()]
        for ws_id in expired:
            # Collect attachment filenames before cascade-delete wipes them
            cur = await db.execute(
                "SELECT na.filename FROM note_attachments na "
                "JOIN notes n ON n.id = na.note_id "
                "WHERE n.workspace_id = ?",
                (ws_id,),
            )
            filenames_to_purge.extend(r[0] for r in await cur.fetchall())
            await db.execute("DELETE FROM notes WHERE workspace_id = ?", (ws_id,))
            await db.execute(
                "UPDATE workspaces SET parent_id = NULL WHERE parent_id = ?", (ws_id,)
            )
            await db.execute("DELETE FROM workspaces WHERE id = ?", (ws_id,))
        await db.commit()
    # Clean up orphaned files after the transaction commits
    for fname in filenames_to_purge:
        p = UPLOAD_DIR / fname
        if p.exists():
            p.unlink(missing_ok=True)
    return len(expired)
