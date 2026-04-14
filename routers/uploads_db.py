"""DB helpers for the Uploads Homespace page.

Two data sources are merged:
  1. note_attachments  — files attached to notes (scoped via workspaces → user)
  2. page_uploads      — standalone files dropped directly on an Uploads page

All functions use get_db() — never raw aiosqlite.connect().
"""
from typing import Optional
from database import get_db

_PAGE_SIZE = 50  # files per page


async def get_uploads_page(user_id: int, page: int = 1) -> dict:
    """Return one page of the merged file list for a user.

    Returns:
        {
            "files":  [list of file dicts],
            "total":  int,   # total files across both tables
            "page":   int,   # current page (1-based)
            "pages":  int,   # total pages
        }

    Each file dict has:
        id, src ("note" | "page"), filename, original_name,
        mime_type, size, created_at,
        note_id?, note_title?, workspace_name?,   # note-attached only
        page_id?                                   # standalone only
    """
    offset = (max(page, 1) - 1) * _PAGE_SIZE

    async with get_db() as db:
        # ── Total count ───────────────────────────────────────────────────────
        count_sql = """
            SELECT COUNT(*) FROM (
                SELECT na.id
                FROM note_attachments na
                JOIN notes      n ON n.id  = na.note_id
                JOIN workspaces w ON w.id  = n.workspace_id
                WHERE w.user_id = ? AND w.deleted_at IS NULL
              UNION ALL
                SELECT pu.id
                FROM page_uploads pu
                WHERE pu.user_id = ?
            )
        """
        cur = await db.execute(count_sql, (user_id, user_id))
        total = (await cur.fetchone())[0]

        # ── Paginated merged rows ─────────────────────────────────────────────
        rows_sql = """
            SELECT
                na.id           AS id,
                'note'          AS src,
                na.filename     AS filename,
                na.original_name AS original_name,
                na.mime_type    AS mime_type,
                na.size         AS size,
                na.created_at   AS created_at,
                na.note_id      AS note_id,
                n.title         AS note_title,
                w.name          AS workspace_name,
                NULL            AS page_id
            FROM note_attachments na
            JOIN notes      n ON n.id  = na.note_id
            JOIN workspaces w ON w.id  = n.workspace_id
            WHERE w.user_id = ? AND w.deleted_at IS NULL

            UNION ALL

            SELECT
                pu.id           AS id,
                'page'          AS src,
                pu.filename     AS filename,
                pu.original_name AS original_name,
                pu.mime_type    AS mime_type,
                pu.size         AS size,
                pu.created_at   AS created_at,
                NULL            AS note_id,
                NULL            AS note_title,
                NULL            AS workspace_name,
                pu.page_id      AS page_id
            FROM page_uploads pu
            WHERE pu.user_id = ?

            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        cur = await db.execute(rows_sql, (user_id, user_id, _PAGE_SIZE, offset))
        files = [dict(r) for r in await cur.fetchall()]

    pages = max(1, -(-total // _PAGE_SIZE))  # ceiling div
    return {"files": files, "total": total, "page": page, "pages": pages}


async def create_page_upload(
    page_id: int,
    user_id: int,
    filename: str,
    original_name: str,
    mime_type: str,
    size: int,
) -> int:
    """Insert a standalone upload record; return its new id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO page_uploads
                (page_id, user_id, filename, original_name, mime_type, size)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (page_id, user_id, filename, original_name, mime_type, size),
        )
        await db.commit()
        return cur.lastrowid


async def get_note_attachment_owned(att_id: int, user_id: int) -> Optional[dict]:
    """Return a note_attachments row only if it's owned by user_id; else None."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT na.id, na.filename, na.original_name, na.mime_type, na.size
            FROM note_attachments na
            JOIN notes      n ON n.id = na.note_id
            JOIN workspaces w ON w.id = n.workspace_id
            WHERE na.id = ? AND w.user_id = ? AND w.deleted_at IS NULL
            """,
            (att_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_page_upload_owned(upload_id: int, user_id: int) -> Optional[dict]:
    """Return a page_uploads row only if it's owned by user_id; else None."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, filename, original_name, mime_type, size
            FROM page_uploads
            WHERE id = ? AND user_id = ?
            """,
            (upload_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None
