"""Trip Planning homespace page — DB helper functions.

All functions use get_db(); never raw aiosqlite.connect().
get_db() enforces PRAGMA foreign_keys=ON, WAL, busy_timeout=5000.
"""
from __future__ import annotations
import json

from database import get_db


# ── Location helpers ──────────────────────────────────────────────────────────

def _loc_row(r) -> dict:
    return {
        "id":         r["id"],
        "page_id":    r["page_id"],
        "name":       r["name"],
        "priority":   r["priority"],
        "notes":      r["notes"],
        "cover_url":  r["cover_url"],
        "sort_order": r["sort_order"],
        "created_at": r["created_at"],
        "attrs":      [],   # populated by get_trip_locations
    }


async def get_trip_locations(page_id: int, user_id: int) -> list[dict]:
    """Return all locations for page with nested attrs — no N+1."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT l.id, l.page_id, l.name, l.priority, l.notes,
                   l.cover_url, l.sort_order, l.created_at,
                   a.id AS attr_id, a.attr_key, a.attr_value, a.sort_order AS attr_sort
              FROM trip_locations l
              LEFT JOIN trip_location_attrs a ON a.location_id = l.id
             WHERE l.page_id=? AND l.user_id=?
             ORDER BY l.sort_order, l.id, a.sort_order
            """,
            (page_id, user_id),
        )
        rows = await cur.fetchall()

    locs: dict[int, dict] = {}
    for r in rows:
        lid = r["id"]
        if lid not in locs:
            locs[lid] = {
                "id":         lid,
                "page_id":    r["page_id"],
                "name":       r["name"],
                "priority":   r["priority"],
                "notes":      r["notes"],
                "cover_url":  r["cover_url"],
                "sort_order": r["sort_order"],
                "created_at": r["created_at"],
                "attrs":      [],
            }
        if r["attr_id"] is not None:
            locs[lid]["attrs"].append({
                "id":        r["attr_id"],
                "attr_key":  r["attr_key"],
                "attr_value": r["attr_value"],
                "sort_order": r["attr_sort"],
            })
    return list(locs.values())


async def add_trip_location(
    page_id: int, user_id: int,
    name: str, priority: int, notes: str, cover_url: str,
) -> int:
    """INSERT a new location; return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_locations
              (page_id, user_id, name, priority, notes, cover_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 10
                 FROM trip_locations WHERE page_id=?))
            """,
            (page_id, user_id, name, priority, notes, cover_url, page_id),
        )
        await db.commit()
        return cur.lastrowid


