"""DB helpers for the Buds friendship-health-tracker widget.

All functions are async and use get_db() exclusively.
Health decay is computed on read — never written back on GET.
"""
from __future__ import annotations

import datetime
import logging
from typing import Any

from database import get_db

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
_LOSS_PER_INTERVAL = 25.0   # HP lost for missing one full seeEveryDays interval
_WATER_HP          = 10.0   # HP gained from weekly water action
_FERTILIZE_HP      = 25.0   # HP gained from completing an in-person visit

VALID_SPECIES = {
    "blue_flower", "calla", "daffodil", "daisy",
    "pink", "purple", "sunflower", "tulip",
}


# ── Pure helpers ──────────────────────────────────────────────────────────────

def _apply_decay(health: float, see_every_days: int,
                 health_updated_at: str) -> float:
    """Return current health after applying daily decay since health_updated_at."""
    try:
        anchor = datetime.date.fromisoformat(health_updated_at)
    except (ValueError, TypeError):
        return health
    days_elapsed = (datetime.date.today() - anchor).days
    if days_elapsed <= 0:
        return health
    loss_per_day = _LOSS_PER_INTERVAL / max(see_every_days, 1)
    decayed = health - (loss_per_day * days_elapsed)
    return round(max(0.0, min(100.0, decayed)), 2)


def _health_tier(health: float) -> int:
    """0=healthy(≥70), 1=warn(50–69), 2=wilting(<50)."""
    if health >= 70:
        return 0
    if health >= 50:
        return 1
    return 2


def _week_key(d: datetime.date | None = None) -> str:
    """Return 'YYYY-Www' for Monday-anchored ISO week."""
    d = d or datetime.date.today()
    iso = d.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _bud_dict(row: Any) -> dict:
    """Convert a DB row to a dict."""
    return dict(row)


# ── List / read ───────────────────────────────────────────────────────────────

async def list_buds(widget_id: int, user_id: int) -> list[dict]:
    """Return all buds for a widget with live-decayed health + pending plan."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM buds WHERE widget_id=? AND user_id=? "
            "ORDER BY sort_order, id",
            (widget_id, user_id),
        )
        rows = await cur.fetchall()

    buds = []
    for row in rows:
        b = dict(row)
        b["health"] = _apply_decay(b["health"], b["see_every_days"],
                                   b["health_updated_at"])
        b["health_tier"] = _health_tier(b["health"])
        b["pending_plan"] = await _get_pending_plan(b["id"], user_id)
        buds.append(b)
    return buds


async def _get_pending_plan(bud_id: int, user_id: int) -> dict | None:
    """Return the most recent pending fertilize plan, or None."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM bud_fertilize_plans "
            "WHERE bud_id=? AND user_id=? AND completed_at IS NULL "
            "ORDER BY planned_date LIMIT 1",
            (bud_id, user_id),
        )
        row = await cur.fetchone()
    return dict(row) if row else None


# ── Add / update / delete ─────────────────────────────────────────────────────

async def add_bud(
    widget_id: int, user_id: int,
    name: str, flower_species: str, see_every_days: int,
    notes: str = "", crm_contact_id: int | None = None,
) -> dict:
    """Insert a new bud and return it."""
    species = flower_species if flower_species in VALID_SPECIES else "daisy"
    today = datetime.date.today().isoformat()
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO buds "
            "(widget_id, user_id, name, flower_species, see_every_days, "
            " health, health_updated_at, notes, crm_contact_id) "
            "VALUES (?,?,?,?,?,100.0,?,?,?)",
            (widget_id, user_id, name.strip(), species,
             max(1, int(see_every_days)), today,
             notes.strip() if notes else None,
             crm_contact_id),
        )
        await db.commit()
        bud_id = cur.lastrowid
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM buds WHERE id=?", (bud_id,))
        row = await cur.fetchone()
    b = dict(row)
    b["health_tier"] = _health_tier(b["health"])
    b["pending_plan"] = None
    return b


