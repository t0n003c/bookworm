"""Database helpers for Home Pages + Widgets."""
import json

from database import get_db


# ── Home Pages ────────────────────────────────────────────────────────────────

async def get_home_pages(user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_pages WHERE user_id=? AND deleted_at IS NULL ORDER BY sort_order,id",
            (user_id,),
        )
        rows = []
        for r in await cur.fetchall():
            p = dict(r)
            try:
                p["config"] = json.loads(p.get("config_json") or "{}")
            except Exception:
                p["config"] = {}
            rows.append(p)
        return rows


async def get_home_page(page_id: int, user_id: int) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_pages WHERE id=? AND user_id=? AND deleted_at IS NULL", (page_id, user_id)
        )
        row = await cur.fetchone()
        if not row:
            return None
        p = dict(row)
        try:
            p["config"] = json.loads(p.get("config_json") or "{}")
        except Exception:
            p["config"] = {}
        return p


# Valid page types — kept here so router + db stay in sync.
PAGE_TYPES = frozenset({"dashboard", "crm", "media", "grid_builder", "uploads", "rss", "grid", "subscriptions", "trip", "ai_dashboard"})


async def create_home_page(
    user_id: int, name: str, emoji: str = "🏠", page_type: str = "dashboard"
) -> int:
    page_type = page_type if page_type in PAGE_TYPES else "dashboard"
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM home_pages WHERE user_id=?",
            (user_id,),
        )
        row = await cur.fetchone()
        sort = row[0] if row else 1
        cur = await db.execute(
            "INSERT INTO home_pages(user_id,name,emoji,sort_order,page_type) VALUES(?,?,?,?,?)",
            (user_id, name.strip() or "My Page", emoji, sort, page_type),
        )
        await db.commit()
        return cur.lastrowid


async def rename_home_page(page_id: int, user_id: int, name: str, emoji: str) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE home_pages SET name=?,emoji=? WHERE id=? AND user_id=?",
            (name.strip() or "My Page", emoji, page_id, user_id),
        )
        await db.commit()


async def update_page_config(page_id: int, user_id: int, config: dict) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE home_pages SET config_json=? WHERE id=? AND user_id=?",
            (json.dumps(config), page_id, user_id),
        )
        await db.commit()


async def delete_home_page(page_id: int, user_id: int) -> None:
    """Soft-delete: stamp deleted_at. Page moves to trash, not hard-deleted."""
    async with get_db() as db:
        await db.execute(
            "UPDATE home_pages SET deleted_at=datetime('now') WHERE id=? AND user_id=? AND deleted_at IS NULL",
            (page_id, user_id),
        )
        await db.commit()


async def restore_home_page(page_id: int, user_id: int) -> None:
    """Clear deleted_at so the page reappears in the active sidebar."""
    async with get_db() as db:
        await db.execute(
            "UPDATE home_pages SET deleted_at=NULL WHERE id=? AND user_id=? AND deleted_at IS NOT NULL",
            (page_id, user_id),
        )
        await db.commit()


async def get_trashed_home_pages(user_id: int) -> list[dict]:
    """Return pages in trash (deleted_at IS NOT NULL), newest-deleted first, with days_remaining."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, name, emoji, page_type, deleted_at,"
            " MAX(0, 30 - CAST((julianday('now') - julianday(deleted_at)) AS INTEGER)) AS days_remaining"
            " FROM home_pages"
            " WHERE user_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
            (user_id,),
        )
        return [dict(r) for r in await cur.fetchall()]


async def permanent_delete_home_page(page_id: int, user_id: int) -> None:
    """Hard-delete one trashed home page (and its widgets) for a user."""
    async with get_db() as db:
        await db.execute("DELETE FROM home_widgets WHERE page_id=?", (page_id,))
        await db.execute(
            "DELETE FROM home_pages WHERE id=? AND user_id=? AND deleted_at IS NOT NULL",
            (page_id, user_id),
        )
        await db.commit()


async def empty_home_page_trash(user_id: int) -> int:
    """Hard-delete ALL trashed pages for this user. Child rows cascade automatically."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM home_pages WHERE user_id=? AND deleted_at IS NOT NULL",
            (user_id,),
        )
        await db.commit()
        return cur.rowcount


