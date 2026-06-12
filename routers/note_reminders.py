"""note_reminders.py — API for note inline reminders set via /reminder slash command.

Endpoints (all under /home prefix via main.py include):
  POST /home/note-reminders/add   — save a reminder tied to a note
  GET  /home/note-reminders/due   — return today's due reminders for the user
  POST /home/note-reminders/{rid}/dismiss — mark a reminder as fired/dismissed
"""
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from database import get_db

log = logging.getLogger(__name__)
router = APIRouter(prefix="/home")


def _uid(req: Request) -> int:
    uid = req.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    return uid


def _err(msg: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status)


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _add_note_reminder(
    user_id: int,
    note_id: int | None,
    label: str,
    reminder_date: str,
    reminder_time: str,
    message: str = "",
) -> int:
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO note_reminders
                (user_id, note_id, label, reminder_date, reminder_time, message)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, note_id, label, reminder_date, reminder_time, message),
        )
        await db.commit()
        return cur.lastrowid


async def _get_due_note_reminders(user_id: int, date_str: str) -> list[dict]:
    """Return all unfired note reminders for this user on the given date."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT id, note_id, label, reminder_date, reminder_time, message
            FROM   note_reminders
            WHERE  user_id = ?
              AND  reminder_date = ?
              AND  fired = 0
            ORDER BY reminder_time
            """,
            (user_id, date_str),
        )
        rows = await cur.fetchall()
    return [
        {
            "id":            r[0],
            "note_id":       r[1],
            "label":         r[2],
            "reminder_date": r[3],
            "reminder_time": r[4],
            "message":       r[5] or "",
        }
        for r in rows
    ]


async def _dismiss_note_reminder(user_id: int, reminder_id: int) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "UPDATE note_reminders SET fired=1 WHERE id=? AND user_id=?",
            (reminder_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/note-reminders/add")
async def add_note_reminder(request: Request):
    """Save a reminder. Body: note_id (int|null), label, reminder_date, reminder_time."""
    try:
        uid  = _uid(request)
        body = await request.json()
        date_str = str(body.get("reminder_date", "")).strip()
        time_str = str(body.get("reminder_time", "09:00")).strip()
        label    = str(body.get("label", "")).strip() or date_str
        raw_nid  = body.get("note_id")
        note_id  = int(raw_nid) if raw_nid is not None else None
        message  = str(body.get("message", "")).strip()

        if len(date_str) != 10:
            return _err("invalid reminder_date")

        rid = await _add_note_reminder(uid, note_id, label, date_str, time_str, message)
        return JSONResponse({"id": rid, "ok": True})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception:
        log.exception("add_note_reminder")
        return _err("server error", 500)


@router.get("/note-reminders/due")
async def note_reminders_due(request: Request, date: str = ""):
    """Return unfired reminders for the given date (defaults to today)."""
    import datetime
    try:
        uid      = _uid(request)
        date_str = date.strip()
        if len(date_str) != 10:
            date_str = datetime.date.today().isoformat()
        items = await _get_due_note_reminders(uid, date_str)
        return JSONResponse(items)
    except PermissionError:
        return _err("not logged in", 401)
    except Exception:
        log.exception("note_reminders_due")
        return _err("server error", 500)


@router.post("/note-reminders/{reminder_id}/dismiss")
async def dismiss_note_reminder(request: Request, reminder_id: int):
    """Mark a reminder as fired so it won't fire again."""
    try:
        uid = _uid(request)
        ok  = await _dismiss_note_reminder(uid, reminder_id)
        return JSONResponse({"ok": ok})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception:
        log.exception("dismiss_note_reminder reminder_id=%s", reminder_id)
        return _err("server error", 500)


@router.patch("/note-reminders/{reminder_id}")
async def update_note_reminder(request: Request, reminder_id: int):
    """Update an existing reminder's date, time, label, and/or message.
    Resets fired=0 so the updated reminder fires at the new time.
    """
    try:
        uid  = _uid(request)
        body = await request.json()
        date_str = str(body.get("reminder_date", "")).strip()
        time_str = str(body.get("reminder_time", "09:00")).strip()
        label    = str(body.get("label", "")).strip()
        message  = str(body.get("message", "")).strip()

        if len(date_str) != 10:
            return _err("invalid reminder_date")

        async with get_db() as db:
            cur = await db.execute(
                """
                UPDATE note_reminders
                   SET reminder_date = ?,
                       reminder_time = ?,
                       label         = ?,
                       message       = ?,
                       fired         = 0
                 WHERE id = ? AND user_id = ?
                """,
                (date_str, time_str, label, message, reminder_id, uid),
            )
            await db.commit()
            if cur.rowcount == 0:
                return _err("reminder not found", 404)
        return JSONResponse({"ok": True})
    except PermissionError:
        return _err("not logged in", 401)
    except Exception:
        log.exception("update_note_reminder reminder_id=%s", reminder_id)
        return _err("server error", 500)