async def update_trip_location(
    loc_id: int, page_id: int, user_id: int,
    name: str, priority: int, notes: str, cover_url: str,
) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE trip_locations
               SET name=?, priority=?, notes=?, cover_url=?
             WHERE id=? AND page_id=? AND user_id=?
            """,
            (name, priority, notes, cover_url, loc_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def update_trip_location_cover(
    loc_id: int, page_id: int, user_id: int, cover_url: str
) -> bool:
    """Lightweight cover-url-only update (after upload)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE trip_locations SET cover_url=? WHERE id=? AND page_id=? AND user_id=?",
            (cover_url, loc_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def delete_trip_location(loc_id: int, page_id: int, user_id: int) -> bool:
    """DELETE location; attrs + spot FK set null via ON DELETE CASCADE/SET NULL."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_locations WHERE id=? AND page_id=? AND user_id=?",
            (loc_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def set_location_attrs(
    loc_id: int, attrs: list[dict]
) -> None:
    """Replace all attrs for a location atomically (delete-all + re-insert)."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM trip_location_attrs WHERE location_id=?", (loc_id,)
        )
        for idx, attr in enumerate(attrs):
            key = str(attr.get("attr_key", "")).strip()
            val = str(attr.get("attr_value", "")).strip()
            if not key:
                continue
            await db.execute(
                """
                INSERT INTO trip_location_attrs
                  (location_id, attr_key, attr_value, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (loc_id, key, val, idx * 10),
            )
        await db.commit()


async def reorder_trip_locations(
    page_id: int, user_id: int, ordered_ids: list[int]
) -> None:
    async with get_db() as db:
        for idx, lid in enumerate(ordered_ids):
            await db.execute(
                "UPDATE trip_locations SET sort_order=? WHERE id=? AND page_id=? AND user_id=?",
                (idx * 10, lid, page_id, user_id),
            )
        await db.commit()


# ── Spot helpers ──────────────────────────────────────────────────────────────

def _spot_row(r) -> dict:
    return {
        "id":             r["id"],
        "page_id":        r["page_id"],
        "location_id":    r["location_id"],
        "name":           r["name"],
        "spot_type":      r["spot_type"],
        "cover_url":      r["cover_url"],
        "map_url":        r["map_url"],
        "notes":          r["notes"],
        "priority":       r["priority"],
        "estimated_cost": r["estimated_cost"],
        "currency":       r["currency"],
        "sort_order":     r["sort_order"],
        "created_at":     r["created_at"],
        "attrs":          [],   # populated by get_trip_spots
    }


async def get_trip_spots(
    page_id: int,
    user_id: int,
    spot_type: str | None = None,
    location_id: int | None = None,
) -> list[dict]:
    """Return spots with nested attrs; no N+1."""
    async with get_db() as db:
        clauses = ["s.page_id=?", "s.user_id=?"]
        params: list = [page_id, user_id]
        if spot_type:
            clauses.append("s.spot_type=?")
            params.append(spot_type)
        if location_id is not None:
            clauses.append("s.location_id=?")
            params.append(location_id)
        where = " AND ".join(clauses)
        cur = await db.execute(
            f"""
            SELECT s.id, s.page_id, s.location_id, s.name, s.spot_type,
                   s.cover_url, s.map_url, s.notes, s.priority,
                   s.estimated_cost, s.currency, s.sort_order, s.created_at,
                   a.id AS attr_id, a.attr_key, a.attr_value,
                   a.sort_order AS attr_sort
              FROM trip_spots s
              LEFT JOIN trip_spot_attrs a ON a.spot_id = s.id
             WHERE {where}
             ORDER BY s.sort_order, s.id, a.sort_order
            """,
            params,
        )
        rows = await cur.fetchall()

    spots: dict[int, dict] = {}
    for r in rows:
        sid = r["id"]
        if sid not in spots:
            spots[sid] = {
                "id":             sid,
                "page_id":        r["page_id"],
                "location_id":    r["location_id"],
                "name":           r["name"],
                "spot_type":      r["spot_type"],
                "cover_url":      r["cover_url"],
                "map_url":        r["map_url"],
                "notes":          r["notes"],
                "priority":       r["priority"],
                "estimated_cost": r["estimated_cost"],
                "currency":       r["currency"],
                "sort_order":     r["sort_order"],
                "created_at":     r["created_at"],
                "attrs":          [],
            }
        if r["attr_id"] is not None:
            spots[sid]["attrs"].append({
                "id":         r["attr_id"],
                "attr_key":   r["attr_key"],
                "attr_value": r["attr_value"],
                "sort_order": r["attr_sort"],
            })
    return list(spots.values())


async def set_spot_attrs(spot_id: int, attrs: list[dict]) -> None:
    """Replace all attrs for spot_id with the given list (idempotent)."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM trip_spot_attrs WHERE spot_id=?", (spot_id,)
        )
        for i, a in enumerate(attrs):
            key = (a.get("attr_key") or "").strip()
            if not key:
                continue
            await db.execute(
                """
                INSERT INTO trip_spot_attrs (spot_id, attr_key, attr_value, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (spot_id, key, (a.get("attr_value") or "").strip(), i * 10),
            )
        await db.commit()


async def get_spot_attr_keys(spot_id: int) -> set:
    """Return the set of attr_key values currently saved for a spot."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT attr_key FROM trip_spot_attrs WHERE spot_id=?", (spot_id,)
        )
        rows = await cur.fetchall()
    return {row["attr_key"] for row in rows}


async def delete_attr_key_from_location(location_id: int, attr_key: str) -> None:
    """Remove attr_key from every spot that belongs to location_id."""
    async with get_db() as db:
        await db.execute(
            """
            DELETE FROM trip_spot_attrs
            WHERE attr_key = ?
              AND spot_id IN (
                  SELECT id FROM trip_spots WHERE location_id = ?
              )
            """,
            (attr_key, location_id),
        )
        await db.commit()



