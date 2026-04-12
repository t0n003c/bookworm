"""DB helpers for the CRM Homespace page type.

Tables:
    crm_contacts            -- one record per contact, scoped to a CRM page
    crm_custom_fields       -- field definitions defined per CRM page
    crm_contact_field_values -- per-contact values for each custom field

ALL access via get_db() -- never raw aiosqlite.connect().
"""
from __future__ import annotations
from database import get_db


# ── Internal helpers ───────────────────────────────────────────────────────────

def _row(r) -> dict:
    return dict(r) if r else {}


async def _attach_field_values(contacts: list[dict], page_id: int) -> list[dict]:
    """Attach custom field values to each contact (single JOIN query, not N+1)."""
    if not contacts:
        return contacts
    contact_ids = [c["id"] for c in contacts]
    placeholders = ",".join("?" * len(contact_ids))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT contact_id, field_id, value FROM crm_contact_field_values "
            f"WHERE contact_id IN ({placeholders})",
            contact_ids,
        )
        rows = await cur.fetchall()
    # Build lookup: {contact_id: {field_id: value}}
    lookup: dict[int, dict[int, str]] = {}
    for r in rows:
        lookup.setdefault(r["contact_id"], {})[r["field_id"]] = r["value"]
    for c in contacts:
        c["field_values"] = lookup.get(c["id"], {})
    return contacts


# ── Contacts ──────────────────────────────────────────────────────────────────

async def get_contacts(page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM crm_contacts WHERE page_id=? AND user_id=? "
            "ORDER BY sort_order, id",
            (page_id, user_id),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    return await _attach_field_values(rows, page_id)


async def add_contact(
    page_id: int, user_id: int,
    name: str, email: str, phone: str,
    company: str, tags: str, avatar_emoji: str,
    profile_pic: str = "",
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "INSERT INTO crm_contacts "
            "(page_id, user_id, name, email, phone, company, tags, avatar_emoji, profile_pic) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (page_id, user_id, name, email, phone, company, tags, avatar_emoji, profile_pic),
        )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def update_contact(
    contact_id: int, page_id: int, user_id: int,
    name: str, email: str, phone: str,
    company: str, tags: str, avatar_emoji: str,
    profile_pic: str = "",
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_contacts "
            "SET name=?,email=?,phone=?,company=?,tags=?,avatar_emoji=?,profile_pic=? "
            "WHERE id=? AND page_id=? AND user_id=?",
            (name, email, phone, company, tags, avatar_emoji, profile_pic,
             contact_id, page_id, user_id),
        )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def update_contact_pic(
    contact_id: int, page_id: int, user_id: int, pic_url: str
) -> None:
    """Update profile_pic only — used by the dedicated upload endpoint."""
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_contacts SET profile_pic=? WHERE id=? AND page_id=? AND user_id=?",
            (pic_url, contact_id, page_id, user_id),
        )
        await db.commit()


async def delete_contact(contact_id: int, page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_contacts WHERE id=? AND page_id=? AND user_id=?",
            (contact_id, page_id, user_id),
        )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def reorder_contacts(
    page_id: int, user_id: int, ordered_ids: list[int],
) -> list[dict]:
    """Persist gallery card order by writing sort_order for each contact ID."""
    async with get_db() as db:
        for i, cid in enumerate(ordered_ids):
            await db.execute(
                "UPDATE crm_contacts SET sort_order=? WHERE id=? AND page_id=? AND user_id=?",
                (i, cid, page_id, user_id),
            )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def upsert_field_value(contact_id: int, field_id: int, value: str) -> bool:
    async with get_db() as db:
        await db.execute(
            "INSERT INTO crm_contact_field_values (contact_id, field_id, value) "
            "VALUES (?,?,?) ON CONFLICT(contact_id, field_id) DO UPDATE SET value=excluded.value",
            (contact_id, field_id, value),
        )
        await db.commit()
    return True


# ── Custom field definitions ───────────────────────────────────────────────────

async def get_fields(page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM crm_custom_fields WHERE page_id=? AND user_id=? "
            "ORDER BY sort_order, id",
            (page_id, user_id),
        )
        return [dict(r) for r in await cur.fetchall()]


async def add_field(
    page_id: int, user_id: int,
    label: str, field_type: str, options: str,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "INSERT INTO crm_custom_fields (page_id, user_id, label, field_type, options) "
            "VALUES (?,?,?,?,?)",
            (page_id, user_id, label, field_type, options),
        )
        await db.commit()
    return await get_fields(page_id, user_id)


async def update_field(
    field_id: int, page_id: int, user_id: int,
    label: str, field_type: str, options: str,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_custom_fields SET label=?,field_type=?,options=? "
            "WHERE id=? AND page_id=? AND user_id=?",
            (label, field_type, options, field_id, page_id, user_id),
        )
        await db.commit()
    return await get_fields(page_id, user_id)


async def delete_field(field_id: int, page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_custom_fields WHERE id=? AND page_id=? AND user_id=?",
            (field_id, page_id, user_id),
        )
        await db.commit()
    return await get_fields(page_id, user_id)


# ── Stages (Phase 2) ─────────────────────────────────────────────────────────

async def get_stages(page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT * FROM crm_stages WHERE page_id=? AND user_id=? ORDER BY sort_order, id",
            (page_id, user_id),
        )
        return [dict(r) for r in await cur.fetchall()]