async def purge_expired_home_pages() -> int:
    """Hard-delete pages trashed for >30 days (all users). Called at server startup."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM home_pages"
            " WHERE deleted_at IS NOT NULL"
            " AND julianday('now') - julianday(deleted_at) > 30"
        )
        await db.commit()
        return cur.rowcount


async def duplicate_home_page(page_id: int, user_id: int) -> int:
    """Clone a home page (metadata + all widgets) and return the new page id.

    The clone is named '<original> (copy)' and inserted after the original
    in sort_order.  All widget rows are duplicated with the same config.
    """
    async with get_db() as db:
        # fetch source
        cur = await db.execute(
            "SELECT name, emoji, config_json, sort_order, page_type FROM home_pages "
            "WHERE id=? AND user_id=?",
            (page_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            raise ValueError(f"Home page {page_id} not found")

        clone_name = row["name"].strip() + " (copy)"
        new_sort   = row["sort_order"] + 1
        p_type     = row["page_type"] or "dashboard"

        # shift pages that come after to make room
        await db.execute(
            "UPDATE home_pages SET sort_order = sort_order + 1 "
            "WHERE user_id=? AND sort_order > ?",
            (user_id, row["sort_order"]),
        )

        # insert clone page
        pc = await db.execute(
            "INSERT INTO home_pages(user_id, name, emoji, sort_order, config_json, page_type) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            (user_id, clone_name, row["emoji"], new_sort, row["config_json"], p_type),
        )
        new_page_id = pc.lastrowid

        # clone widgets — flatten stacks: skip stack containers, promote children to top-level
        wc = await db.execute(
            "SELECT widget_type, style, config_json, sort_order "
            "FROM home_widgets WHERE page_id=? AND widget_type != 'stack' ORDER BY sort_order",
            (page_id,),
        )
        for w in await wc.fetchall():
            await db.execute(
                "INSERT INTO home_widgets(page_id, widget_type, style, config_json, sort_order) "
                "VALUES(?, ?, ?, ?, ?)",
                # group_id intentionally omitted — cloned children become top-level cards
                (new_page_id, w["widget_type"], w["style"], w["config_json"], w["sort_order"]),
            )

        await db.commit()
        return new_page_id


# ── Widgets ───────────────────────────────────────────────────────────────────

async def get_widgets(page_id: int) -> list[dict]:
    """Return top-level widgets for a page, with stack children nested under w['children']."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_widgets WHERE page_id=? ORDER BY sort_order, id",
            (page_id,),
        )
        rows = await cur.fetchall()

    all_widgets: list[dict] = []
    for r in rows:
        w = dict(r)
        try:
            w["config"] = json.loads(w["config_json"])
        except Exception:
            w["config"] = {}
        w.setdefault("children", [])
        all_widgets.append(w)

    # Nest children under their parent stack in Python — no extra SQL round-trip
    by_id = {w["id"]: w for w in all_widgets}
    top_level: list[dict] = []
    for w in all_widgets:
        gid = w.get("group_id")
        if gid and gid in by_id:
            by_id[gid]["children"].append(w)
        else:
            top_level.append(w)

    # Re-sort each stack's children by the stored child_order (drag-determined
    # page sequence).  Falls back to sort_order (already natural) when missing.
    for w in top_level:
        if w.get("widget_type") == "stack" and w.get("children"):
            order = w["config"].get("child_order", [])
            if order:
                rank = {wid: i for i, wid in enumerate(order)}
                w["children"].sort(key=lambda c: rank.get(c["id"], len(order)))

    return top_level


# ── Mobile-layout helpers (Option A: mobile order in page config_json) ───────