async def add_trip_spot(
    page_id: int,
    user_id: int,
    name: str,
    spot_type: str,
    cover_url: str,
    map_url: str,
    notes: str,
    priority: int,
    estimated_cost: float,
    currency: str,
    location_id: int | None = None,
) -> int:
    """INSERT a new spot; return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_spots
              (page_id, user_id, location_id, name, spot_type, cover_url,
               map_url, notes, priority, estimated_cost, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (page_id, user_id, location_id, name, spot_type, cover_url,
             map_url, notes, priority, estimated_cost, currency),
        )
        await db.commit()
        return cur.lastrowid


async def update_trip_spot(
    spot_id: int,
    page_id: int,
    user_id: int,
    name: str,
    spot_type: str,
    cover_url: str,
    map_url: str,
    notes: str,
    priority: int,
    estimated_cost: float,
    currency: str,
    location_id: int | None = None,
) -> bool:
    """UPDATE spot with ownership guard. Returns True on success."""
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE trip_spots
               SET name=?, spot_type=?, cover_url=?, map_url=?,
                   notes=?, priority=?, estimated_cost=?, currency=?,
                   location_id=?
             WHERE id=? AND page_id=? AND user_id=?
            """,
            (name, spot_type, cover_url, map_url,
             notes, priority, estimated_cost, currency,
             location_id, spot_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def update_trip_spot_cover(
    spot_id: int, page_id: int, user_id: int, cover_url: str
) -> bool:
    """Lightweight cover-url-only update (after upload)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE trip_spots SET cover_url=? WHERE id=? AND page_id=? AND user_id=?",
            (cover_url, spot_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def update_trip_spot_priority(
    spot_id: int, page_id: int, user_id: int, priority: int
) -> bool:
    """Lightweight priority-only update (inline star click)."""
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE trip_spots SET priority=? WHERE id=? AND page_id=? AND user_id=?",
            (priority, spot_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def delete_trip_spot(spot_id: int, page_id: int, user_id: int) -> bool:
    """DELETE spot with ownership guard. trip_day_spots cascade-deletes."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_spots WHERE id=? AND page_id=? AND user_id=?",
            (spot_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def reorder_trip_spots(
    page_id: int, user_id: int, ordered_ids: list[int]
) -> None:
    """Set sort_order for each spot id in the ordered list."""
    async with get_db() as db:
        for idx, spot_id in enumerate(ordered_ids):
            await db.execute(
                "UPDATE trip_spots SET sort_order=? WHERE id=? AND page_id=? AND user_id=?",
                (idx * 10, spot_id, page_id, user_id),
            )
        await db.commit()


# ── Plan helpers (itinerary segments; parent of plan-tab days) ──────────────

async def get_trip_plans(page_id: int, user_id: int) -> list[dict]:
    """Return all plans with a day_count summary."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT p.id, p.plan_name, p.plan_desc, p.start_date, p.end_date,
                   p.cover_url, p.sort_order,
                   COUNT(d.id) AS day_count
              FROM trip_plans p
              LEFT JOIN trip_days d ON d.plan_id = p.id
             WHERE p.page_id=? AND p.user_id=?
             GROUP BY p.id
             ORDER BY p.sort_order, p.id
            """,
            (page_id, user_id),
        )
        rows = await cur.fetchall()
    return [
        {
            "id":         r["id"],
            "plan_name":  r["plan_name"],
            "plan_desc":  r["plan_desc"],
            "start_date": r["start_date"],
            "end_date":   r["end_date"],
            "cover_url":  r["cover_url"],
            "sort_order": r["sort_order"],
            "day_count":  r["day_count"],
        }
        for r in rows
    ]


async def add_trip_plan(
    page_id: int, user_id: int,
    plan_name: str, plan_desc: str,
    start_date: str, end_date: str,
    cover_url: str = "",
) -> int:
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_plans
                   (page_id, user_id, plan_name, plan_desc, start_date, end_date, cover_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 10
                 FROM trip_plans WHERE page_id=?))
            """,
            (page_id, user_id, plan_name, plan_desc, start_date, end_date, cover_url, page_id),
        )
        await db.commit()
        return cur.lastrowid


async def update_trip_plan(
    plan_id: int, page_id: int, user_id: int,
    plan_name: str, plan_desc: str,
    start_date: str, end_date: str,
    cover_url: str = "",
) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            """UPDATE trip_plans
                  SET plan_name=?, plan_desc=?, start_date=?, end_date=?, cover_url=?
                WHERE id=? AND page_id=? AND user_id=?""",
            (plan_name, plan_desc, start_date, end_date, cover_url, plan_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def update_trip_plan_cover(
    plan_id: int, page_id: int, user_id: int, cover_url: str
) -> None:
    """Lightweight cover-url-only update (after upload)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE trip_plans SET cover_url=? WHERE id=? AND page_id=? AND user_id=?",
            (cover_url, plan_id, page_id, user_id),
        )
        await db.commit()