async def update_bud(bud_id: int, user_id: int, **fields) -> dict | None:
    """Update allowed fields on a bud. Returns updated bud dict or None."""
    allowed = {"name", "flower_species", "see_every_days", "notes"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return None
    if "flower_species" in updates:
        updates["flower_species"] = (
            updates["flower_species"] if updates["flower_species"] in VALID_SPECIES
            else "daisy"
        )
    if "see_every_days" in updates:
        updates["see_every_days"] = max(1, int(updates["see_every_days"]))
    set_clause = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [bud_id, user_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE buds SET {set_clause} WHERE id=? AND user_id=?", vals
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM buds WHERE id=? AND user_id=?",
                               (bud_id, user_id))
        row = await cur.fetchone()
    if not row:
        return None
    b = dict(row)
    b["health"] = _apply_decay(b["health"], b["see_every_days"],
                               b["health_updated_at"])
    b["health_tier"] = _health_tier(b["health"])
    b["pending_plan"] = await _get_pending_plan(bud_id, user_id)
    return b


async def delete_bud(bud_id: int, user_id: int) -> bool:
    """Delete a bud. Returns True if deleted."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM buds WHERE id=? AND user_id=?", (bud_id, user_id)
        )
        await db.commit()
    return (cur.rowcount or 0) > 0


# ── Care actions ──────────────────────────────────────────────────────────────

async def water_bud(bud_id: int, user_id: int) -> dict:
    """Apply water (+10 HP). Once per day cooldown."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM buds WHERE id=? AND user_id=?", (bud_id, user_id)
        )
        row = await cur.fetchone()
    if not row:
        raise LookupError("bud not found")
    b = dict(row)
    today = datetime.date.today().isoformat()
    if b.get("last_watered_week") == today:
        raise ValueError("already_watered_today")
    decayed_health = _apply_decay(b["health"], b["see_every_days"],
                                  b["health_updated_at"])
    new_health = min(100.0, round(decayed_health + _WATER_HP, 2))
    async with get_db() as db:
        await db.execute(
            "UPDATE buds SET health=?, health_updated_at=?, last_watered_week=? "
            "WHERE id=? AND user_id=?",
            (new_health, today, today, bud_id, user_id),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM buds WHERE id=?", (bud_id,))
        row = await cur.fetchone()
    b = dict(row)
    b["health_tier"] = _health_tier(b["health"])
    b["pending_plan"] = await _get_pending_plan(bud_id, user_id)
    return b


async def create_fertilize_plan(
    bud_id: int, user_id: int, planned_date: str, note: str = ""
) -> dict:
    """Create (or replace) a pending fertilize plan."""
    # cancel any existing pending plan first
    async with get_db() as db:
        await db.execute(
            "DELETE FROM bud_fertilize_plans "
            "WHERE bud_id=? AND user_id=? AND completed_at IS NULL",
            (bud_id, user_id),
        )
        cur = await db.execute(
            "INSERT INTO bud_fertilize_plans (bud_id, user_id, planned_date, note) "
            "VALUES (?,?,?,?)",
            (bud_id, user_id, planned_date, note.strip() if note else None),
        )
        await db.commit()
        plan_id = cur.lastrowid
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM bud_fertilize_plans WHERE id=?", (plan_id,)
        )
        row = await cur.fetchone()
    return dict(row)


async def complete_fertilize_plan(
    plan_id: int, bud_id: int, user_id: int
) -> dict:
    """Mark a fertilize plan complete and apply +25 HP to the bud."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM bud_fertilize_plans "
            "WHERE id=? AND bud_id=? AND user_id=? AND completed_at IS NULL",
            (plan_id, bud_id, user_id),
        )
        plan_row = await cur.fetchone()
    if not plan_row:
        raise LookupError("plan not found or already completed")
    now = datetime.datetime.utcnow().isoformat()
    today = datetime.date.today().isoformat()
    async with get_db() as db:
        # mark plan done
        await db.execute(
            "UPDATE bud_fertilize_plans SET completed_at=? WHERE id=?",
            (now, plan_id),
        )
        # apply health boost
        bud_cur = await db.execute(
            "SELECT health, see_every_days, health_updated_at FROM buds "
            "WHERE id=? AND user_id=?",
            (bud_id, user_id),
        )
        bud_row = await bud_cur.fetchone()
        if bud_row:
            decayed = _apply_decay(bud_row["health"], bud_row["see_every_days"],
                                   bud_row["health_updated_at"])
            new_hp = min(100.0, round(decayed + _FERTILIZE_HP, 2))
            await db.execute(
                "UPDATE buds SET health=?, health_updated_at=? "
                "WHERE id=? AND user_id=?",
                (new_hp, today, bud_id, user_id),
            )
        await db.commit()
    async with get_db() as db:
        cur = await db.execute("SELECT * FROM buds WHERE id=?", (bud_id,))
        row = await cur.fetchone()
    b = dict(row)
    b["health_tier"] = _health_tier(b["health"])
    b["pending_plan"] = await _get_pending_plan(bud_id, user_id)
    return b


# ── CRM integration ───────────────────────────────────────────────────────────

async def crm_lookup(crm_page_id: int, user_id: int) -> dict:
    """Return {contact_id: {health, species, tier, widget_id, bud_id}} map."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT b.id, b.crm_contact_id, b.health, b.see_every_days, "
            "       b.health_updated_at, b.flower_species, b.widget_id "
            "FROM buds b "
            "WHERE b.crm_contact_id IN "
            "  (SELECT id FROM crm_contacts WHERE page_id=? AND user_id=?) "
            "AND b.user_id=?",
            (crm_page_id, user_id, user_id),
        )
        rows = await cur.fetchall()
    result = {}
    for row in rows:
        r = dict(row)
        health = _apply_decay(r["health"], r["see_every_days"],
                              r["health_updated_at"])
        cid = str(r["crm_contact_id"])
        result[cid] = {
            "health":    round(health, 1),
            "species":   r["flower_species"],
            "tier":      _health_tier(health),
            "widget_id": r["widget_id"],
            "bud_id":    r["id"],
        }
    return result


async def get_user_buds_widgets(user_id: int) -> list[dict]:
    """Return [{widget_id, page_name, widget_name}] for all user's Buds widgets."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT hw.id as widget_id, hp.name as page_name, "
            "       hw.config_json "
            "FROM home_widgets hw "
            "JOIN home_pages hp ON hp.id = hw.page_id "
            "WHERE hw.widget_type='buds' AND hp.user_id=? "
            "ORDER BY hp.sort_order, hw.id",
            (user_id,),
        )
        rows = await cur.fetchall()
    import json
    result = []
    for row in rows:
        r = dict(row)
        cfg = {}
        try:
            cfg = json.loads(r["config_json"] or "{}")
        except Exception:
            pass
        result.append({
            "widget_id":   r["widget_id"],
            "page_name":   r["page_name"],
            "widget_name": cfg.get("custom_name") or "Buds",
        })
    return result