async def add_stage(
    page_id: int, user_id: int, name: str, color: str,
) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM crm_stages WHERE page_id=? AND user_id=?",
            (page_id, user_id),
        )
        row = await cur.fetchone()
        sort_order = row[0] if row else 1
        await db.execute(
            "INSERT INTO crm_stages (page_id, user_id, name, color, sort_order) VALUES (?,?,?,?,?)",
            (page_id, user_id, name, color, sort_order),
        )
        await db.commit()
    return await get_stages(page_id, user_id)


async def update_stage(
    stage_id: int, page_id: int, user_id: int, name: str, color: str,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_stages SET name=?,color=? WHERE id=? AND page_id=? AND user_id=?",
            (name, color, stage_id, page_id, user_id),
        )
        await db.commit()
    return await get_stages(page_id, user_id)


async def delete_stage(stage_id: int, page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_stages WHERE id=? AND page_id=? AND user_id=?",
            (stage_id, page_id, user_id),
        )
        await db.commit()
    return await get_stages(page_id, user_id)


async def reorder_stages(
    page_id: int, user_id: int, ordered_ids: list[int],
) -> list[dict]:
    async with get_db() as db:
        for i, sid in enumerate(ordered_ids):
            await db.execute(
                "UPDATE crm_stages SET sort_order=? WHERE id=? AND page_id=? AND user_id=?",
                (i, sid, page_id, user_id),
            )
        await db.commit()
    return await get_stages(page_id, user_id)


# ── Deals (Phase 2) ──────────────────────────────────────────────────────────

async def get_deals(page_id: int, user_id: int) -> list[dict]:
    """Deals joined with contact name for display. stage_id may be NULL."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT d.*, c.name AS contact_name
            FROM crm_deals d
            LEFT JOIN crm_contacts c ON c.id = d.contact_id
            WHERE d.page_id=? AND d.user_id=?
            ORDER BY d.stage_id, d.sort_order, d.id
            """,
            (page_id, user_id),
        )
        return [dict(r) for r in await cur.fetchall()]


async def add_deal(
    page_id: int, user_id: int,
    stage_id: int | None, contact_id: int | None,
    title: str, value: float,
) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order),0)+1 FROM crm_deals WHERE page_id=? AND stage_id IS ?",
            (page_id, stage_id),
        )
        row = await cur.fetchone()
        sort_order = row[0] if row else 1
        await db.execute(
            "INSERT INTO crm_deals (page_id, user_id, stage_id, contact_id, title, value, sort_order) "
            "VALUES (?,?,?,?,?,?,?)",
            (page_id, user_id, stage_id, contact_id, title, value, sort_order),
        )
        await db.commit()
    return await get_deals(page_id, user_id)


async def update_deal(
    deal_id: int, page_id: int, user_id: int,
    title: str, value: float, contact_id: int | None,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_deals SET title=?,value=?,contact_id=? "
            "WHERE id=? AND page_id=? AND user_id=?",
            (title, value, contact_id, deal_id, page_id, user_id),
        )
        await db.commit()
    return await get_deals(page_id, user_id)


async def move_deal(
    deal_id: int, page_id: int, user_id: int,
    stage_id: int | None, sort_order: int,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_deals SET stage_id=?,sort_order=? WHERE id=? AND page_id=? AND user_id=?",
            (stage_id, sort_order, deal_id, page_id, user_id),
        )
        await db.commit()
    return await get_deals(page_id, user_id)


async def delete_deal(deal_id: int, page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_deals WHERE id=? AND page_id=? AND user_id=?",
            (deal_id, page_id, user_id),
        )
        await db.commit()
    return await get_deals(page_id, user_id)


# ── Contact Reminders ─────────────────────────────────────────────────────────────────────

async def get_contact_reminders(contact_id: int) -> list[dict]:
    """Return all reminders for a contact ordered by date then time."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, contact_id, field_id, label, message, reminder_date, reminder_time, created_at"
            " FROM crm_contact_reminders"
            " WHERE contact_id=?"
            " ORDER BY reminder_date, reminder_time",
            (contact_id,),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def add_contact_reminder(
    contact_id: int,
    field_id: int,
    user_id: int,
    label: str,
    reminder_date: str,
    reminder_time: str,
    message: str = "",
) -> list[dict]:
    """Insert a reminder and return the updated list for this contact."""
    async with get_db() as db:
        await db.execute(
            "INSERT INTO crm_contact_reminders"
            " (contact_id, field_id, user_id, label, message, reminder_date, reminder_time)"
            " VALUES (?,?,?,?,?,?,?)",
            (contact_id, field_id, user_id, label, message, reminder_date, reminder_time),
        )
        await db.commit()
    return await get_contact_reminders(contact_id)


async def delete_contact_reminder(reminder_id: int, contact_id: int) -> list[dict]:
    """Delete a reminder (validates contact ownership) and return updated list."""
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_contact_reminders WHERE id=? AND contact_id=?",
            (reminder_id, contact_id),
        )
        await db.commit()
    return await get_contact_reminders(contact_id)


async def get_due_crm_reminders(user_id: int, date_str: str) -> list[dict]:
    """Return all of a user's reminders scheduled for date_str, with contact name."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT r.id, r.contact_id, c.name AS contact_name,"
            " r.field_id, r.label, r.message, r.reminder_date, r.reminder_time"
            " FROM crm_contact_reminders r"
            " JOIN crm_contacts c ON c.id = r.contact_id"
            " WHERE r.user_id=? AND r.reminder_date=?"
            " ORDER BY r.reminder_time",
            (user_id, date_str),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]
