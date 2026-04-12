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
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "INSERT INTO crm_contacts "
            "(page_id, user_id, name, email, phone, company, tags, avatar_emoji) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (page_id, user_id, name, email, phone, company, tags, avatar_emoji),
        )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def update_contact(
    contact_id: int, page_id: int, user_id: int,
    name: str, email: str, phone: str,
    company: str, tags: str, avatar_emoji: str,
) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "UPDATE crm_contacts SET name=?,email=?,phone=?,company=?,tags=?,avatar_emoji=? "
            "WHERE id=? AND page_id=? AND user_id=?",
            (name, email, phone, company, tags, avatar_emoji, contact_id, page_id, user_id),
        )
        await db.commit()
    return await get_contacts(page_id, user_id)


async def delete_contact(contact_id: int, page_id: int, user_id: int) -> list[dict]:
    async with get_db() as db:
        await db.execute(
            "DELETE FROM crm_contacts WHERE id=? AND page_id=? AND user_id=?",
            (contact_id, page_id, user_id),
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
