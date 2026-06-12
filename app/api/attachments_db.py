"""Attachment DB helpers — CRUD for note_attachments table."""
import os
from pathlib import Path
from typing import Optional

from database import get_db
from core.config import settings

# Mirror BW_DATA_DIR so uploads land in the same volume as the DB.
_DATA_DIR  = settings.data_dir
UPLOAD_DIR = _DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def create_attachment(
    note_id: int,
    filename: str,
    original_name: str,
    mime_type: str,
    size: int,
) -> int:
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO note_attachments (note_id, filename, original_name, mime_type, size)
            VALUES (?, ?, ?, ?, ?)
            """,
            (note_id, filename, original_name, mime_type, size),
        )
        await db.commit()
        return cur.lastrowid


async def get_attachments_for_note(note_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, note_id, filename, original_name, mime_type, size, created_at
            FROM note_attachments WHERE note_id = ? ORDER BY created_at
            """,
            (note_id,),
        )
        return [dict(r) for r in await cur.fetchall()]


async def get_attachment_by_id(attachment_id: int) -> Optional[dict]:
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, note_id, filename, original_name, mime_type, size, created_at
            FROM note_attachments WHERE id = ?
            """,
            (attachment_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def delete_attachment_record(attachment_id: int) -> Optional[str]:
    """Delete DB row; return stored filename for disk cleanup, or None if not found.

    Also removes any page_upload_tags rows for this attachment so tag filter
    pills don't show ghost tags after the file is gone.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM note_attachments WHERE id = ?", (attachment_id,)
        )
        row = await cur.fetchone()
        if not row:
            return None
        await db.execute("DELETE FROM note_attachments WHERE id = ?", (attachment_id,))
        # Clean up any tags applied to this attachment — no FK cascade covers this.
        await db.execute(
            "DELETE FROM page_upload_tags WHERE upload_src = 'note' AND upload_id = ?",
            (attachment_id,),
        )
        await db.commit()
        return row[0]


async def get_filenames_for_note(note_id: int) -> list[str]:
    """Return stored filenames for a note — used to clean disk when note is deleted."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM note_attachments WHERE note_id = ?", (note_id,)
        )
        return [r[0] for r in await cur.fetchall()]


async def get_upload_owner(filename: str) -> Optional[int]:
    """Return the user_id who owns *filename*, or None if not found in either table.

    Checks both upload stores in priority order:
      1. page_uploads  — direct user_id column (fastest path).
      2. note_attachments — resolved via notes → workspaces → user_id.
    """
    async with get_db() as db:
        # Direct ownership via page_uploads
        cur = await db.execute(
            "SELECT user_id FROM page_uploads WHERE filename = ?",
            (filename,),
        )
        row = await cur.fetchone()
        if row:
            return row[0]

        # Indirect ownership via note_attachments → notes → workspaces
        cur = await db.execute(
            """
            SELECT w.user_id
            FROM note_attachments na
            JOIN notes n ON n.id = na.note_id
            JOIN workspaces w ON w.id = n.workspace_id
            WHERE na.filename = ?
            """,
            (filename,),
        )
        row = await cur.fetchone()
        return row[0] if row else None