async def _append_mobile_order(db, page_id: int, widget_id: int) -> None:
    """Append widget_id to mobile_widget_order in page config if that key exists.

    Called inside an open transaction — does NOT commit.
    If mobile_widget_order hasn't been initialised yet (user never reordered
    on mobile) we leave it absent so the desktop sort_order is used as-is.
    """
    cur = await db.execute(
        "SELECT config_json FROM home_pages WHERE id=?", (page_id,)
    )
    row = await cur.fetchone()
    if not row:
        return
    try:
        cfg = json.loads(row["config_json"] or "{}")
    except Exception:
        return
    order = cfg.get("mobile_widget_order")
    if not isinstance(order, list):
        return  # not yet initialised — skip
    if widget_id not in order:
        cfg["mobile_widget_order"] = order + [widget_id]
        await db.execute(
            "UPDATE home_pages SET config_json=? WHERE id=?",
            (json.dumps(cfg), page_id),
        )


async def _prune_mobile_order(db, page_id: int, widget_id: int) -> None:
    """Remove widget_id from mobile_widget_order in page config.

    Called inside an open transaction — does NOT commit.
    """
    cur = await db.execute(
        "SELECT config_json FROM home_pages WHERE id=?", (page_id,)
    )
    row = await cur.fetchone()
    if not row:
        return
    try:
        cfg = json.loads(row["config_json"] or "{}")
    except Exception:
        return
    order = cfg.get("mobile_widget_order")
    if not isinstance(order, list) or widget_id not in order:
        return
    cfg["mobile_widget_order"] = [x for x in order if x != widget_id]
    await db.execute(
        "UPDATE home_pages SET config_json=? WHERE id=?",
        (json.dumps(cfg), page_id),
    )


async def reorder_widgets_mobile(
    page_id: int, user_id: int, ordered_ids: list[int]
) -> None:
    """Persist a mobile-specific widget order into home_pages.config_json.

    This is the first time mobile_widget_order is written for a page,
    so future add_widget / delete_widget calls will maintain it automatically.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT config_json FROM home_pages WHERE id=? AND user_id=?",
            (page_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            return
        try:
            cfg = json.loads(row["config_json"] or "{}")
        except Exception:
            cfg = {}
        cfg["mobile_widget_order"] = ordered_ids
        await db.execute(
            "UPDATE home_pages SET config_json=? WHERE id=? AND user_id=?",
            (json.dumps(cfg), page_id, user_id),
        )
        await db.commit()


# ── Widget CRUD ───────────────────────────────────────────────────────────────

async def add_widget(
    page_id: int, widget_type: str, style: str, config: dict
) -> int:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM home_widgets WHERE page_id=?",
            (page_id,),
        )
        row = await cur.fetchone()
        sort = row[0] if row else 1
        cur = await db.execute(
            "INSERT INTO home_widgets(page_id,widget_type,style,config_json,sort_order)"
            " VALUES(?,?,?,?,?)",
            (page_id, widget_type, style, json.dumps(config), sort),
        )
        new_id = cur.lastrowid
        # Keep mobile_widget_order in sync (only if it exists for this page).
        await _append_mobile_order(db, page_id, new_id)
        await db.commit()
        return new_id


async def update_widget_config(widget_id: int, config: dict) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE home_widgets SET config_json=? WHERE id=?",
            (json.dumps(config), widget_id),
        )
        await db.commit()


async def update_widget_style(widget_id: int, style: str) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE home_widgets SET style=? WHERE id=?",
            (style, widget_id),
        )
        await db.commit()


async def reorder_widgets(page_id: int, ordered_ids: list[int]) -> None:
    async with get_db() as db:
        await db.executemany(
            "UPDATE home_widgets SET sort_order=? WHERE id=? AND page_id=?",
            [(i, wid, page_id) for i, wid in enumerate(ordered_ids)],
        )
        await db.commit()


async def reorder_home_pages(user_id: int, ordered_ids: list[int]) -> None:
    """Persist a new sidebar order for a user\'s home pages."""
    async with get_db() as db:
        await db.executemany(
            "UPDATE home_pages SET sort_order=? WHERE id=? AND user_id=? AND deleted_at IS NULL",
            [(i, pid, user_id) for i, pid in enumerate(ordered_ids)],
        )
        await db.commit()