async def delete_trip_plan(plan_id: int, page_id: int, user_id: int) -> bool:
    """DELETE plan; trip_days with this plan_id cascade-delete."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_plans WHERE id=? AND page_id=? AND user_id=?",
            (plan_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


# ── Day helpers ───────────────────────────────────────────────────────────────

async def get_trip_days(
    page_id: int, user_id: int, plan_id: int | None = None
) -> list[dict]:
    """Return days (with nested spots) for a page, optionally scoped to plan_id."""
    plan_clause = "AND td.plan_id=?" if plan_id is not None else "AND td.plan_id IS NULL"
    params = (page_id, user_id, plan_id) if plan_id is not None else (page_id, user_id)
    async with get_db() as db:
        cur = await db.execute(
            f"""
            SELECT td.id         AS day_id,
                   td.day_label, td.day_date,
                   td.sort_order AS day_sort,
                   tds.id        AS tds_id,
                   tds.spot_id,  tds.time_label,
                   tds.sort_order AS spot_sort,
                   ts.name, ts.spot_type, ts.cover_url,
                   ts.priority, ts.estimated_cost, ts.currency
              FROM trip_days td
              LEFT JOIN trip_day_spots tds ON tds.day_id = td.id
              LEFT JOIN trip_spots     ts  ON ts.id      = tds.spot_id
             WHERE td.page_id=? AND td.user_id=? {plan_clause}
             ORDER BY td.sort_order, td.id, tds.sort_order
            """,
            params,
        )
        rows = await cur.fetchall()

    days: dict[int, dict] = {}
    for r in rows:
        did = r["day_id"]
        if did not in days:
            days[did] = {
                "id":         did,
                "day_label":  r["day_label"],
                "day_date":   r["day_date"],
                "sort_order": r["day_sort"],
                "spots":      [],
            }
        if r["tds_id"] is not None:
            days[did]["spots"].append({
                "tds_id":         r["tds_id"],
                "spot_id":        r["spot_id"],
                "name":           r["name"],
                "spot_type":      r["spot_type"],
                "cover_url":      r["cover_url"],
                "priority":       r["priority"],
                "estimated_cost": r["estimated_cost"],
                "currency":       r["currency"],
                "time_label":     r["time_label"],
                "sort_order":     r["spot_sort"],
            })
    return list(days.values())


async def add_trip_day(
    page_id: int, user_id: int, day_label: str, day_date: str | None,
    plan_id: int | None = None,
) -> int:
    """INSERT a new day; return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_days (page_id, user_id, day_label, day_date, plan_id, sort_order)
            VALUES (?, ?, ?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 10
                 FROM trip_days WHERE page_id=? AND
                 (CASE WHEN ? IS NULL THEN plan_id IS NULL ELSE plan_id=? END)))
            """,
            (page_id, user_id, day_label, day_date or None, plan_id,
             page_id, plan_id, plan_id),
        )
        await db.commit()
        return cur.lastrowid


async def update_trip_day(
    day_id: int, page_id: int, user_id: int,
    day_label: str, day_date: str | None
) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE trip_days SET day_label=?, day_date=? WHERE id=? AND page_id=? AND user_id=?",
            (day_label, day_date or None, day_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def delete_trip_day(day_id: int, page_id: int, user_id: int) -> bool:
    """DELETE day; trip_day_spots cascade-delete; spots themselves untouched."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_days WHERE id=? AND page_id=? AND user_id=?",
            (day_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def reorder_trip_days(
    page_id: int, user_id: int, ordered_ids: list[int]
) -> None:
    async with get_db() as db:
        for idx, day_id in enumerate(ordered_ids):
            await db.execute(
                "UPDATE trip_days SET sort_order=? WHERE id=? AND page_id=? AND user_id=?",
                (idx * 10, day_id, page_id, user_id),
            )
        await db.commit()


# ── Day-spot assignment helpers ───────────────────────────────────────────────

async def assign_spot_to_day(
    day_id: int, spot_id: int, time_label: str
) -> bool:
    """INSERT OR IGNORE — safe to call twice."""
    async with get_db() as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO trip_day_spots (day_id, spot_id, time_label, sort_order)
            VALUES (?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM trip_day_spots WHERE day_id=?))
            """,
            (day_id, spot_id, time_label, day_id),
        )
        await db.commit()
    return True


async def update_day_spot_time(
    day_id: int, spot_id: int, time_label: str
) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE trip_day_spots SET time_label=? WHERE day_id=? AND spot_id=?",
            (time_label, day_id, spot_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def remove_spot_from_day(day_id: int, spot_id: int) -> bool:
    """Remove assignment only — spot itself is untouched."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM trip_day_spots WHERE day_id=? AND spot_id=?",
            (day_id, spot_id),
        )
        await db.commit()
        return cur.rowcount >= 1


async def reorder_day_spots(day_id: int, ordered_tds_ids: list[int]) -> None:
    """Reorder spots within a day by trip_day_spots.id list."""
    async with get_db() as db:
        for idx, tds_id in enumerate(ordered_tds_ids):
            await db.execute(
                "UPDATE trip_day_spots SET sort_order=? WHERE id=? AND day_id=?",
                (idx * 10, tds_id, day_id),
            )
        await db.commit()


# ── Day-block helpers ──────────────────────────────────────────────────────────────

async def _day_owned(db, day_id: int, page_id: int, user_id: int) -> bool:
    """Quick ownership check: does this day belong to this user+page?"""
    cur = await db.execute(
        "SELECT 1 FROM trip_days WHERE id=? AND page_id=? AND user_id=?",
        (day_id, page_id, user_id),
    )
    return await cur.fetchone() is not None


async def get_day_blocks(day_id: int, page_id: int, user_id: int) -> list[dict]:
    """Return all blocks for a day ordered by order_idx."""
    async with get_db() as db:
        if not await _day_owned(db, day_id, page_id, user_id):
            return []
        cur = await db.execute(
            "SELECT id, block_type, order_idx, time_label, content, reminder_at "
            "FROM trip_day_blocks WHERE day_id=? ORDER BY order_idx",
            (day_id,),
        )
        rows = await cur.fetchall()
        return [
            {
                "id":          r["id"],
                "block_type":  r["block_type"],
                "order_idx":   r["order_idx"],
                "time_label":  r["time_label"],
                "content":     r["content"],
                "reminder_at": r["reminder_at"],
            }
            for r in rows
        ]


