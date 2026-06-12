"""DB helpers for the sharing system.

All access via get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

import secrets
from typing import Optional

from database import get_db


# ── Public link CRUD ──────────────────────────────────────────────────────────

async def get_public_link(
    object_type: str, object_id: int, owner_id: int
) -> Optional[dict]:
    """Return the active public link row or None."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, token, object_type, object_id, owner_id, created_at, expires_at
            FROM public_share_links
            WHERE object_type = ? AND object_id = ? AND owner_id = ?
              AND (expires_at IS NULL OR expires_at > datetime('now'))
            LIMIT 1
            """,
            (object_type, object_id, owner_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def create_public_link(
    object_type: str, object_id: int, owner_id: int
) -> dict:
    """Create (or replace) a public share link. Returns {token, id}."""
    token = secrets.token_urlsafe(32)
    async with get_db() as db:
        # Use INSERT OR REPLACE so repeated calls are idempotent.
        cur = await db.execute(
            """
            INSERT OR REPLACE INTO public_share_links
                (token, object_type, object_id, owner_id)
            VALUES (?, ?, ?, ?)
            """,
            (token, object_type, object_id, owner_id),
        )
        await db.commit()
        return {"id": cur.lastrowid, "token": token}


async def revoke_public_link(
    object_type: str, object_id: int, owner_id: int
) -> None:
    """Delete the public link row for this object."""
    async with get_db() as db:
        await db.execute(
            """
            DELETE FROM public_share_links
            WHERE object_type = ? AND object_id = ? AND owner_id = ?
            """,
            (object_type, object_id, owner_id),
        )
        await db.commit()


async def get_shared_object_ids(object_type: str, object_ids: list[int]) -> set[int]:
    """Return the subset of object_ids that have an active public share link.

    Single batch query — safe to call with an empty list (returns empty set).
    Does not filter by owner_id so the badge reflects any active share link.
    """
    if not object_ids:
        return set()
    async with get_db() as db:
        placeholders = ",".join("?" * len(object_ids))
        cur = await db.execute(
            f"""
            SELECT DISTINCT object_id FROM public_share_links
            WHERE object_type = ? AND object_id IN ({placeholders})
              AND (expires_at IS NULL OR expires_at > datetime('now'))
            """,
            (object_type, *object_ids),
        )
        return {row[0] for row in await cur.fetchall()}


async def get_public_link_by_token(token: str) -> Optional[dict]:
    """Look up a public link by its token. Returns None if expired or missing."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, token, object_type, object_id, owner_id, created_at, expires_at
            FROM public_share_links
            WHERE token = ?
              AND (expires_at IS NULL OR expires_at > datetime('now'))   LIMIT 1
            """,
            (token,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


# ── User search ──────────────────────────────────────────────────────────────

async def search_users_for_share(query: str, exclude_user_id: int) -> list[dict]:
    """Return up to 10 users whose username contains `query` (case-insensitive).

    Excludes the requesting user and demo accounts.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, username
            FROM users
            WHERE username LIKE ?
              AND id != ?
              AND role != 'demo'
            ORDER BY username
            LIMIT 10
            """,
            (f"%{query}%", exclude_user_id),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


# ── Shared inbox helpers ─────────────────────────────────────────────────────

async def get_or_create_shared_inbox_workspace(user_id: int) -> int:
    """Return the id of the '📥 Shared with Me' workspace, creating it if absent."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id FROM workspaces
            WHERE user_id = ? AND name = '📥 Shared with Me'
              AND deleted_at IS NULL
            LIMIT 1
            """,
            (user_id,),
        )
        row = await cur.fetchone()
        if row:
            return row[0]
        cur = await db.execute(
            """
            INSERT INTO workspaces (user_id, name, emoji, ws_type)
            VALUES (?, '📥 Shared with Me', '📥', 'workspace')
            """,
            (user_id,),
        )
        await db.commit()
        return cur.lastrowid


async def get_or_create_shared_cards_database(user_id: int) -> int:
    """Return the id of the '📥 Shared Cards' database workspace, creating if absent."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id FROM workspaces
            WHERE user_id = ? AND name = '📥 Shared Cards'
              AND deleted_at IS NULL
            LIMIT 1
            """,
            (user_id,),
        )
        row = await cur.fetchone()
        if row:
            return row[0]
        cur = await db.execute(
            """
            INSERT INTO workspaces (user_id, name, emoji, ws_type)
            VALUES (?, '📥 Shared Cards', '📥', 'database')
            """,
            (user_id,),
        )
        await db.commit()
        return cur.lastrowid


# ── Note copy ────────────────────────────────────────────────────────────────

async def copy_note_to_workspace(note_id: int, target_workspace_id: int) -> int:
    """Deep-copy a note (without file attachments) into a target workspace.

    Copies: notes row, note_categories, note_attributes.
    Returns the new note id.
    """
    async with get_db() as db:
        # 1. Copy the note row itself
        cur = await db.execute(
            """
            INSERT INTO notes (workspace_id, title, icon, content, meeting_date)
            SELECT ?, title, icon, content, meeting_date
            FROM notes WHERE id = ?
            """,
            (target_workspace_id, note_id),
        )
        new_note_id = cur.lastrowid

        # 2. Copy category associations (category rows are global — no copy needed)
        await db.execute(
            """
            INSERT INTO note_categories (note_id, category_id)
            SELECT ?, category_id FROM note_categories WHERE note_id = ?
            """,
            (new_note_id, note_id),
        )

        # 3. Copy note attributes
        await db.execute(
            """
            INSERT INTO note_attributes (note_id, attr_def_id, key, value)
            SELECT ?, attr_def_id, key, value FROM note_attributes WHERE note_id = ?
            """,
            (new_note_id, note_id),
        )

        await db.commit()
        return new_note_id


# ── Workspace tree deep-copy ─────────────────────────────────────────────────

async def copy_workspace_tree_to_user(ws_id: int, recipient_user_id: int) -> int:
    """BFS deep-copy of an entire workspace tree into a recipient's account.

    Copies: workspace rows (with all descendants) + all notes inside each.
    Returns the new root workspace id.
    """
    async with get_db() as db:
        # BFS: collect all descendant workspace ids in traversal order.
        # id_map[old_id] = new_id so we can rewire parent_id references.
        id_map: dict[int, int] = {}
        queue = [ws_id]

        while queue:
            old_id = queue.pop(0)

            # Fetch this workspace's data
            cur = await db.execute(
                "SELECT name, emoji, ws_type, sort_order FROM workspaces WHERE id = ?",
                (old_id,),
            )
            row = await cur.fetchone()
            if not row:
                continue

            new_parent_id = id_map.get(
                # root's parent stays None; children map to their copied parent
                (await db.execute(
                    "SELECT parent_id FROM workspaces WHERE id = ?", (old_id,)
                )).fetchone()[0] if old_id != ws_id else None
            ) if old_id != ws_id else None

            # Actually, let me redo this without a nested await expression:
            if old_id != ws_id:
                par_cur = await db.execute(
                    "SELECT parent_id FROM workspaces WHERE id = ?", (old_id,)
                )
                par_row = await par_cur.fetchone()
                old_parent = par_row[0] if par_row else None
                new_parent_id = id_map.get(old_parent)
            else:
                new_parent_id = None

            ins_cur = await db.execute(
                """
                INSERT INTO workspaces
                    (user_id, name, emoji, ws_type, sort_order, parent_id,
                     is_open, is_favorite)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0)
                """,
                (recipient_user_id, row["name"], row["emoji"],
                 row["ws_type"], row["sort_order"], new_parent_id),
            )
            new_id = ins_cur.lastrowid
            id_map[old_id] = new_id

            # Copy all notes in this workspace
            note_cur = await db.execute(
                "SELECT id FROM notes WHERE workspace_id = ?", (old_id,)
            )
            note_rows = await note_cur.fetchall()
            for note_row in note_rows:
                note_id = note_row[0]
                # Inline note copy (no separate connection needed — same db handle)
                nc = await db.execute(
                    """
                    INSERT INTO notes (workspace_id, title, icon, content, meeting_date)
                    SELECT ?, title, icon, content, meeting_date
                    FROM notes WHERE id = ?
                    """,
                    (new_id, note_id),
                )
                new_note_id = nc.lastrowid
                await db.execute(
                    """
                    INSERT INTO note_categories (note_id, category_id)
                    SELECT ?, category_id FROM note_categories WHERE note_id = ?
                    """,
                    (new_note_id, note_id),
                )
                await db.execute(
                    """
                    INSERT INTO note_attributes (note_id, attr_def_id, key, value)
                    SELECT ?, attr_def_id, key, value FROM note_attributes WHERE note_id = ?
                    """,
                    (new_note_id, note_id),
                )

            # Enqueue children
            child_cur = await db.execute(
                "SELECT id FROM workspaces WHERE parent_id = ? AND deleted_at IS NULL",
                (old_id,),
            )
            child_rows = await child_cur.fetchall()
            for child_row in child_rows:
                queue.append(child_row[0])

        await db.commit()
        return id_map[ws_id]


# ── Database workspace copy ───────────────────────────────────────────────────

async def copy_db_workspace_to_user(ws_id: int, recipient_user_id: int) -> int:
    """Copy a database workspace + all its cards + card attrs.

    Returns the new workspace id.
    """
    async with get_db() as db:
        # Copy the workspace row
        cur = await db.execute(
            "SELECT name, emoji, sort_order FROM workspaces WHERE id = ?", (ws_id,)
        )
        row = await cur.fetchone()
        if not row:
            raise ValueError(f"Workspace {ws_id} not found")

        ins = await db.execute(
            """
            INSERT INTO workspaces (user_id, name, emoji, ws_type, sort_order, is_open, is_favorite)
            VALUES (?, ?, ?, 'database', ?, 0, 0)
            """,
            (recipient_user_id, row["name"], row["emoji"], row["sort_order"]),
        )
        new_ws_id = ins.lastrowid

        # Copy all cards
        card_cur = await db.execute(
            "SELECT id FROM db_cards WHERE db_id = ? ORDER BY sort_order", (ws_id,)
        )
        card_rows = await card_cur.fetchall()
        for card_row in card_rows:
            old_card_id = card_row[0]
            cc = await db.execute(
                """
                INSERT INTO db_cards
                    (db_id, user_id, title, cover_url, note_content, sort_order)
                SELECT ?, ?, title, cover_url, note_content, sort_order
                FROM db_cards WHERE id = ?
                """,
                (new_ws_id, recipient_user_id, old_card_id),
            )
            new_card_id = cc.lastrowid
            await db.execute(
                """
                INSERT INTO db_card_attrs
                    (card_id, attr_key, attr_value, attr_type, attr_options, sort_order, visibility)
                SELECT ?, attr_key, attr_value, attr_type, attr_options, sort_order, visibility
                FROM db_card_attrs WHERE card_id = ?
                """,
                (new_card_id, old_card_id),
            )

        await db.commit()
        return new_ws_id


# ── DB card copy ─────────────────────────────────────────────────────────────

async def copy_db_card_to_database(
    card_id: int, target_db_ws_id: int, recipient_user_id: int
) -> int:
    """Copy a single DB card + its attrs into a target database workspace.

    Returns the new card id.
    """
    async with get_db() as db:
        # Compute next sort_order for the target DB
        so_cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), -10) + 10 FROM db_cards WHERE db_id = ?",
            (target_db_ws_id,),
        )
        next_sort = (await so_cur.fetchone())[0]

        cc = await db.execute(
            """
            INSERT INTO db_cards
                (db_id, user_id, title, cover_url, note_content, sort_order)
            SELECT ?, ?, title, cover_url, note_content, ?
            FROM db_cards WHERE id = ?
            """,
            (target_db_ws_id, recipient_user_id, next_sort, card_id),
        )
        new_card_id = cc.lastrowid

        await db.execute(
            """
            INSERT INTO db_card_attrs
                (card_id, attr_key, attr_value, attr_type, attr_options, sort_order, visibility)
            SELECT ?, attr_key, attr_value, attr_type, attr_options, sort_order, visibility
            FROM db_card_attrs WHERE card_id = ?
            """,
            (new_card_id, card_id),
        )

        await db.commit()
        return new_card_id


# ── Public view fetchers (no user_id filter — token already validated) ────────

async def get_note_for_public_view(note_id: int) -> Optional[dict]:
    """Return a note snapshot for public viewing (no ownership check)."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, title, icon, content, meeting_date, created_at, updated_at
            FROM notes WHERE id = ?
            """,
            (note_id,),
        )
        row = await cur.fetchone()
        if not row:
            return None
        note = dict(row)

        # Fetch categories
        c_cur = await db.execute(
            """
            SELECT c.name, c.color FROM categories c
            JOIN note_categories nc ON nc.category_id = c.id
            WHERE nc.note_id = ?
            """,
            (note_id,),
        )
        note["categories"] = [dict(r) for r in await c_cur.fetchall()]

        # Fetch note attributes (key/value pairs)
        a_cur = await db.execute(
            """
            SELECT key, value FROM note_attributes
            WHERE note_id = ? AND value IS NOT NULL AND value != ''
            ORDER BY id
            """,
            (note_id,),
        )
        note["attributes"] = [dict(r) for r in await a_cur.fetchall()]
        return note


async def get_db_card_for_public_view(card_id: int) -> Optional[dict]:
    """Return a DB card snapshot for public viewing (no ownership check)."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT c.id, c.title, c.cover_url, c.note_content, c.created_at, c.updated_at,
                   a.id AS attr_id, a.attr_key, a.attr_value, a.attr_type,
                   a.attr_options, a.sort_order AS attr_sort, a.visibility
            FROM db_cards c
            LEFT JOIN db_card_attrs a ON a.card_id = c.id
            WHERE c.id = ?
            ORDER BY a.sort_order
            """,
            (card_id,),
        )
        rows = await cur.fetchall()
        if not rows:
            return None

        first = dict(rows[0])
        card = {
            "id":           first["id"],
            "title":        first["title"],
            "cover_url":    first["cover_url"],
            "note_content": first["note_content"],
            "created_at":   first["created_at"],
            "updated_at":   first["updated_at"],
            "attrs": [],
        }
        for r in rows:
            row_d = dict(r)
            if row_d["attr_id"] is None:
                continue
            vis = row_d.get("visibility") or "always"
            val = row_d["attr_value"] or ""
            # Respect visibility rules — always_hide attrs are always hidden;
            # hide_empty attrs are hidden when the value is blank.
            if vis == "always_hide":
                continue
            if vis == "hide_empty" and not val.strip():
                continue
            card["attrs"].append({
                "attr_key":     row_d["attr_key"],
                "attr_value":   val,
                "attr_type":    row_d["attr_type"],
                "attr_options": row_d["attr_options"],
            })
        return card


# ── Ownership helpers ────────────────────────────────────────────────────────

async def note_belongs_to_user(note_id: int, user_id: int) -> bool:
    """Return True if the note's workspace is owned by user_id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT 1 FROM notes n
            JOIN workspaces w ON w.id = n.workspace_id
            WHERE n.id = ? AND w.user_id = ?
            """,
            (note_id, user_id),
        )
        return (await cur.fetchone()) is not None


async def workspace_belongs_to_user(ws_id: int, user_id: int) -> bool:
    """Return True if the workspace is owned by user_id."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM workspaces WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (ws_id, user_id),
        )
        return (await cur.fetchone()) is not None


async def db_card_belongs_to_user(card_id: int, user_id: int) -> bool:
    """Return True if the DB card is owned by user_id."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM db_cards WHERE id = ? AND user_id = ?",
            (card_id, user_id),
        )
        return (await cur.fetchone()) is not None


async def get_workspace_type(ws_id: int) -> Optional[str]:
    """Return the ws_type of a workspace, or None if not found."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT ws_type FROM workspaces WHERE id = ? AND deleted_at IS NULL",
            (ws_id,),
        )
        row = await cur.fetchone()
        return row[0] if row else None
