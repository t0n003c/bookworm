"""Note CRUD + search/filter helpers."""
from pathlib import Path
from typing import Optional
from database import get_db


async def _fetch_note_categories(db, note_id: int) -> list[dict]:
    """Return category rows for a given note."""
    cursor = await db.execute(
        """
        SELECT c.id, c.name, c.color, c.description, c.created_at
        FROM categories c
        JOIN note_categories nc ON nc.category_id = c.id
        WHERE nc.note_id = ?
        """,
        (note_id,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def _fetch_note_attributes(db, note_id: int) -> list[dict]:
    """Return attribute rows for a given note."""
    cursor = await db.execute(
        "SELECT id, key, value, attr_def_id FROM note_attributes WHERE note_id = ?",
        (note_id,),
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def _fetch_note_attachments(db, note_id: int) -> list[dict]:
    """Return attachment rows for a given note."""
    cursor = await db.execute(
        """
        SELECT id, note_id, filename, original_name, mime_type, size, created_at
        FROM note_attachments WHERE note_id = ? ORDER BY created_at
        """,
        (note_id,),
    )
    return [dict(r) for r in await cursor.fetchall()]


async def get_note_by_id(note_id: int) -> Optional[dict]:
    """Fetch a single note with categories, attributes, and attachments."""
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, title, icon, content, meeting_date, created_at, updated_at, workspace_id FROM notes WHERE id = ?",
            (note_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        note = dict(row)
        note["categories"]   = await _fetch_note_categories(db, note_id)
        note["attributes"]   = await _fetch_note_attributes(db, note_id)
        note["attachments"]  = await _fetch_note_attachments(db, note_id)
        return note


# Allowlists — only these values ever touch SQL so injection is impossible.
# Dynamic attr_{id} tokens are handled separately in _build_order_clause.
_FIELD_MAP: dict[str, str] = {
    "date":     "n.meeting_date",
    "title":    "n.title",
    "created":  "n.created_at",
    "updated":  "n.updated_at",
    # Correlated subquery — picks the lexicographically first category name
    # for the note, NULLs sort last (uncategorised notes float to the bottom).
    "category": (
        "(SELECT MIN(c.name)"
        " FROM note_categories nc"
        " JOIN categories c ON c.id = nc.category_id"
        " WHERE nc.note_id = n.id)"
    ),
}
_VALID_DIRS = {"asc", "desc"}
_DEFAULT_SORT_BY = ["date:desc"]


def _build_order_clause(sort_by: list[str]) -> str:
    """Build a safe multi-column ORDER BY from a list of 'field:dir' tokens.

    Static fields are validated against _FIELD_MAP (allowlist).
    Dynamic attribute fields use the token format ``attr_{id}`` where ``id``
    must be a pure decimal integer — validated with str.isdigit() so no SQL
    injection is possible regardless of user input.

    Unknown / invalid tokens are silently skipped.  Duplicate fields are
    de-duplicated (first occurrence wins).  Falls back to date DESC when
    nothing valid remains.
    """
    seen: set[str] = set()
    clauses: list[str] = []
    for entry in sort_by:
        parts = entry.strip().split(":", 1)
        field     = parts[0].strip().lower()
        direction = (parts[1].strip().lower() if len(parts) > 1 else "desc")
        if direction not in _VALID_DIRS or field in seen:
            continue

        if field in _FIELD_MAP:
            col_expr = _FIELD_MAP[field]
        elif field.startswith("attr_") and field[5:].isdigit():
            # Safe: attr_id is validated as a non-negative integer literal.
            attr_id  = int(field[5:])
            col_expr = (
                f"(SELECT na.value FROM note_attributes na"
                f" WHERE na.note_id = n.id AND na.attr_def_id = {attr_id}"
                f" LIMIT 1)"
            )
        else:
            continue  # unknown field — skip silently

        seen.add(field)
        clauses.append(f"{col_expr} {direction.upper()}")

    return ", ".join(clauses) if clauses else f"{_FIELD_MAP['date']} DESC"


async def search_notes(
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_ids: Optional[list[int]] = None,
    workspace_id: Optional[int] = None,
    workspace_ids: Optional[list[int]] = None,
    sort_by: Optional[list[str]] = None,
) -> list[dict]:
    """Search and filter notes with multi-criteria sort.

    workspace_ids (list) takes precedence over workspace_id (single int).
    sort_by is a list of 'field:dir' tokens e.g. ['title:asc', 'date:desc'].
    Unknown / duplicate tokens are silently dropped; falls back to date DESC.
    """
    sql = """
        SELECT DISTINCT n.id, n.title, n.icon, n.content, n.meeting_date,
               n.created_at, n.updated_at, n.workspace_id
        FROM notes n
    """
    joins = []
    conditions = []
    params: list = []

    if category_ids:
        joins.append(
            "JOIN note_categories nc ON nc.note_id = n.id AND nc.category_id IN ({seq})".format(
                seq=",".join("?" * len(category_ids))
            )
        )
        params.extend(category_ids)

    # workspace_ids (subtree) takes priority over single workspace_id
    if workspace_ids is not None:
        if workspace_ids:
            placeholders = ",".join("?" * len(workspace_ids))
            conditions.append(f"n.workspace_id IN ({placeholders})")
            params.extend(workspace_ids)
        # empty list → impossible filter (no results) — intentional
    elif workspace_id is not None:
        conditions.append("n.workspace_id = ?")
        params.append(workspace_id)

    if q:
        conditions.append("(n.title LIKE ? OR n.content LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])

    if date_from:
        conditions.append("n.meeting_date >= ?")
        params.append(date_from)

    if date_to:
        conditions.append("n.meeting_date <= ?")
        params.append(date_to)

    if joins:
        sql += " " + " ".join(joins)
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += f" ORDER BY {_build_order_clause(sort_by or _DEFAULT_SORT_BY)}"

    async with get_db() as db:
        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()
        if not rows:
            return []
        notes = [dict(row) for row in rows]
        note_ids = [n["id"] for n in notes]
        ph = ",".join("?" * len(note_ids))

        # Bulk-fetch ALL categories for every note in one query, then stitch.
        # Replaces N per-note _fetch_note_categories() calls → 1 query total.
        cat_cur = await db.execute(
            f"""SELECT nc.note_id, c.id, c.name, c.color, c.description, c.created_at
                FROM note_categories nc
                JOIN categories c ON c.id = nc.category_id
                WHERE nc.note_id IN ({ph})""",
            note_ids,
        )
        cat_map: dict[int, list] = {}
        for r in await cat_cur.fetchall():
            r = dict(r)
            nid = r.pop("note_id")
            cat_map.setdefault(nid, []).append(r)

        # Bulk-fetch ALL attributes in one query, then stitch.
        # Replaces N per-note _fetch_note_attributes() calls → 1 query total.
        attr_cur = await db.execute(
            f"SELECT note_id, id, key, value, attr_def_id"
            f" FROM note_attributes WHERE note_id IN ({ph})",
            note_ids,
        )
        attr_map: dict[int, list] = {}
        for r in await attr_cur.fetchall():
            r = dict(r)
            nid = r.pop("note_id")
            attr_map.setdefault(nid, []).append(r)

        for note in notes:
            note["categories"] = cat_map.get(note["id"], [])
            note["attributes"] = attr_map.get(note["id"], [])
        return notes


async def create_note(
    title: str,
    content: Optional[str],
    meeting_date: str,
    category_ids: list[int],
    attributes: list[dict],
    workspace_id: Optional[int] = None,
    icon: Optional[str] = None,
) -> int:
    """Insert a note, its categories and attributes. Returns new note id.

    Title is auto-suffixed '(2)', '(3)' … when another note in the same
    workspace already has the same title (case-insensitive).
    """
    async with get_db() as db:
        # Uniqueness check within the same workspace.
        if workspace_id is not None:
            cur = await db.execute(
                "SELECT title FROM notes WHERE workspace_id = ?", (workspace_id,)
            )
            taken = {r[0].strip().lower() for r in await cur.fetchall()}
            candidate = title.strip()
            if candidate.lower() in taken:
                n = 2
                while f"{candidate} ({n})".lower() in taken:
                    n += 1
                title = f"{candidate} ({n})"
            else:
                title = candidate
        cursor = await db.execute(
            "INSERT INTO notes (title, icon, content, meeting_date, workspace_id) VALUES (?, ?, ?, ?, ?)",
            (title, icon or None, content, meeting_date, workspace_id),
        )
        note_id = cursor.lastrowid
        await _sync_categories(db, note_id, category_ids)
        await _sync_attributes(db, note_id, attributes)
        await db.commit()
        return note_id


async def update_note(
    note_id: int,
    title: str,
    content: Optional[str],
    meeting_date: str,
    category_ids: list[int],
    attributes: list[dict],
    icon: Optional[str] = None,
) -> bool:
    """Update an existing note. Returns False if not found."""
    async with get_db() as db:
        cursor = await db.execute(
            "UPDATE notes SET title=?, icon=?, content=?, meeting_date=? WHERE id=?",
            (title, icon or None, content, meeting_date, note_id),
        )
        if cursor.rowcount == 0:
            return False
        await _sync_categories(db, note_id, category_ids)
        await _sync_attributes(db, note_id, attributes)
        await db.commit()
        return True


async def patch_note_content(note_id: int, content: str) -> bool:
    """Update only the content field of a note. Returns False if not found."""
    async with get_db() as db:
        cursor = await db.execute(
            "UPDATE notes SET content=? WHERE id=?",
            (content, note_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def delete_note(note_id: int) -> bool:
    """Delete a note by id; also purge attached files from disk."""
    from routers.attachments_db import UPLOAD_DIR  # local import avoids circularity
    async with get_db() as db:
        # Collect filenames before cascade-delete wipes them
        cur = await db.execute(
            "SELECT filename FROM note_attachments WHERE note_id = ?", (note_id,)
        )
        filenames = [r[0] for r in await cur.fetchall()]
        cursor = await db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        await db.commit()
    # Clean up orphaned files after the transaction commits
    for fname in filenames:
        p = UPLOAD_DIR / fname
        if p.exists():
            p.unlink(missing_ok=True)
    return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

async def _sync_categories(db, note_id: int, category_ids: list[int]) -> None:
    await db.execute("DELETE FROM note_categories WHERE note_id = ?", (note_id,))
    for cat_id in category_ids:
        await db.execute(
            "INSERT OR IGNORE INTO note_categories (note_id, category_id) VALUES (?, ?)",
            (note_id, cat_id),
        )


async def _sync_attributes(db, note_id: int, attributes: list[dict]) -> None:
    await db.execute("DELETE FROM note_attributes WHERE note_id = ?", (note_id,))
    for attr in attributes:
        key = attr.get("key", "").strip()
        value = attr.get("value", "")
        if not key:
            continue
        await db.execute(
            "INSERT INTO note_attributes (note_id, key, value, attr_def_id) VALUES (?, ?, ?, ?)",
            (note_id, key, value, attr.get("attr_def_id")),
        )