async def delete_widget(widget_id: int) -> None:
    """Delete a widget.  If it was the last child of a stack, auto-delete the stack too."""
    async with get_db() as db:
        # Fetch group_id AND page_id before deleting so we can clean up mobile order.
        cur = await db.execute(
            "SELECT group_id, page_id FROM home_widgets WHERE id=?", (widget_id,)
        )
        row = await cur.fetchone()
        parent_stack_id = row["group_id"] if row else None
        widget_page_id  = row["page_id"]  if row else None

        await db.execute("DELETE FROM home_widgets WHERE id=?", (widget_id,))

        # Remove from mobile_widget_order if it was tracked there.
        if widget_page_id:
            await _prune_mobile_order(db, widget_page_id, widget_id)

        # Auto-delete parent stack if it now has no children remaining
        if parent_stack_id:
            cur = await db.execute(
                "SELECT COUNT(*) FROM home_widgets WHERE group_id=?", (parent_stack_id,)
            )
            remaining = (await cur.fetchone())[0]
            if remaining == 0:
                await db.execute(
                    "DELETE FROM home_widgets WHERE id=?", (parent_stack_id,)
                )

        await db.commit()


async def get_widget_by_id(widget_id: int) -> dict | None:
    """Fetch a single widget row by ID.  Returns None if not found."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM home_widgets WHERE id=?", (widget_id,)
        )
        row = await cur.fetchone()
    if not row:
        return None
    w = dict(row)
    try:
        w["config"] = json.loads(w["config_json"])
    except Exception:
        w["config"] = {}
    return w


# ── Widget Stack helpers ──────────────────────────────────────────────────────────────────

async def create_stack_widget(page_id: int, child_ids: list[int], height_px_hint: int = 0) -> int:
    """
    Create a 'stack' widget row at the sort_order of the first child, then
    assign group_id on each child.  Returns the new stack widget id.
    Caller must validate that child_ids are all stackable (not divider/stack,
    not already grouped).
    height_px_hint: actual rendered pixel height captured by JS at drop time.
    Stored as min_height_px in config so the template can reproduce the exact
    visual size without relying on grid-auto-rows to do the expansion.
    Row span is never inflated — it stays as the max of children’s configured spans.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT sort_order, config_json FROM home_widgets WHERE id=? AND page_id=?",
            (child_ids[0], page_id),
        )
        row = await cur.fetchone()
        sort = row["sort_order"] if row else 0

        # Inherit dimensions from ALL children — take the max col/row span so the
        # stack is never smaller than any of its members.  A user might drag a tall
        # File Review widget onto a 1-row widget; without this the File Review would
        # be squeezed into the target's smaller footprint.
        try:
            first_cfg = json.loads(row["config_json"]) if row else {}
        except Exception:
            first_cfg = {}
        col_span = first_cfg.get("col_span", 1)
        row_span = first_cfg.get("row_span", 1)

        for extra_id in child_ids[1:]:
            cur2 = await db.execute(
                "SELECT config_json FROM home_widgets WHERE id=? AND page_id=?",
                (extra_id, page_id),
            )
            xrow = await cur2.fetchone()
            try:
                xcfg = json.loads(xrow["config_json"]) if xrow else {}
            except Exception:
                xcfg = {}
            col_span = max(col_span, xcfg.get("col_span", 1))
            row_span = max(row_span, xcfg.get("row_span", 1))

        # Frontend hint wins if larger — grid-auto-rows:auto lets cards grow
        # beyond their declared row_span; the hint captures that visual size.
        # (row span itself is intentionally NOT inflated — no auto row count increase)

        cfg: dict = {
            "active_index": 0,
            "col_span":     col_span,
            "row_span":     row_span,
            "child_order":  child_ids,
        }
        if height_px_hint > 0:
            cfg["min_height_px"] = height_px_hint

        cur = await db.execute(
            "INSERT INTO home_widgets(page_id, widget_type, style, config_json, sort_order)"
            " VALUES(?, 'stack', '', ?, ?)",
            (page_id, json.dumps(cfg), sort),
        )
        stack_id = cur.lastrowid

        for cid in child_ids:
            await db.execute(
                "UPDATE home_widgets SET group_id=? WHERE id=? AND page_id=?",
                (stack_id, cid, page_id),
            )
        await db.commit()
    return stack_id


