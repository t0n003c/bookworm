"""Category and attribute-definition DB helpers."""
from typing import Optional
from database import get_db


# ---------------------------------------------------------------------------
# Workspace-scoped category helpers
# ---------------------------------------------------------------------------

async def get_categories_for_workspace(workspace_id: Optional[int]) -> list[dict]:
    """Return categories linked to a specific workspace, ordered by name.

    Falls back to all categories when workspace_id is None (global context).
    """
    async with get_db() as db:
        if workspace_id is None:
            cursor = await db.execute(
                "SELECT id, name, color, description, created_at FROM categories ORDER BY name"
            )
        else:
            cursor = await db.execute(
                """
                SELECT c.id, c.name, c.color, c.description, c.created_at
                FROM categories c
                JOIN workspace_categories wc ON wc.category_id = c.id
                WHERE wc.workspace_id = ?
                ORDER BY c.name
                """,
                (workspace_id,),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def copy_categories_to_workspace(from_ws_id: int, to_ws_id: int) -> None:
    """Copy all category links from one workspace to another.

    Used when a nested workspace is created — child starts with parent's set.
    """
    async with get_db() as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id)
            SELECT ?, category_id FROM workspace_categories WHERE workspace_id = ?
            """,
            (to_ws_id, from_ws_id),
        )
        await db.commit()


async def seed_default_categories_for_workspace(workspace_id: int) -> None:
    """Link ALL existing categories to a brand-new root workspace.

    Only called when a root workspace (no parent) is created.
    """
    async with get_db() as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id)
            SELECT ?, id FROM categories
            """,
            (workspace_id,),
        )
        await db.commit()


async def create_category(
    name: str,
    color: str,
    description: Optional[str],
    workspace_id: Optional[int] = None,
) -> int:
    """Create a global category and, if workspace_id is provided, link it there."""
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO categories (name, color, description) VALUES (?, ?, ?)",
            (name, color, description),
        )
        cat_id = cursor.lastrowid
        if workspace_id is not None:
            await db.execute(
                "INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id) VALUES (?, ?)",
                (workspace_id, cat_id),
            )
        await db.commit()
        return cat_id


async def rename_category(cat_id: int, name: str, color: str) -> bool:
    """Update a category's name and color globally (affects all workspaces)."""
    async with get_db() as db:
        cursor = await db.execute(
            "UPDATE categories SET name = ?, color = ? WHERE id = ?",
            (name, color, cat_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def delete_category(cat_id: int, workspace_id: Optional[int] = None) -> bool:
    """Remove a category from a workspace (unlinks it).

    If workspace_id is supplied, only the workspace ↔ category link is removed
    so that notes in other workspaces keep their reference intact.
    If workspace_id is None, the category is hard-deleted globally.
    """
    async with get_db() as db:
        if workspace_id is not None:
            cursor = await db.execute(
                "DELETE FROM workspace_categories WHERE workspace_id = ? AND category_id = ?",
                (workspace_id, cat_id),
            )
        else:
            cursor = await db.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
        await db.commit()
        return cursor.rowcount > 0


async def get_categories_used_in_workspaces(workspace_ids: list[int]) -> list[dict]:
    """Return only categories that appear on at least one note inside the
    given workspace id set (the workspace + all its descendants).

    This is the right source for the sidebar filter — it shows only
    categories that are actually meaningful to filter by.
    """
    if not workspace_ids:
        return []
    placeholders = ",".join("?" * len(workspace_ids))
    async with get_db() as db:
        cursor = await db.execute(
            f"""
            SELECT DISTINCT c.id, c.name, c.color, c.description, c.created_at
            FROM categories c
            JOIN note_categories nc ON nc.category_id = c.id
            JOIN notes n ON n.id = nc.note_id
            WHERE n.workspace_id IN ({placeholders})
            ORDER BY c.name
            """,
            workspace_ids,
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Legacy global helpers (kept for backwards-compat import paths)
# ---------------------------------------------------------------------------

async def get_all_categories() -> list[dict]:
    """Return all categories regardless of workspace."""
    return await get_categories_for_workspace(None)


# ---------------------------------------------------------------------------
# Attribute Definitions
# ---------------------------------------------------------------------------

async def get_all_attr_defs() -> list[dict]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id, name, field_type, options FROM attr_definitions ORDER BY name"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def create_attr_def(name: str, field_type: str, options: Optional[str]) -> int:
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO attr_definitions (name, field_type, options) VALUES (?, ?, ?)",
            (name, field_type, options),
        )
        await db.commit()
        return cursor.lastrowid


async def delete_attr_def(def_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM attr_definitions WHERE id = ?", (def_id,))
        await db.commit()
        return cursor.rowcount > 0
