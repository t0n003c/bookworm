"""Attachment DB helpers — CRUD for note_attachments table."""
import os
from pathlib import Path
from typing import Optional

from database import get_db

# Mirror BW_DATA_DIR so uploads land in the same volume as the DB.
_DATA_DIR  = Path(os.getenv("BW_DATA_DIR", "."))
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
    """Delete DB row; return stored filename for disk cleanup, or None if not found."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM note_attachments WHERE id = ?", (attachment_id,)
        )
        row = await cur.fetchone()
        if not row:
            return None
        await db.execute("DELETE FROM note_attachments WHERE id = ?", (attachment_id,))
        await db.commit()
        return row[0]


async def get_filenames_for_note(note_id: int) -> list[str]:
    """Return stored filenames for a note — used to clean disk when note is deleted."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM note_attachments WHERE note_id = ?", (note_id,)
        )
        return [r[0] for r in await cur.fetchall()]