async def stack_add_child(stack_id: int, widget_id: int, page_id: int, height_px_hint: int = 0) -> bool:
    """
    Set group_id=stack_id on widget_id.
    Validates: both rows belong to page_id; widget is not divider/stack;
    widget is not already in any stack.
    height_px_hint: actual rendered px height of the new child at drop time.
    Updates min_height_px in the stack config when the new child is taller.
    Returns False if any validation fails.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT widget_type, group_id FROM home_widgets WHERE id=? AND page_id=?",
            (widget_id, page_id),
        )
        row = await cur.fetchone()
        if not row:
            return False
        if row["widget_type"] in ("divider", "stack", "subscriptions_summary"):
            return False
        if row["group_id"] is not None:
            return False  # already belongs to a stack

        cur = await db.execute(
            "SELECT id FROM home_widgets WHERE id=? AND page_id=? AND widget_type='stack'",
            (stack_id, page_id),
        )
        if not await cur.fetchone():
            return False

        await db.execute(
            "UPDATE home_widgets SET group_id=? WHERE id=?",
            (stack_id, widget_id),
        )

        # Expand the stack if the new child is larger than its current footprint.
        cur_new = await db.execute(
            "SELECT config_json FROM home_widgets WHERE id=?", (widget_id,)
        )
        new_wrow = await cur_new.fetchone()
        try:
            new_cfg = json.loads(new_wrow["config_json"]) if new_wrow else {}
        except Exception:
            new_cfg = {}

        cur_st = await db.execute(
            "SELECT config_json FROM home_widgets WHERE id=?", (stack_id,)
        )
        st_row = await cur_st.fetchone()
        try:
            st_cfg = json.loads(st_row["config_json"]) if st_row else {}
        except Exception:
            st_cfg = {}

        new_col  = new_cfg.get("col_span", 1)
        new_rows = new_cfg.get("row_span", 1)
        st_cfg["col_span"] = max(st_cfg.get("col_span", 1), new_col)
        st_cfg["row_span"] = max(st_cfg.get("row_span", 1), new_rows)
        # Update min_height_px if the new child is visually taller.
        if height_px_hint > 0 and height_px_hint > st_cfg.get("min_height_px", 0):
            st_cfg["min_height_px"] = height_px_hint
        # Append new child to ordering list so it becomes the last slide.
        # Backwards-compat: seed child_order from existing DB order if missing.
        if "child_order" not in st_cfg:
            cur_kids = await db.execute(
                "SELECT id FROM home_widgets WHERE group_id=? AND page_id=? ORDER BY sort_order, id",
                (stack_id, page_id),
            )
            st_cfg["child_order"] = [r["id"] for r in await cur_kids.fetchall()]
        if widget_id not in st_cfg["child_order"]:
            st_cfg["child_order"].append(widget_id)
        await db.execute(
            "UPDATE home_widgets SET config_json=? WHERE id=?",
            (json.dumps(st_cfg), stack_id),
        )

        await db.commit()
    return True


async def unstack_widget(stack_id: int, page_id: int) -> list[int]:
    """
    Clear group_id on all children, then delete the stack widget row.
    Returns list of freed child widget IDs in sort_order.
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM home_widgets WHERE group_id=? AND page_id=? ORDER BY sort_order, id",
            (stack_id, page_id),
        )
        child_ids = [r["id"] for r in await cur.fetchall()]

        await db.execute(
            "UPDATE home_widgets SET group_id=NULL WHERE group_id=?",
            (stack_id,),
        )
        await db.execute(
            "DELETE FROM home_widgets WHERE id=? AND page_id=?",
            (stack_id, page_id),
        )
        await db.commit()
    return child_ids