async def add_day_block(
    day_id: int, page_id: int, user_id: int,
    block_type: str, content: str, time_label: str,
    reminder_at: str | None = None,
) -> int | None:
    """INSERT a new block. Returns new id or None if ownership check fails."""
    async with get_db() as db:
        if not await _day_owned(db, day_id, page_id, user_id):
            return None
        # Append after the highest existing order value across spots AND blocks
        cur = await db.execute(
            """
            SELECT MAX(v) FROM (
                SELECT COALESCE(MAX(sort_order), -10) AS v
                  FROM trip_day_spots WHERE day_id=?
                UNION ALL
                SELECT COALESCE(MAX(order_idx), -10) AS v
                  FROM trip_day_blocks WHERE day_id=?
            )
            """,
            (day_id, day_id),
        )
        row = await cur.fetchone()
        order_idx = (row[0] if row and row[0] is not None else -10) + 10
        await db.execute(
            "INSERT INTO trip_day_blocks "
            "(day_id, block_type, order_idx, time_label, content, reminder_at) "
            "VALUES (?,?,?,?,?,?)",
            (day_id, block_type, order_idx, time_label, content, reminder_at or None),
        )
        await db.commit()
        cur = await db.execute("SELECT last_insert_rowid()")
        return (await cur.fetchone())[0]


async def update_day_block(
    block_id: int, day_id: int, page_id: int, user_id: int,
    content: str, time_label: str,
    reminder_at: str | None = None,
) -> bool:
    """Update block content + time_label + reminder_at. Returns False if not found/owned."""
    async with get_db() as db:
        if not await _day_owned(db, day_id, page_id, user_id):
            return False
        await db.execute(
            "UPDATE trip_day_blocks SET content=?, time_label=?, reminder_at=? "
            "WHERE id=? AND day_id=?",
            (content, time_label, reminder_at or None, block_id, day_id),
        )
        await db.commit()
        return True


async def delete_day_block(
    block_id: int, day_id: int, page_id: int, user_id: int,
) -> bool:
    """Delete a block. Returns False if not found/owned."""
    async with get_db() as db:
        if not await _day_owned(db, day_id, page_id, user_id):
            return False
        await db.execute(
            "DELETE FROM trip_day_blocks WHERE id=? AND day_id=?",
            (block_id, day_id),
        )
        await db.commit()
        return True


async def reorder_day_lane(
    day_id: int, page_id: int, user_id: int,
    items: list[dict],
) -> None:
    """Bulk-update sort_order on trip_day_spots and order_idx on
    trip_day_blocks in a single transaction."""
    async with get_db() as db:
        if not await _day_owned(db, day_id, page_id, user_id):
            return
        for item in items:
            oidx = item.get("order_idx", 0)
            if item.get("kind") == "spot":
                await db.execute(
                    "UPDATE trip_day_spots SET sort_order=? WHERE id=? AND day_id=?",
                    (oidx, item["id"], day_id),
                )
            elif item.get("kind") == "block":
                await db.execute(
                    "UPDATE trip_day_blocks SET order_idx=? WHERE id=? AND day_id=?",
                    (oidx, item["id"], day_id),
                )
        await db.commit()



# ── Stats helper ──────────────────────────────────────────────────────────────

# ── Panel summaries for Chart tab ────────────────────────────────────────────

def _parse_panel_json(raw: str) -> dict:
    """Silently return {} on bad JSON — never crash the stats endpoint."""
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


