"""push_db.py — Web Push subscription CRUD and send_push helper.

All push subscriptions are stored in `push_subscriptions`.
send_push() is a thin async wrapper around pywebpush's synchronous webpush()
call, run in a thread pool so it never blocks the uvicorn event loop.
"""
import asyncio
import datetime
import json
import logging
import os

log = logging.getLogger(__name__)

_PRIV = os.getenv("BW_VAPID_PRIVATE_KEY", "")
_SUBJ = os.getenv("BW_VAPID_SUBJECT", "mailto:admin@localhost")

from database import get_db


# ── Subscription CRUD ─────────────────────────────────────────────────────────

async def save_subscription(
    user_id: int, endpoint: str, p256dh: str, auth: str, user_agent: str = ""
) -> int:
    """Upsert a PushSubscription for a user. Returns the row id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                user_id    = excluded.user_id,
                p256dh     = excluded.p256dh,
                auth       = excluded.auth,
                user_agent = excluded.user_agent
            """,
            (user_id, endpoint, p256dh, auth, user_agent),
        )
        await db.commit()
        return cur.lastrowid


async def delete_subscription(endpoint: str) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
        )
        await db.commit()
        return cur.rowcount > 0


async def get_user_subscriptions(user_id: int) -> list[dict]:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
            (user_id,),
        )
        rows = await cur.fetchall()
    return [{"endpoint": r[0], "p256dh": r[1], "auth": r[2]} for r in rows]


async def has_subscription(user_id: int) -> bool:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1", (user_id,)
        )
        return bool(await cur.fetchone())


# ── Due reminders query ───────────────────────────────────────────────────────

async def get_due_reminders_with_subs() -> list[dict]:
    """Return unfired note_reminders due now, joined with push subscriptions.

    Each row has everything needed to send a push and mark the reminder fired.
    """
    import datetime
    now       = datetime.datetime.now()
    date_str  = now.strftime("%Y-%m-%d")
    time_str  = now.strftime("%H:%M")
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT nr.id, nr.user_id, nr.label, nr.message, nr.note_id,
                   ps.endpoint, ps.p256dh, ps.auth
            FROM   note_reminders nr
            JOIN   push_subscriptions ps ON ps.user_id = nr.user_id
            WHERE  nr.reminder_date = ?
              AND  nr.reminder_time <= ?
              AND  nr.fired = 0
            """,
            (date_str, time_str),
        )
        rows = await cur.fetchall()
    return [
        {
            "reminder_id": r[0],
            "user_id":     r[1],
            "label":       r[2],
            "message":     r[3],
            "note_id":     r[4],
            "endpoint":    r[5],
            "p256dh":      r[6],
            "auth":        r[7],
        }
        for r in rows
    ]


async def mark_reminders_fired(reminder_ids: list[int]) -> None:
    if not reminder_ids:
        return
    placeholders = ",".join("?" * len(reminder_ids))
    async with get_db() as db:
        await db.execute(
            f"UPDATE note_reminders SET fired=1 WHERE id IN ({placeholders})",
            reminder_ids,
        )
        await db.commit()


# ── RSS per-feed notification helpers ──────────────────────────────────────────

async def toggle_rss_feed_notif(user_id: int, feed_url: str) -> bool:
    """Toggle notification opt-in for *feed_url*. Returns new enabled state."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM rss_feed_notifs WHERE user_id=? AND feed_url=?",
            (user_id, feed_url),
        )
        existing = await cur.fetchone()
        if existing:
            await db.execute(
                "DELETE FROM rss_feed_notifs WHERE user_id=? AND feed_url=?",
                (user_id, feed_url),
            )
            await db.commit()
            return False
        await db.execute(
            "INSERT OR IGNORE INTO rss_feed_notifs (user_id, feed_url) VALUES (?,?)",
            (user_id, feed_url),
        )
        await db.commit()
        return True


async def get_rss_notif_enabled_urls(user_id: int, urls: list[str]) -> set[str]:
    """Return the subset of *urls* that the user has opted into notifications for."""
    if not urls:
        return set()
    placeholders = ",".join("?" * len(urls))
    async with get_db() as db:
        cur = await db.execute(
            f"SELECT feed_url FROM rss_feed_notifs "
            f"WHERE user_id=? AND feed_url IN ({placeholders})",
            (user_id, *urls),
        )
        rows = await cur.fetchall()
    return {r[0] for r in rows}


async def get_all_notif_feeds_with_subs() -> list[dict]:
    """Return every (feed_url, endpoint, p256dh, auth) row for the background loop.

    Joins rss_feed_notifs with push_subscriptions so we only get feeds that
    have at least one user with both a notification opt-in AND a push subscription.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT rfn.feed_url, ps.endpoint, ps.p256dh, ps.auth
            FROM   rss_feed_notifs rfn
            JOIN   push_subscriptions ps ON ps.user_id = rfn.user_id
            """
        )
        rows = await cur.fetchall()
    return [
        {"feed_url": r[0], "endpoint": r[1], "p256dh": r[2], "auth": r[3]}
        for r in rows
    ]


