"""DB helpers for the Uploads Homespace page.

Two data sources are merged:
  1. note_attachments  — files attached to notes (scoped via workspaces → user)
  2. page_uploads      — standalone files dropped directly on an Uploads page

Tags are stored in page_upload_tags(upload_src, upload_id, user_id, tag) and
embedded in the list response via GROUP_CONCAT (Option A — enables grid-level filtering).

MIME-group CASE expression in get_file_counts() mirrors _uplMimeGroup() in JS.
Keep them in sync if MIME grouping rules ever change.

All functions use get_db() — never raw aiosqlite.connect().
"""
from typing import Optional
from database import get_db

_PAGE_SIZE = 50  # files per page

# ── Paginated merged file list ────────────────────────────────────────────────

async def get_uploads_page(user_id: int, page: int = 1) -> dict:
    """Return one page of the merged file list for a user, with tags embedded.

    Returns:
        {
            "files":  [list of file dicts],
            "total":  int,
            "page":   int,
            "pages":  int,
            "counts": {"all": N, "image": N, "video": N, "audio": N,
                       "document": N, "other": N},
        }

    Each file dict:
        id, src, filename, original_name, mime_type, size, created_at,
        tags (list[str]),
        note_id?, note_title?, workspace_id?, workspace_name?,  # note-src
        page_id?                                                  # page-src
    """
    offset = (max(page, 1) - 1) * _PAGE_SIZE

    async with get_db() as db:
        # ── Total count ───────────────────────────────────────────────────────
        cur = await db.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT na.id FROM note_attachments na
                JOIN notes      n ON n.id = na.note_id
                JOIN workspaces w ON w.id = n.workspace_id
                WHERE w.user_id = ? AND w.deleted_at IS NULL
              UNION ALL
                SELECT id FROM page_uploads WHERE user_id = ?
            )
            """,
            (user_id, user_id),
        )
        total = (await cur.fetchone())[0]

        # ── Paginated merged rows (tags via GROUP_CONCAT) ─────────────────────
        cur = await db.execute(
            """
            SELECT
                na.id               AS id,
                'note'              AS src,
                na.filename         AS filename,
                na.original_name    AS original_name,
                na.mime_type        AS mime_type,
                na.size             AS size,
                na.created_at       AS created_at,
                na.note_id          AS note_id,
                n.title             AS note_title,
                w.id                AS workspace_id,
                w.name              AS workspace_name,
                NULL                AS page_id,
                GROUP_CONCAT(t.tag) AS tags
            FROM note_attachments na
            JOIN notes      n ON n.id  = na.note_id
            JOIN workspaces w ON w.id  = n.workspace_id
            LEFT JOIN page_upload_tags t
                   ON t.upload_src = 'note' AND t.upload_id = na.id
                  AND t.user_id = ?
            WHERE w.user_id = ? AND w.deleted_at IS NULL
            GROUP BY na.id

            UNION ALL

            SELECT
                pu.id               AS id,
                'page'              AS src,
                pu.filename         AS filename,
                pu.original_name    AS original_name,
                pu.mime_type        AS mime_type,
                pu.size             AS size,
                pu.created_at       AS created_at,
                NULL                AS note_id,
                NULL                AS note_title,
                NULL                AS workspace_id,
                NULL                AS workspace_name,
                pu.page_id          AS page_id,
                GROUP_CONCAT(t.tag) AS tags
            FROM page_uploads pu
            LEFT JOIN page_upload_tags t
                   ON t.upload_src = 'page' AND t.upload_id = pu.id
                  AND t.user_id = ?
            WHERE pu.user_id = ?
            GROUP BY pu.id

            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, user_id, user_id, user_id, _PAGE_SIZE, offset),
        )
        rows = await cur.fetchall()

    files = []
    for r in rows:
        d = dict(r)
        raw_tags = d.pop("tags", None)
        d["tags"] = sorted(raw_tags.split(",")) if raw_tags else []
        files.append(d)

    counts = await get_file_counts(user_id)
    pages  = max(1, -(-total // _PAGE_SIZE))  # ceiling div
    return {"files": files, "total": total, "page": page, "pages": pages,
            "counts": counts}


# ── Global MIME-group counts ──────────────────────────────────────────────────

async def get_file_counts(user_id: int) -> dict:
    """Return total file counts by MIME group across the entire dataset.

    NOTE: The CASE expression here mirrors _uplMimeGroup() in home-page-uploads.js.
          Keep them in sync if MIME grouping rules ever change.
    """
    _CASE = """
        CASE
          WHEN mime_type LIKE 'image/%'                                   THEN 'image'
          WHEN mime_type LIKE 'video/%'                                   THEN 'video'
          WHEN mime_type LIKE 'audio/%'                                   THEN 'audio'
          WHEN mime_type LIKE 'text/%' OR mime_type LIKE 'application/%' THEN 'document'
          ELSE 'other'
        END
    """
    async with get_db() as db:
        cur = await db.execute(
            f"""
            SELECT {_CASE} AS grp, COUNT(*) AS cnt
            FROM (
                SELECT na.mime_type
                FROM note_attachments na
                JOIN notes      n ON n.id = na.note_id
                JOIN workspaces w ON w.id = n.workspace_id
                WHERE w.user_id = ? AND w.deleted_at IS NULL
              UNION ALL
                SELECT mime_type FROM page_uploads WHERE user_id = ?
            )
            GROUP BY grp
            """,
            (user_id, user_id),
        )
        rows = await cur.fetchall()

    counts = {"image": 0, "video": 0, "audio": 0, "document": 0, "other": 0}
    total  = 0
    for r in rows:
        counts[r["grp"]] = r["cnt"]
        total += r["cnt"]
    counts["all"] = total
    return counts


# ── Standalone file CRUD ──────────────────────────────────────────────────────

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


async def delete_page_upload(upload_id: int, user_id: int) -> Optional[str]:
    """Delete the page_uploads row owned by user_id.

    Returns the stored filename for disk cleanup, or None if not found/not owned.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT filename FROM page_uploads WHERE id = ? AND user_id = ?",
            (upload_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            return None
        await db.execute(
            "DELETE FROM page_upload_tags WHERE upload_src = 'page' AND upload_id = ?",
            (upload_id,),
        )
        await db.execute(
            "DELETE FROM page_uploads WHERE id = ? AND user_id = ?",
            (upload_id, user_id),
        )
        await db.commit()
        return row["filename"]


# ── Ownership checks (download endpoints) ─────────────────────────────────────

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
            "SELECT id, filename, original_name, mime_type, size "
            "FROM page_uploads WHERE id = ? AND user_id = ?",
            (upload_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


# ── Tag CRUD ──────────────────────────────────────────────────────────────────

async def get_tags_for_file(
    upload_src: str, upload_id: int, user_id: int
) -> list:
    """Return sorted tag list for a specific file."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT tag FROM page_upload_tags "
            "WHERE upload_src = ? AND upload_id = ? AND user_id = ? ORDER BY tag",
            (upload_src, upload_id, user_id),
        )
        return [r["tag"] for r in await cur.fetchall()]


async def add_tag_to_file(
    upload_src: str, upload_id: int, user_id: int, tag: str
) -> list:
    """Add a tag (INSERT OR IGNORE); return updated tag list."""
    async with get_db() as db:
        await db.execute(
            "INSERT OR IGNORE INTO page_upload_tags "
            "(upload_src, upload_id, user_id, tag) VALUES (?, ?, ?, ?)",
            (upload_src, upload_id, user_id, tag),
        )
        await db.commit()
    return await get_tags_for_file(upload_src, upload_id, user_id)


async def remove_tag_from_file(
    upload_src: str, upload_id: int, user_id: int, tag: str
) -> list:
    """Remove a tag; return updated tag list."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM page_upload_tags "
            "WHERE upload_src = ? AND upload_id = ? AND user_id = ? AND tag = ?",
            (upload_src, upload_id, user_id, tag),
        )
        await db.commit()
    return await get_tags_for_file(upload_src, upload_id, user_id)


async def get_all_user_tags(user_id: int) -> list:
    """Return all distinct tags this user has applied across all files."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT DISTINCT tag FROM page_upload_tags WHERE user_id = ? ORDER BY tag",
            (user_id,),
        )
        return [r["tag"] for r in await cur.fetchall()]