async def _panel_summaries(
    page_id: int, user_id: int, plan_id: int | None
) -> tuple[list[dict], list[dict]]:
    """Return (budget_panels, settle_panels) summarised for the chart tab.

    Also queries 'people' panels so group budget panels can report how many
    members share the cost (people_count field on each group budget panel).
    """
    async with get_db() as db:
        if plan_id is None:
            cur = await db.execute(
                """
                SELECT id, panel_type, title, content
                  FROM trip_plan_panels
                 WHERE page_id=? AND user_id=?
                   AND panel_type IN ('budget','settle','people')
                 ORDER BY sort_order, id
                """,
                (page_id, user_id),
            )
        else:
            cur = await db.execute(
                """
                SELECT id, panel_type, title, content
                  FROM trip_plan_panels
                 WHERE page_id=? AND user_id=? AND plan_id=?
                   AND panel_type IN ('budget','settle','people')
                 ORDER BY sort_order, id
                """,
                (page_id, user_id, plan_id),
            )
        rows = await cur.fetchall()

    # Build a map of people-card ID → member count / names so group budget panels
    # can report how many people share their items, and so settle panels can resolve
    # their authoritative member list when linked via either direction.
    people_card_count: dict[int, int] = {}        # people_card_id → count
    people_card_members: dict[int, list[str]] = {}  # people_card_id → [name, ...]
    settle_to_members: dict[int, list[str]] = {}    # settle_id → [name, ...]  (direction A)
    for row in rows:
        if row["panel_type"] == "people":
            c = _parse_panel_json(row["content"])
            raw_members = c.get("members") or c.get("people") or []
            names = [
                (m.get("name", "") if isinstance(m, dict) else str(m))
                for m in raw_members
            ]
            people_card_count[row["id"]]   = len(names)
            people_card_members[row["id"]] = names
            # Direction A: People card → Settle card via linked_settle_id
            ls = c.get("linked_settle_id")
            if ls is not None:
                settle_to_members[int(ls)] = names

    budget_panels: list[dict] = []
    settle_panels: list[dict] = []

    for row in rows:
        c = _parse_panel_json(row["content"])
        if row["panel_type"] == "people":
            continue   # already consumed above
        if row["panel_type"] == "budget":
            items = c.get("items") or []
            # items can use either 'label' (old) or 'note' (new panel UI) as the
            # description field.  Normalise to 'label' for downstream consumers.
            for it in items:
                if not it.get("label") and it.get("note"):
                    it["label"] = it["note"]
            reconciled_count = sum(1 for it in items if it.get("reconciled"))
            # Only non-reconciled manual items count toward budget "spent".
            # Reconciled items are already tracked in the linked settle panel.
            unreconciled_spent = sum(
                float(it.get("amount") or 0)
                for it in items
                if not it.get("reconciled")
            )
            ceiling_source = c.get("ceiling_source", "manual")  # 'manual' | 'spots'
            spot_types     = c.get("spot_types") or []           # list of spot_type strings
            budget_scope  = c.get("budget_scope",  "group")   # 'group' | 'individual'
            budget_person = c.get("budget_person", "")          # free-text name when individual
            budget_panels.append({
                "id":                row["id"],
                "title":             row["title"] or "Budget",
                "currency":          c.get("currency") or "USD",
                "ceiling":           float(c.get("total") or 0),
                "ceiling_source":    ceiling_source,
                "spot_types":        spot_types,
                "spent":             unreconciled_spent,
                "reconciled_count":  reconciled_count,
                "total_items":       len(items),
                "budget_scope":      budget_scope,
                "budget_person":     budget_person,
                "items":             [{
                    "label":      it.get("label") or it.get("note") or "",
                    "amount":     float(it.get("amount") or 0),
                    "note":       it.get("note") or it.get("label") or "",
                    "category":   it.get("category") or "",
                    "reconciled": bool(it.get("reconciled")),
                    "settle_ref": it.get("settle_ref"),
                } for it in items],
                "linked_settle_id":  c.get("linked_settle_id"),
                "linked_person_idx": c.get("linked_person_idx"),
                "linked_people_id":  c.get("linked_people_id"),
                # How many members share this group budget.
                # Resolved from the linked People card; 0 = unknown / individual.
                "people_count":      people_card_count.get(
                    int(c["linked_people_id"]) if c.get("linked_people_id") else 0, 0
                ),
            })
        elif row["panel_type"] == "settle":
            # Resolve the authoritative member list — same two-direction lookup
            # as the frontend _tppFindLinkedPeoplePanel:
            #   A) A People card has linked_settle_id pointing at this card
            #   B) This settle card has linked_people_id pointing at a People card
            # Direction A takes priority (matches frontend precedence).
            if row["id"] in settle_to_members:
                people = settle_to_members[row["id"]]
            else:
                lp_id = c.get("linked_people_id")
                lp_id = int(lp_id) if lp_id is not None else None
                if lp_id is not None and lp_id in people_card_members:
                    people = people_card_members[lp_id]
                else:
                    people = c.get("people") or []
            expenses = c.get("expenses") or []
            cur_code = c.get("currency") or "USD"
            paid_by  = [0.0] * len(people)   # total each person fronted
            owes     = [0.0] * len(people)   # total each person's fair share
            total_exp = 0.0
            for exp in expenses:
                amt    = float(exp.get("amount") or 0)
                payer  = exp.get("paid_by")
                split  = exp.get("split") or list(range(len(people)))
                total_exp += amt
                if isinstance(payer, int) and 0 <= payer < len(people):
                    paid_by[payer] += amt
                if split:
                    share = amt / len(split)
                    for idx in split:
                        if isinstance(idx, int) and 0 <= idx < len(people):
                            owes[idx] += share
            settle_panels.append({
                "id":             row["id"],
                "title":          row["title"] or "Settle Up",
                "currency":       cur_code,
                "total_expenses": total_exp,
                "people":         people,
                "expenses": [
                    {
                        "desc":     exp.get("desc") or "",
                        "amount":   float(exp.get("amount") or 0),
                        "paid_by":  exp.get("paid_by"),
                        "split":    exp.get("split") or list(range(len(people))),
                        "category": exp.get("category") or "",
                    }
                    for exp in expenses
                ],
                "per_person": [
                    {
                        "idx":     i,
                        "name":    people[i],
                        "paid":    paid_by[i],
                        "owes":    owes[i],
                        "balance": paid_by[i] - owes[i],
                    }
                    for i in range(len(people))
                ],
            })

    return budget_panels, settle_panels