async def get_rss_seen_guids(feed_url: str) -> set[str]:
    """Return all item GUIDs we have already sent a notification for."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT item_guid FROM rss_notif_seen WHERE feed_url=?",
            (feed_url,),
        )
        rows = await cur.fetchall()
    return {r[0] for r in rows}


async def mark_rss_items_seen(feed_url: str, guids: list[str]) -> None:
    """Record item GUIDs as seen so they are not re-pushed next cycle."""
    if not guids:
        return
    async with get_db() as db:
        await db.executemany(
            "INSERT OR IGNORE INTO rss_notif_seen (feed_url, item_guid) VALUES (?,?)",
            [(feed_url, g) for g in guids],
        )
        await db.commit()


# ── Push sending ───────────────────────────────────────────────────────────────

def _send_push_sync(subscription_info: dict, payload: dict) -> bool | None:
    """Synchronous webpush call — always run via asyncio.to_thread().

    Returns:
        True  — sent successfully
        False — transient error (keep subscription)
        None  — subscription is gone (404/410), caller should delete it
    """
    from pywebpush import webpush, WebPushException
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=_PRIV,
            vapid_claims={"sub": _SUBJ},
        )
        return True
    except WebPushException as ex:
        status = getattr(getattr(ex, "response", None), "status_code", 0)
        if status in (404, 410):
            return None   # expired / deleted — caller removes it
        log.warning("[push] WebPushException status=%s: %s", status, ex)
        return False
    except Exception as ex:
        log.warning("[push] send error: %s", ex)
        return False


async def send_push(subscription_info: dict, payload: dict) -> bool | None:
    """Async wrapper around _send_push_sync."""
    return await asyncio.to_thread(_send_push_sync, subscription_info, payload)


# ── widget_notif_sent dedup helpers ───────────────────────────────────────────────

async def has_widget_notif_sent(key: str) -> bool:
    """Return True if this notification key has already been sent."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM widget_notif_sent WHERE key=?", (key,)
        )
        return bool(await cur.fetchone())


async def mark_widget_notifs_sent(keys: list[str]) -> None:
    """Record a batch of notification keys as sent."""
    if not keys:
        return
    async with get_db() as db:
        await db.executemany(
            "INSERT OR IGNORE INTO widget_notif_sent (key) VALUES (?)",
            [(k,) for k in keys],
        )
        await db.commit()


async def cleanup_old_widget_notifs(days: int = 60) -> None:
    """Prune dedup records older than *days* to keep the table lean."""
    cutoff = (datetime.datetime.utcnow() -
              datetime.timedelta(days=days)).isoformat()
    async with get_db() as db:
        await db.execute(
            "DELETE FROM widget_notif_sent WHERE sent_at < ?", (cutoff,)
        )
        await db.commit()


# ── Countdown widget notification queries ──────────────────────────────────────

async def get_countdown_widgets_with_subs() -> list[dict]:
    """Return countdown widgets that have notify_on_day=true in config_json,
    joined with push subscriptions for the owning user.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT hw.id, hp.user_id, hw.config_json,
                   ps.endpoint, ps.p256dh, ps.auth
            FROM   home_widgets hw
            JOIN   home_pages   hp ON hp.id = hw.page_id
            JOIN   push_subscriptions ps ON ps.user_id = hp.user_id
            WHERE  hw.widget_type = 'countdown'
            """
        )
        rows = await cur.fetchall()
    result = []
    for r in rows:
        try:
            cfg = json.loads(r[2] or "{}")
        except Exception:
            cfg = {}
        if not cfg.get("notify_on_day"):
            continue
        result.append({
            "widget_id":   r[0],
            "user_id":     r[1],
            "label":       cfg.get("label", "Countdown"),
            "target_date": cfg.get("target_date", ""),
            "endpoint":    r[3],
            "p256dh":      r[4],
            "auth":        r[5],
        })
    return result


# ── Event widget notification queries ───────────────────────────────────────────

async def get_event_widgets_with_subs() -> list[dict]:
    """Return event widgets joined with push subscriptions."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT hw.id, hp.user_id, hw.config_json,
                   ps.endpoint, ps.p256dh, ps.auth
            FROM   home_widgets hw
            JOIN   home_pages   hp ON hp.id = hw.page_id
            JOIN   push_subscriptions ps ON ps.user_id = hp.user_id
            WHERE  hw.widget_type = 'event'
            """
        )
        rows = await cur.fetchall()
    result = []
    for r in rows:
        try:
            cfg   = json.loads(r[2] or "{}")
            items = cfg.get("items", [])
        except Exception:
            items = []
        if not items:
            continue
        result.append({
            "widget_id": r[0],
            "user_id":   r[1],
            "items":     items,
            "endpoint":  r[3],
            "p256dh":    r[4],
            "auth":      r[5],
        })
    return result
