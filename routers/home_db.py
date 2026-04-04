"""Database helpers for Home Pages + Widgets."""
import json
import aiosqlite
from database import DB_PATH


# ── Home Pages ────────────────────────────────────────────────────────────────

async def get_home_pages(user_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM home_pages WHERE user_id=? ORDER BY sort_order,id",
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
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM home_pages WHERE id=? AND user_id=?", (page_id, user_id)
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


async def create_home_page(user_id: int, name: str, emoji: str = "🏠") -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM home_pages WHERE user_id=?",
            (user_id,),
        )
        row = await cur.fetchone()
        sort = row[0] if row else 1
        cur = await db.execute(
            "INSERT INTO home_pages(user_id,name,emoji,sort_order) VALUES(?,?,?,?)",
            (user_id, name.strip() or "My Page", emoji, sort),
        )
        await db.commit()
        return cur.lastrowid


async def rename_home_page(page_id: int, user_id: int, name: str, emoji: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE home_pages SET name=?,emoji=? WHERE id=? AND user_id=?",
            (name.strip() or "My Page", emoji, page_id, user_id),
        )
        await db.commit()


async def update_page_config(page_id: int, user_id: int, config: dict) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE home_pages SET config_json=? WHERE id=? AND user_id=?",
            (json.dumps(config), page_id, user_id),
        )
        await db.commit()


async def delete_home_page(page_id: int, user_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM home_pages WHERE id=? AND user_id=?", (page_id, user_id)
        )
        await db.commit()


# ── Widgets ───────────────────────────────────────────────────────────────────

async def get_widgets(page_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM home_widgets WHERE page_id=? ORDER BY sort_order,id",
            (page_id,),
        )
        rows = await cur.fetchall()
    result = []
    for r in rows:
        w = dict(r)
        try:
            w["config"] = json.loads(w["config_json"])
        except Exception:
            w["config"] = {}
        result.append(w)
    return result


async def add_widget(
    page_id: int, widget_type: str, style: str, config: dict
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
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
        await db.commit()
        return cur.lastrowid


async def update_widget_config(widget_id: int, config: dict) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE home_widgets SET config_json=? WHERE id=?",
            (json.dumps(config), widget_id),
        )
        await db.commit()


async def update_widget_style(widget_id: int, style: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE home_widgets SET style=? WHERE id=?",
            (style, widget_id),
        )
        await db.commit()


async def reorder_widgets(page_id: int, ordered_ids: list[int]) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        for i, wid in enumerate(ordered_ids):
            await db.execute(
                "UPDATE home_widgets SET sort_order=? WHERE id=? AND page_id=?",
                (i, wid, page_id),
            )
        await db.commit()


async def delete_widget(widget_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM home_widgets WHERE id=?", (widget_id,))
        await db.commit()
