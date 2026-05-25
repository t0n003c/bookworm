"""DB helpers for the Uploads Homespace page.

Two data sources are merged:
  1. note_attachments  — files attached to notes (scoped via workspaces → user)
  2. page_uploads      — standalone files dropped directly on an Uploads page

Tags are stored in page_upload_tags(upload_src, upload_id, user_id, tag) and
embedded in the list response via GROUP_CONCAT (Option A — enables grid-level filtering).

MIME-group CASE expression in get_uploads_page() mirrors _uplMimeGroup() in JS.
Keep them in sync if MIME grouping rules ever change.

All functions use get_db() — never raw aiosqlite.connect().
"""
from typing import Optional
import json
from database import get_db

_PAGE_SIZE = 50  # files per page

# ── Paginated merged file list ────────────────────────────────────────────────

async def get_uploads_page(
    user_id: int,
    page: int = 1,
    folder_id: Optional[int] = None,   # None=all, 0=unfiled page-src, >0=folder
    catalog_id: Optional[int] = None,  # filter by catalog (many-to-many, page-src only)
    src_page_id: Optional[int] = None, # Grid picker: scope to a single uploads page
) -> dict:
    """Return one page of the merged file list for a user, with tags embedded.

    When folder_id is not None the result is scoped to page-src files only:
      folder_id == 0  → page-src files with no folder assigned (unfiled)
      folder_id  > 0  → page-src files assigned to that folder
    When src_page_id is not None the result is scoped to that uploads page only
      (note-attachments union leg is skipped entirely).

    Returns:
        {
            "files":  [list of file dicts],
            "total":  int,
            "page":   int,
            "pages":  int,
            "counts": {"all": N, "image": N, "video": N, "audio": N,
                       "document": N, "other": N},
        }
    """
    offset = (max(page, 1) - 1) * _PAGE_SIZE

    # Build folder WHERE clause for page-src subqueries
    if folder_id is None:
        folder_where = ""
        folder_params: tuple = ()
    elif folder_id == 0:
        folder_where = " AND pu.folder_id IS NULL"
        folder_params = ()
    else:
        folder_where = " AND pu.folder_id = ?"
        folder_params = (folder_id,)

    # Catalog filter overrides folder filter; suppresses the note-src UNION leg
    catalog_join: str = ""
    catalog_join_params: tuple = ()
    if catalog_id is not None:
        catalog_join = (
            " INNER JOIN upload_catalog_files ucf"
            " ON pu.id = ucf.upload_id AND ucf.catalog_id = ?"
        )
        catalog_join_params = (catalog_id,)
        folder_where = ""   # catalog takes priority; clear any folder filter
        folder_params = ()

    use_union = folder_id is None and catalog_id is None and src_page_id is None

    # src_page_id: scope to one specific uploads page — disables union and folder/catalog
    if src_page_id is not None:
        folder_where  = " AND pu.page_id = ?"
        folder_params = (src_page_id,)
        catalog_join  = ""
        catalog_join_params = ()

    async with get_db() as db:
        # ── Total count ───────────────────────────────────────────────────────
        if use_union:
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
        else:
            cur = await db.execute(
                "SELECT COUNT(*) FROM page_uploads pu "
                + catalog_join
                + " WHERE pu.user_id = ?" + folder_where,
                (*catalog_join_params, user_id, *folder_params),
            )
        total = (await cur.fetchone())[0]

        # ── Paginated merged rows (tags via GROUP_CONCAT) ─────────────────────
        if use_union:
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
                    NULL                AS folder_id,
                    NULL                AS db_card_id,
                    NULL                AS db_card_title,
                    NULL                AS db_card_ws_name,
                    NULL                AS db_card_ws_id,
                    NULL                AS db_card_attr_id,
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
                    pu.folder_id        AS folder_id,
                    COALESCE(dc_cover.id,     dc_attr.id)     AS db_card_id,
                    COALESCE(dc_cover.title,  dc_attr.title)  AS db_card_title,
                    COALESCE(dbws_cover.name, dbws_attr.name) AS db_card_ws_name,
                    COALESCE(dbws_cover.id,   dbws_attr.id)   AS db_card_ws_id,
                    pu.db_card_attr_id                        AS db_card_attr_id,
                    GROUP_CONCAT(t.tag) AS tags
                FROM page_uploads pu
                LEFT JOIN db_cards dc_cover ON dc_cover.cover_upload_id = pu.id
                LEFT JOIN db_cards dc_attr  ON dc_attr.id = pu.db_card_id
                                           AND pu.db_card_attr_id IS NOT NULL
                LEFT JOIN workspaces dbws_cover ON dbws_cover.id = dc_cover.db_id
                LEFT JOIN workspaces dbws_attr  ON dbws_attr.id  = dc_attr.db_id
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
        else:
            cur = await db.execute(
                """
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
                    pu.folder_id        AS folder_id,
                    COALESCE(dc_cover.id,     dc_attr.id)     AS db_card_id,
                    COALESCE(dc_cover.title,  dc_attr.title)  AS db_card_title,
                    COALESCE(dbws_cover.name, dbws_attr.name) AS db_card_ws_name,
                    COALESCE(dbws_cover.id,   dbws_attr.id)   AS db_card_ws_id,
                    pu.db_card_attr_id                        AS db_card_attr_id,
                    GROUP_CONCAT(t.tag) AS tags
                FROM page_uploads pu
                """ + catalog_join + """
                LEFT JOIN db_cards dc_cover ON dc_cover.cover_upload_id = pu.id
                LEFT JOIN db_cards dc_attr  ON dc_attr.id = pu.db_card_id
                                           AND pu.db_card_attr_id IS NOT NULL
                LEFT JOIN workspaces dbws_cover ON dbws_cover.id = dc_cover.db_id
                LEFT JOIN workspaces dbws_attr  ON dbws_attr.id  = dc_attr.db_id
                LEFT JOIN page_upload_tags t
                       ON t.upload_src = 'page' AND t.upload_id = pu.id
                      AND t.user_id = ?
                WHERE pu.user_id = ?""" + folder_where + """
                GROUP BY pu.id
                ORDER BY pu.created_at DESC
                LIMIT ? OFFSET ?
                """,
                (*catalog_join_params, user_id, user_id, *folder_params, _PAGE_SIZE, offset),
            )
        rows = await cur.fetchall()

        # ── MIME-group counts ─────────────────────────────────────────────────
        _CASE = """
            CASE
              WHEN mime_type LIKE 'image/%'                                   THEN 'image'
              WHEN mime_type LIKE 'video/%'                                   THEN 'video'
              WHEN mime_type LIKE 'audio/%'                                   THEN 'audio'
              WHEN mime_type LIKE 'text/%' OR mime_type LIKE 'application/%' THEN 'document'
              ELSE 'other'
            END
        """
        if use_union:
            ccur = await db.execute(
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
        else:
            ccur = await db.execute(
                f"SELECT {_CASE} AS grp, COUNT(*) AS cnt "
                "FROM page_uploads pu "
                + catalog_join
                + " WHERE pu.user_id = ?" + folder_where + " GROUP BY grp",
                (*catalog_join_params, user_id, *folder_params),
            )
        count_rows = await ccur.fetchall()

    files = []
    for r in rows:
        d = dict(r)
        raw_tags = d.pop("tags", None)
        d["tags"] = sorted(raw_tags.split(",")) if raw_tags else []
        files.append(d)

    counts: dict = {"image": 0, "video": 0, "audio": 0, "document": 0, "other": 0}
    for r in count_rows:
        counts[r["grp"]] = r["cnt"]
    counts["all"] = sum(counts.values())

    pages  = max(1, -(-total // _PAGE_SIZE))  # ceiling div
    return {"files": files, "total": total, "page": page, "pages": pages,
            "counts": counts}


# ── Standalone file CRUD ──────────────────────────────────────────────────────

async def create_page_upload(
    page_id: int,
    user_id: int,
    filename: str,
    original_name: str,
    mime_type: str,
    size: int,
    db_card_id: Optional[int] = None,
    db_card_attr_id: Optional[int] = None,
) -> int:
    """Insert a standalone upload record; return its new id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO page_uploads
                (page_id, user_id, filename, original_name, mime_type, size,
                 db_card_id, db_card_attr_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (page_id, user_id, filename, original_name, mime_type, size,
             db_card_id, db_card_attr_id),
        )
        await db.commit()
        return cur.lastrowid


async def delete_page_upload(upload_id: int, user_id: int) -> Optional[str]:
    """Delete the page_uploads row owned by user_id.

    Also removes any grid cells that reference this upload, so the grid page
    does not show a blank / broken cell after the file is gone.
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
        # Remove grid cells that pin this file (prevents blank cells on grid pages)
        await db.execute(
            "DELETE FROM home_grid_cells WHERE upload_id = ?",
            (upload_id,),
        )
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


async def get_page_uploads_by_ids(ids: list, user_id: int) -> list:
    """Fetch specific page_uploads rows by ID, scoped to user ownership.

    Returns only page-src files (note attachments excluded — v1 scope).
    Rows are returned in the same order as *ids*.
    Returns [] immediately when ids is empty.
    """
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT id, filename, original_name, mime_type, size "
            f"FROM page_uploads "
            f"WHERE id IN ({placeholders}) AND user_id = ?",
            (*ids, user_id),
        )
        rows = {r["id"]: dict(r) for r in await cur.fetchall()}
    # Preserve caller's ordering; silently drop IDs that don't exist or aren't owned.
    return [rows[i] for i in ids if i in rows]


async def get_all_user_tags(user_id: int) -> list:
    """Return all distinct tags this user has applied across all files."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT DISTINCT tag FROM page_upload_tags WHERE user_id = ? ORDER BY tag",
            (user_id,),
        )
        return [r["tag"] for r in await cur.fetchall()]


async def get_union_tags_for_files(
    refs: list[dict], user_id: int
) -> dict:
    """Return union of tags for a batch of files, split into regular tags
    and grid page IDs.  Always reads live from the DB — no local-state issues.

    refs: [{"src": "page"|"note", "id": int}, ...]
    returns: {"tags": [sorted str list], "grid_pids": [sorted int list]}
    """
    if not refs:
        return {"tags": [], "grid_pids": []}

    # Build a (upload_src = ? AND upload_id = ?) OR ... clause
    or_clause = " OR ".join(
        "(upload_src = ? AND upload_id = ?)" for _ in refs
    )
    params: list = [user_id]
    for r in refs:
        params.extend([r["src"], r["id"]])

    async with get_db() as db:
        cur = await db.execute(
            f"SELECT DISTINCT tag FROM page_upload_tags "
            f"WHERE user_id = ? AND ({or_clause}) ORDER BY tag",
            params,
        )
        rows = await cur.fetchall()

    tags: list[str] = []
    grid_pids: list[int] = []
    for row in rows:
        t = row["tag"]
        if t.startswith("grid:"):
            try:
                grid_pids.append(int(t.split(":", 1)[1]))
            except (IndexError, ValueError):
                pass
        else:
            tags.append(t)
    return {"tags": sorted(set(tags)), "grid_pids": sorted(set(grid_pids))}


async def remove_upload_from_card_attr(upload_id: int, user_id: int) -> None:
    """When a page_uploads row that is linked to a card attr is deleted,
    patch the attr_value JSON to remove the matching entry.

    No-ops silently if the upload is not attr-linked or the attr is gone.
    Called by the Uploads-page delete endpoint BEFORE delete_page_upload.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT db_card_id, db_card_attr_id FROM page_uploads "
            "WHERE id = ? AND user_id = ?",
            (upload_id, user_id),
        )
        row = await cur.fetchone()
        if not row or row["db_card_id"] is None or row["db_card_attr_id"] is None:
            return
        attr_id = row["db_card_attr_id"]
        cur2 = await db.execute(
            "SELECT attr_value FROM db_card_attrs WHERE id = ?",
            (attr_id,),
        )
        attr_row = await cur2.fetchone()
        if not attr_row:
            return
        try:
            entries = json.loads(attr_row["attr_value"] or "[]")
        except (ValueError, TypeError):
            return
        if not isinstance(entries, list):
            return
        updated = [e for e in entries if e.get("upload_id") != upload_id]
        await db.execute(
            "UPDATE db_card_attrs SET attr_value = ? WHERE id = ?",
            (json.dumps(updated), attr_id),
        )
        await db.commit()