async def _spots_detail(
    page_id: int, user_id: int, plan_id: int | None
) -> list[dict]:
    """Return lightweight spot records for chart drill-down.

    Each spot: {id, name, spot_type, location_name, estimated_cost,
                currency, rating, url, notes}.
    When plan_id is given, only spots assigned to days of that plan.
    """
    async with get_db() as db:
        if plan_id is None:
            cur = await db.execute(
                """
                SELECT s.id, s.name, s.spot_type, l.name AS location_name,
                       s.estimated_cost, s.currency, s.priority,
                       s.cover_url, s.map_url, s.notes
                  FROM trip_spots s
                  LEFT JOIN trip_locations l ON l.id = s.location_id
                 WHERE s.page_id=? AND s.user_id=?
                 ORDER BY s.spot_type, s.estimated_cost DESC
                """,
                (page_id, user_id),
            )
        else:
            cur = await db.execute(
                """
                SELECT DISTINCT s.id, s.name, s.spot_type, l.name AS location_name,
                       s.estimated_cost, s.currency, s.priority,
                       s.cover_url, s.map_url, s.notes
                  FROM trip_spots s
                  LEFT JOIN trip_locations l ON l.id = s.location_id
                  JOIN trip_day_spots tds ON tds.spot_id = s.id
                  JOIN trip_days td       ON td.id = tds.day_id
                 WHERE td.page_id=? AND td.user_id=? AND td.plan_id=?
                 ORDER BY s.spot_type, s.estimated_cost DESC
                """,
                (page_id, user_id, plan_id),
            )
        rows = await cur.fetchall()
    return [
        {
            "id":             r["id"],
            "name":           r["name"],
            "spot_type":      r["spot_type"],
            "location_name":  r["location_name"] or "",
            "estimated_cost": float(r["estimated_cost"]) if r["estimated_cost"] is not None else None,
            "currency":       r["currency"] or "USD",
            "priority":       r["priority"],   # 1=Low 2=Medium 3=High (None = unset)
            "cover_url":      r["cover_url"] or "",
            "map_url":        r["map_url"] or "",
            "notes":          r["notes"] or "",
        }
        for r in rows
    ]


async def get_trip_stats(
    page_id: int, user_id: int, plan_id: int | None = None
) -> dict:
    """Summary stats for Chart tab.

    When plan_id is given, all counts are scoped to spots/days that
    belong to that specific plan only.  The raw_by_type list keeps
    one row per (spot_type, currency) pair so the client can apply
    its own FX conversion without losing precision.
    """
    async with get_db() as db:
        if plan_id is None:
            # ── page-wide counts ──────────────────────────────────────────
            cur = await db.execute(
                "SELECT COUNT(*) FROM trip_locations WHERE page_id=? AND user_id=?",
                (page_id, user_id),
            )
            total_locations = (await cur.fetchone())[0]

            cur = await db.execute(
                "SELECT COUNT(*) FROM trip_spots WHERE page_id=? AND user_id=?",
                (page_id, user_id),
            )
            total_spots = (await cur.fetchone())[0]

            cur = await db.execute(
                "SELECT COUNT(*) FROM trip_days WHERE page_id=? AND user_id=?",
                (page_id, user_id),
            )
            total_days = (await cur.fetchone())[0]

            cur = await db.execute(
                """
                SELECT COUNT(DISTINCT tds.spot_id)
                  FROM trip_day_spots tds
                  JOIN trip_days td ON td.id = tds.day_id
                 WHERE td.page_id=? AND td.user_id=?
                """,
                (page_id, user_id),
            )
            spots_in_plan = (await cur.fetchone())[0]

            cur = await db.execute(
                """
                SELECT spot_type,
                       COUNT(*)            AS cnt,
                       SUM(estimated_cost) AS total_cost,
                       currency
                  FROM trip_spots
                 WHERE page_id=? AND user_id=?
                 GROUP BY spot_type, currency
                 ORDER BY cnt DESC
                """,
                (page_id, user_id),
            )
        else:
            # ── plan-scoped counts: only spots assigned to days of this plan ──
            cur = await db.execute(
                """
                SELECT COUNT(DISTINCT s.location_id)
                  FROM trip_spots s
                  JOIN trip_day_spots tds ON tds.spot_id = s.id
                  JOIN trip_days td       ON td.id = tds.day_id
                 WHERE td.page_id=? AND td.user_id=? AND td.plan_id=?
                """,
                (page_id, user_id, plan_id),
            )
            total_locations = (await cur.fetchone())[0]

            cur = await db.execute(
                """
                SELECT COUNT(DISTINCT tds.spot_id)
                  FROM trip_day_spots tds
                  JOIN trip_days td ON td.id = tds.day_id
                 WHERE td.page_id=? AND td.user_id=? AND td.plan_id=?
                """,
                (page_id, user_id, plan_id),
            )
            total_spots = (await cur.fetchone())[0]

            cur = await db.execute(
                "SELECT COUNT(*) FROM trip_days WHERE page_id=? AND user_id=? AND plan_id=?",
                (page_id, user_id, plan_id),
            )
            total_days = (await cur.fetchone())[0]

            spots_in_plan = total_spots   # by definition when plan-filtered

            cur = await db.execute(
                """
                SELECT s.spot_type            AS spot_type,
                       COUNT(DISTINCT s.id)   AS cnt,
                       SUM(s.estimated_cost)  AS total_cost,
                       s.currency             AS currency
                  FROM trip_spots s
                  JOIN trip_day_spots tds ON tds.spot_id = s.id
                  JOIN trip_days td       ON td.id = tds.day_id
                 WHERE td.page_id=? AND td.user_id=? AND td.plan_id=?
                 GROUP BY s.spot_type, s.currency
                 ORDER BY cnt DESC
                """,
                (page_id, user_id, plan_id),
            )

        by_type_rows = await cur.fetchall()

    # ── build raw list (one row per type+currency) for client-side FX ──────
    raw_by_type = [
        {
            "spot_type":  r["spot_type"],
            "currency":   r["currency"] or "USD",
            "count":      r["cnt"],
            "total_cost": float(r["total_cost"] or 0),
        }
        for r in by_type_rows
    ]

    # ── legacy merged view (per spot_type, first currency wins) ────────────
    type_map: dict[str, dict] = {}
    for r in raw_by_type:
        st = r["spot_type"]
        if st not in type_map:
            type_map[st] = {"spot_type": st, "count": 0, "total_cost": 0.0,
                            "currency": r["currency"]}
        type_map[st]["count"]      += r["count"]
        type_map[st]["total_cost"] += r["total_cost"]

    currencies = {r["currency"] for r in raw_by_type if r["total_cost"]}
    grand_total: float | None = None
    grand_currency = ""
    if len(currencies) == 1:
        grand_currency = next(iter(currencies))
        grand_total = sum(t["total_cost"] for t in type_map.values())

    budget_panels, settle_panels = await _panel_summaries(page_id, user_id, plan_id)
    spots_detail                  = await _spots_detail(page_id, user_id, plan_id)

    # Override ceiling for budget panels that pull from spot estimates.
    # Build a cost map: spot_type -> total estimated cost (in spot's own currency).
    # We do a simple same-currency sum here; FX conversion happens client-side.
    spot_cost_by_type: dict[str, float] = {}
    spot_currency_by_type: dict[str, str] = {}
    for s in spots_detail:
        if s["estimated_cost"] is not None:
            t = s["spot_type"]
            spot_cost_by_type[t]     = spot_cost_by_type.get(t, 0) + s["estimated_cost"]
            spot_currency_by_type[t] = s["currency"]   # last-seen currency per type

    for bp in budget_panels:
        if bp["ceiling_source"] == "spots" and bp["spot_types"]:
            derived = sum(
                spot_cost_by_type.get(st, 0)
                for st in bp["spot_types"]
            )
            bp["ceiling"] = derived
            # Expose which currency the spots are in (for display hint)
            bp["ceiling_currency_hint"] = (
                spot_currency_by_type.get(bp["spot_types"][0], bp["currency"])
                if bp["spot_types"] else bp["currency"]
            )
        else:
            bp["ceiling_currency_hint"] = bp["currency"]

    return {
        "total_locations":  total_locations,
        "total_spots":      total_spots,
        "total_days":       total_days,
        "spots_in_plan":    spots_in_plan,
        "grand_total":      grand_total,
        "grand_currency":   grand_currency,
        "mixed_currencies": len(currencies) > 1,
        "currencies":       sorted(currencies),
        "by_type":          list(type_map.values()),
        "raw_by_type":      raw_by_type,
        "budget_panels":    budget_panels,
        "settle_panels":    settle_panels,
        "spots_detail":     spots_detail,
    }


