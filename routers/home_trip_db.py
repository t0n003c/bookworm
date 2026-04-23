"""Trip Planning homespace page — DB helper functions.

All functions use get_db(); never raw aiosqlite.connect().
get_db() enforces PRAGMA foreign_keys=ON, WAL, busy_timeout=5000.
"""
from __future__ import annotations

from database import get_db


# ── Spot helpers ──────────────────────────────────────────────────────────────

def _spot_row(r) -> dict:
    return {
        "id":             r["id"],
        "page_id":        r["page_id"],
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
    }


async def get_trip_spots(
    page_id: int,
    user_id: int,
    spot_type: str | None = None,
) -> list[dict]:
    """Return all spots for page_id, optionally filtered by spot_type."""
    async with get_db() as db:
        if spot_type:
            cur = await db.execute(
                """
                SELECT * FROM trip_spots
                 WHERE page_id=? AND user_id=? AND spot_type=?
                 ORDER BY sort_order, id
                """,
                (page_id, user_id, spot_type),
            )
        else:
            cur = await db.execute(
                """
                SELECT * FROM trip_spots
                 WHERE page_id=? AND user_id=?
                 ORDER BY sort_order, id
                """,
                (page_id, user_id),
            )
        rows = await cur.fetchall()
    return [_spot_row(r) for r in rows]


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
) -> int:
    """INSERT a new spot; return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_spots
              (page_id, user_id, name, spot_type, cover_url,
               map_url, notes, priority, estimated_cost, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,
            (page_id, user_id, name, spot_type, cover_url,
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
) -> bool:
    """UPDATE spot with ownership guard. Returns True on success."""
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE trip_spots
               SET name=?, spot_type=?, cover_url=?, map_url=?,
                   notes=?, priority=?, estimated_cost=?, currency=?
             WHERE id=? AND page_id=? AND user_id=?
            """,
            (name, spot_type, cover_url, map_url,
             notes, priority, estimated_cost, currency,
             spot_id, page_id, user_id),
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


# ── Day helpers ───────────────────────────────────────────────────────────────

async def get_trip_days(page_id: int, user_id: int) -> list[dict]:
    """Return all days with nested spots — single JOIN query, no N+1."""
    async with get_db() as db:
        cur = await db.execute(
            """
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
             WHERE td.page_id=? AND td.user_id=?
             ORDER BY td.sort_order, td.id, tds.sort_order
            """,
            (page_id, user_id),
        )
        rows = await cur.fetchall()

    days: dict[int, dict] = {}
    for r in rows:
        did = r["day_id"]
        if did not in days:
            days[did] = {
                "id":        did,
                "day_label": r["day_label"],
                "day_date":  r["day_date"],
                "sort_order": r["day_sort"],
                "spots":     [],
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
    page_id: int, user_id: int, day_label: str, day_date: str | None
) -> int:
    """INSERT a new day; return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO trip_days (page_id, user_id, day_label, day_date, sort_order)
            VALUES (?, ?, ?, ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 10
                 FROM trip_days WHERE page_id=?))
            """,
            (page_id, user_id, day_label, day_date or None, page_id),
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


# ── Stats helper ──────────────────────────────────────────────────────────────

async def get_trip_stats(page_id: int, user_id: int) -> dict:
    """Summary stats for Chart tab."""
    async with get_db() as db:
        # Total spots
        cur = await db.execute(
            "SELECT COUNT(*) FROM trip_spots WHERE page_id=? AND user_id=?",
            (page_id, user_id),
        )
        total_spots = (await cur.fetchone())[0]

        # Total days
        cur = await db.execute(
            "SELECT COUNT(*) FROM trip_days WHERE page_id=? AND user_id=?",
            (page_id, user_id),
        )
        total_days = (await cur.fetchone())[0]

        # Spots in plan
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

        # By type — count + cost
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
        by_type_rows = await cur.fetchall()

    # Check for mixed currencies
    currencies = {r["currency"] for r in by_type_rows if r["estimated_cost"]}
    currency_note = "" if len(currencies) <= 1 else "mixed currencies"

    # Aggregate by type (sum costs; flag mixed)
    type_map: dict[str, dict] = {}
    for r in by_type_rows:
        st = r["spot_type"]
        if st not in type_map:
            type_map[st] = {"spot_type": st, "count": 0, "total_cost": 0.0,
                            "currency": r["currency"]}
        type_map[st]["count"] += r["cnt"]
        type_map[st]["total_cost"] += r["total_cost"] or 0.0

    # Grand total — only if single currency
    grand_total: float | None = None
    grand_currency = ""
    if len(currencies) == 1:
        grand_currency = next(iter(currencies))
        grand_total = sum(t["total_cost"] for t in type_map.values())

    return {
        "total_spots":    total_spots,
        "total_days":     total_days,
        "spots_in_plan":  spots_in_plan,
        "grand_total":    grand_total,
        "grand_currency": grand_currency,
        "currency_note":  currency_note,
        "by_type":        list(type_map.values()),
    }