# ── Push notification helper ─────────────────────────────────────────────────────

import json as _json


async def get_due_trip_reminders() -> list[dict]:
    """Return itinerary reminder blocks whose reminder_at has arrived.

    Compares reminder_at (stored as local 'YYYY-MM-DDTHH:MM') against the
    server's current local datetime so that reminders fire at the correct
    wall-clock time on the host machine.

    Returns one row per (block, push_subscription) pair so a user with
    multiple devices gets a notification on each.

    Dedup key: "trip_block:{block_id}:{reminder_at}" — changing the time
    clears the old dedup record and lets the new time fire fresh.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT tdb.id          AS block_id,
                   tdb.reminder_at,
                   tdb.content,
                   td.day_label,
                   td.day_date,
                   tp.name        AS trip_name,
                   hp.user_id,
                   ps.endpoint, ps.p256dh, ps.auth
            FROM   trip_day_blocks tdb
            JOIN   trip_days       td  ON td.id      = tdb.day_id
            JOIN   trip_plans      tp  ON tp.id      = td.plan_id
            JOIN   home_pages      hp  ON hp.id      = tp.page_id
            JOIN   push_subscriptions ps ON ps.user_id = hp.user_id
            WHERE  tdb.block_type = 'reminder'
              AND  tdb.reminder_at IS NOT NULL
              AND  tdb.reminder_at <= strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')
            """
        )
        rows = await cur.fetchall()
    result = []
    for r in rows:
        try:
            c = _json.loads(r["content"] or "{}")
        except Exception:
            c = {}
        result.append({
            "block_id":   r["block_id"],
            "reminder_at": r["reminder_at"],
            "title":      c.get("title", "Trip reminder"),
            "day_label":  r["day_label"] or "",
            "trip_name":  r["trip_name"] or "",
            "user_id":    r["user_id"],
            "endpoint":   r["endpoint"],
            "p256dh":     r["p256dh"],
            "auth":       r["auth"],
            "dedup_key":  f"trip_block:{r['block_id']}:{r['reminder_at']}",
        })
    return result