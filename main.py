"""BookWorm — Team Note Taking App (FastAPI + HTMX + Tailwind + SQLite)."""
import asyncio
import hashlib
import os
import re
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Optional
import logging

# Load .env BEFORE any os.getenv() calls elsewhere in the module graph.
# override=False means real environment variables always win (safe for Docker).
try:
    from dotenv import load_dotenv
    load_dotenv(override=False)
except ImportError:
    pass  # python-dotenv not installed — env vars must be set by the OS / Docker

# Root-logger setup: uvicorn only configures its own loggers, leaving the
# root logger with no handler. Without this, all app-level log.info() /
# log.warning() calls are silently dropped.
import logging as _logging
_logging.basicConfig(
    level=_logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s",
)
del _logging

log = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from auth_middleware import AuthMiddleware
from security import load_secret_key


# ── Security response headers ─────────────────────────────────────────────────
class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject standard security headers on every response.

    When BW_HTTPS=true the Strict-Transport-Security (HSTS) header is also
    added so browsers automatically upgrade future HTTP visits to HTTPS.
    max-age=63072000 = 2 years, matching the recommended minimum for HSTS
    preload eligibility.
    """
    _HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options":        "SAMEORIGIN",
        "Referrer-Policy":        "strict-origin-when-cross-origin",
        "Permissions-Policy":     "camera=(), microphone=(), geolocation=()",
    }
    # Evaluated once at class definition time — same lifetime as the process.
    _HSTS: str = (
        "max-age=63072000; includeSubDomains"
        if os.getenv("BW_HTTPS", "false").lower() == "true"
        else ""
    )
    # Content-Security-Policy — computed once at startup.
    # script-src / style-src keep 'unsafe-inline' because HTMX + widget JS
    # renders inline <script> blocks and inline style attributes throughout.
    # https: in both allows third-party CDN libs (Jspreadsheet, SheetJS) that
    # are lazy-loaded on demand.  Tighten to specific origins when the CDN list
    # is fully enumerated.
    _collabora: str = os.getenv("BW_COLLABORA_URL", "").strip().rstrip("/")
    _CSP: str = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https:; "
        "style-src 'self' 'unsafe-inline' https:; "
        "img-src 'self' data: blob: https:; "
        "font-src 'self' data: https:; "
        "connect-src 'self'; "
        "worker-src 'self' blob:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-src 'self' https://challenges.cloudflare.com https://player.vimeo.com"
        " https://www.youtube.com https://www.youtube-nocookie.com https://fast.wistia.com"
        + (f" {_collabora}" if _collabora else "") + ";"
    )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for k, v in self._HEADERS.items():
            response.headers.setdefault(k, v)
        if self._HSTS:
            response.headers.setdefault("Strict-Transport-Security", self._HSTS)
        response.headers.setdefault("Content-Security-Policy", self._CSP)
        return response


class _StaticCacheMiddleware(BaseHTTPMiddleware):
    """Add long-lived cache headers to versioned static assets.

    The app injects ?v={{ static_v }} on every <script>/<link> tag, so the
    URL changes on every deploy.  That makes it safe to cache aggressively.

    /static/ paths WITHOUT a ?v= param get a 1-hour cache (e.g. favicon,
    fonts) so they are still refreshed regularly.  Dynamic routes are
    untouched.
    """
    _IMMUTABLE = "public, max-age=31536000, immutable"  # 1 year
    _SHORT     = "public, max-age=3600"                # 1 hour

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            cc = self._IMMUTABLE if request.query_params.get("v") else self._SHORT
            response.headers["Cache-Control"] = cc
        return response


class _CSRFMiddleware(BaseHTTPMiddleware):
    """Defense-in-depth CSRF guard: reject cross-origin state-changing requests.

    This is a SECOND layer on top of the SameSite=lax session cookie (which
    already stops a cross-site page from sending an authenticated POST). It
    blocks the residual cases (e.g. browsers that ignore SameSite, same-site
    sub-domain shenanigans) by checking the Origin/Referer of unsafe requests.

    Designed to be non-breaking:
      • Inert unless BW_WEBAUTHN_ORIGIN is set — that value equals the exact
        Origin the browser sends, so matching is reliable even behind a reverse
        proxy that rewrites Host (Cloudflare Tunnel → nginx proxy manager).
      • Only inspects unsafe methods (POST/PUT/PATCH/DELETE).
      • Skips /static/, /wopi/ (Collabora server-to-server, token-authed, no
        same-origin header), and /share/view/ (public token links).
      • Allows localhost origins so local dev is never blocked.
      • Fails OPEN when neither Origin nor Referer is present (non-browser
        clients) — browsers always send Origin on a cross-origin POST, so the
        attack case is still covered.
    """
    _SAFE = {"GET", "HEAD", "OPTIONS", "TRACE"}
    _SKIP_PREFIXES = ("/static/", "/wopi/", "/share/view/")
    _ORIGIN: str = os.getenv("BW_WEBAUTHN_ORIGIN", "").strip().rstrip("/")

    @staticmethod
    def _host_of(origin: str) -> str:
        try:
            return origin.split("://", 1)[1].split("/")[0].split(":")[0].lower()
        except (IndexError, AttributeError):
            return ""

    def _origin_ok(self, origin: str) -> bool:
        if origin == self._ORIGIN:
            return True
        return self._host_of(origin) in ("localhost", "127.0.0.1", "::1")

    def _referer_ok(self, referer: str) -> bool:
        if referer.rstrip("/") == self._ORIGIN or referer.startswith(self._ORIGIN + "/"):
            return True
        return self._host_of(referer) in ("localhost", "127.0.0.1", "::1")

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self._ORIGIN or request.method in self._SAFE:
            return await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in self._SKIP_PREFIXES):
            return await call_next(request)
        origin = (request.headers.get("origin") or "").strip().rstrip("/")
        referer = (request.headers.get("referer") or "").strip()
        if origin:
            if not self._origin_ok(origin):
                return Response("CSRF check failed", status_code=403, media_type="text/plain")
        elif referer:
            if not self._referer_ok(referer):
                return Response("CSRF check failed", status_code=403, media_type="text/plain")
        # No Origin and no Referer → non-browser client; SameSite=lax still
        # protects cookie-based sessions, so fail open rather than break clients.
        return await call_next(request)


from database import init_db, get_db
from routers.categories_db import get_categories_for_workspace, get_all_attr_defs
from routers.notes_db import search_notes
from routers.sharing_db import get_shared_object_ids
from routers.workspaces_db import (
    get_all_workspaces,
    get_open_workspaces,
    get_workspace_tree,
    get_workspace_breadcrumb,
    get_descendant_ids,
    get_first_workspace_id,
    get_or_create_quick_notes_workspace,
    get_trashed_workspaces,
    purge_expired_trash,
)
from routers.home_db import get_home_pages, get_trashed_home_pages, purge_expired_home_pages
from routers.home_rss_db import purge_old_rss_read_items
from routers.workspace_db_cards import get_db_cards
from routers import notes as notes_router
from routers import note_dnd as note_dnd_router
from routers import categories as categories_router
from routers import workspaces as workspaces_router
from routers import workspace_databases as workspace_databases_router
from routers import tutorials as tutorials_router
from routers import tutorials_autofetch as tutorials_autofetch_router
from routers import attachments as attachments_router
from routers import auth as auth_router
from routers import account as account_router
from routers import totp as totp_router
from routers import home as home_router
from routers import home_rss as home_rss_router
from routers import home_crm as home_crm_router
from routers import home_subscriptions as home_subscriptions_router
from routers import thiings as thiings_router
from routers import home_trip as home_trip_router
from routers import home_trip_panels as home_trip_panels_router
from routers import home_ai as home_ai_router
from routers import home_settle as home_settle_router
from routers import home_buds as home_buds_router
from routers import home_grid as home_grid_router
from routers import home_uploads as home_uploads_router
from routers import home_uploads_docs as home_uploads_docs_router
from routers import home_uploads_annot as home_uploads_annot_router
from routers import home_uploads_folders as home_uploads_folders_router
from routers import home_uploads_catalogs as home_uploads_catalogs_router
from routers import wopi as wopi_router
from routers import demo as demo_router
from routers.demo import purge_old_demo_users
from routers import note_reminders as note_reminders_router
from routers import sharing as sharing_router
from routers import push as push_router
from routers import webauthn as webauthn_router
from routers import search_qa as search_qa_router
from routers import quick_ask as quick_ask_router
from routers.attachments_db import UPLOAD_DIR, get_upload_owner
from routers.home_db import get_home_page
import search_index


async def _demo_purge_loop():
    """Background task: purge stale demo users every 30 minutes."""
    _INTERVAL = 30 * 60
    while True:
        await asyncio.sleep(_INTERVAL)
        try:
            n = await purge_old_demo_users()
            if n:
                log.info("Background purge: removed %d stale demo user(s)", n)
        except Exception:
            log.exception("Background purge failed")


async def _reminder_push_loop():
    """Background task: fire Web Push for note reminders every 60 seconds.

    Checks for unfired note_reminders where reminder_date=today and
    reminder_time <= now, dispatches a push to every registered device for
    that user, then marks the reminders fired so they don’t repeat.
    """
    import os
    if not os.getenv("BW_VAPID_PRIVATE_KEY"):
        log.info("[push] BW_VAPID_PRIVATE_KEY not set — reminder push disabled")
        return
    from routers.push_db import get_due_reminders_with_subs, mark_reminders_fired, send_push, delete_subscription
    _INTERVAL = 60  # seconds
    while True:
        await asyncio.sleep(_INTERVAL)
        try:
            due = await get_due_reminders_with_subs()
            if not due:
                continue
            fired_ids: set[int] = set()
            stale_eps: set[str] = set()
            for row in due:
                sub_info = {
                    "endpoint": row["endpoint"],
                    "keys":     {"p256dh": row["p256dh"], "auth": row["auth"]},
                }
                body = row["message"] or row["label"]
                note_id = row["note_id"]
                payload = {
                    "title":   "\U0001f4da BookWorm Reminder",
                    "body":    body,
                    "icon":    "/static/img/icons/icon-192.png",
                    "badge":   "/static/img/icons/badge-96.png",
                    "tag":     f"bw-rem-{row['reminder_id']}",
                    # url lets the SW click handler deep-link to the right note
                    "data":    {"note_id": note_id,
                                "url": f"/?note={note_id}" if note_id else "/"},
                }
                result = await send_push(sub_info, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])  # dead sub — remove it
                elif result:                         # True = delivered OK
                    fired_ids.add(row["reminder_id"])
                # False = transient error — leave fired=0 so it retries next cycle
            await mark_reminders_fired(list(fired_ids))
            for ep in stale_eps:
                await delete_subscription(ep)
            if fired_ids:
                log.info("[push] fired %d reminder(s)", len(fired_ids))
        except Exception:
            log.exception("[push] reminder loop error")


async def _rss_notif_loop():
    """Background task: push notifications for new RSS items every 15 minutes.

    For each unique feed URL that has at least one subscriber:
      1. Fetch the feed via the existing httpx helper.
      2. Filter out item GUIDs already marked seen.
      3. On first ever fetch (no seen entries yet) silently seed all current
         GUIDs so the user only gets NEW articles from this point forward.
      4. Send a push notification to every subscriber of that feed.
      5. Mark the new GUIDs as seen.
    """
    import os
    if not os.getenv("BW_VAPID_PRIVATE_KEY"):
        log.info("[rss-push] BW_VAPID_PRIVATE_KEY not set — RSS push disabled")
        return

    from functools import partial
    from routers.push_db import (
        get_all_notif_feeds_with_subs,
        get_rss_seen_guids,
        mark_rss_items_seen,
        send_push,
        delete_subscription,
    )
    # Borrow the internal fetch + parse helpers from the home router.
    from routers.home import _fetch_raw, _parse_rss, _POOL

    _INTERVAL = 15 * 60  # 15 minutes
    await asyncio.sleep(10)  # brief warm-up so DB init finishes first
    while True:
        try:
            rows = await get_all_notif_feeds_with_subs()
            if rows:
                log.info("[rss-push] cycle start — %d feed/subscriber pair(s) found", len(rows))
                # Group subscriptions by feed URL so each URL is only fetched once.
                from collections import defaultdict
                feeds_map: dict[str, list[dict]] = defaultdict(list)
                for row in rows:
                    feeds_map[row["feed_url"]].append(
                        {"endpoint": row["endpoint"], "p256dh": row["p256dh"], "auth": row["auth"]}
                    )

                loop = asyncio.get_event_loop()
                total_sent = 0
                stale_eps: set[str] = set()

                for feed_url, subs in feeds_map.items():
                    try:
                        text, _ = await loop.run_in_executor(
                            _POOL, partial(_fetch_raw, feed_url, True)
                        )
                        parsed   = _parse_rss(text)
                        items    = parsed.get("items") or []
                        if not items:
                            continue

                        # Build a stable GUID for each item (link preferred, title fallback)
                        def _guid(it: dict) -> str:
                            return (it.get("link") or it.get("title") or "").strip()

                        all_guids  = [_guid(it) for it in items if _guid(it)]
                        seen_guids = await get_rss_seen_guids(feed_url)

                        if not seen_guids:
                            # First-ever fetch: seed everything so users aren't
                            # bombarded with every historical article at once.
                            await mark_rss_items_seen(feed_url, all_guids)
                            continue

                        new_items = [it for it in items if _guid(it) and _guid(it) not in seen_guids]
                        if not new_items:
                            continue

                        feed_title = parsed.get("title") or feed_url
                        for idx, it in enumerate(new_items[:5]):  # cap at 5 per cycle
                            payload = {
                                "title":  f"📰 {feed_title}",
                                "body":   (it.get("title") or "New article").strip()[:120],
                                "icon":   "/static/img/icons/icon-192.png",
                                "badge":  "/static/img/icons/badge-96.png",
                                # unique tag per article so notifications stack, not overwrite
                                "tag":    f"bw-rss-{hash(feed_url) & 0xFFFFFF}-{idx}",
                                "data":   {"url": it.get("link") or feed_url},
                            }
                            for sub in subs:
                                sub_info = {"endpoint": sub["endpoint"],
                                            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
                                result = await send_push(sub_info, payload)
                                if result is True:
                                    total_sent += 1
                                elif result is None:
                                    stale_eps.add(sub["endpoint"])

                        await mark_rss_items_seen(feed_url, [_guid(it) for it in new_items if _guid(it)])

                    except Exception as e:
                        # A single feed failing to fetch/parse (e.g. a YouTube
                        # channel page that isn't valid RSS XML) is an external
                        # issue, not a bug — log a concise warning and skip it
                        # rather than dumping a full traceback every cycle.
                        log.warning("[rss-push] skipping feed %s: %s", feed_url, e)

                for ep in stale_eps:
                    await delete_subscription(ep)
                if total_sent:
                    log.info("[rss-push] sent %d notification(s) across %d feed(s)",
                             total_sent, len(feeds_map))
        except Exception:
            log.exception("[rss-push] loop error")
        await asyncio.sleep(_INTERVAL)


async def _bud_notif_loop():
    """Background task: push notifications for Bud contact & visit reminders.

    Runs every 60 seconds.
    Contact reminder: fires at the user-chosen HH:MM when a bud is overdue
                      (days since last contact >= see_every_days).
    Visit reminder:   fires at 09:00 on the day of a planned visit.
    """
    import os
    if not os.getenv("BW_VAPID_PRIVATE_KEY"):
        log.info("[bud-push] BW_VAPID_PRIVATE_KEY not set — bud push disabled")
        return
    from routers.push_db import send_push, delete_subscription
    from routers.home_buds_db import (
        get_due_bud_contact_reminders, mark_contact_reminder_sent,
        get_due_bud_visit_reminders,   mark_visit_reminders_sent,
    )
    _INTERVAL = 60
    while True:
        await asyncio.sleep(_INTERVAL)
        try:
            # ── Contact-frequency reminders ──────────────────────────────────────
            due_contacts = await get_due_bud_contact_reminders()
            stale_eps: set[str] = set()
            fired_bud_ids: set[int] = set()
            for row in due_contacts:
                sub_info = {"endpoint": row["endpoint"],
                            "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                payload = {
                    "title":  "\uD83C\uDF31 Time to check in!",
                    "body":   f"You haven't contacted {row['name']} in a while — reach out!",
                    "icon":   "/static/img/icons/icon-192.png",
                    "badge":  "/static/img/icons/badge-96.png",
                    "tag":    f"bw-bud-contact-{row['bud_id']}",
                }
                result = await send_push(sub_info, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:  # True = delivered; False = transient, retry next tick
                    fired_bud_ids.add(row["bud_id"])
            await mark_contact_reminder_sent(list(fired_bud_ids))

            # ── Visit-day reminders ──────────────────────────────────────────────────
            due_visits = await get_due_bud_visit_reminders()
            fired_plan_ids: set[int] = set()
            for row in due_visits:
                sub_info = {"endpoint": row["endpoint"],
                            "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                note_part = f" — {row['note']}" if row["note"] else ""
                payload = {
                    "title":  "\uD83D\uDCC5 Visit today!",
                    "body":   f"{row['bud_name']} — your visit is today{note_part}!",
                    "icon":   "/static/img/icons/icon-192.png",
                    "badge":  "/static/img/icons/badge-96.png",
                    "tag":    f"bw-bud-visit-{row['plan_id']}",
                }
                result = await send_push(sub_info, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:  # True = delivered; False = transient, retry next tick
                    fired_plan_ids.add(row["plan_id"])
            await mark_visit_reminders_sent(list(fired_plan_ids))

            for ep in stale_eps:
                await delete_subscription(ep)

            if fired_bud_ids or fired_plan_ids:
                log.info("[bud-push] contact=%d visit=%d",
                         len(fired_bud_ids), len(fired_plan_ids))
        except Exception:
            log.exception("[bud-push] loop error")


def _evt_next_occurrence(target_date_iso: str, repeat_unit: str,
                          repeat_interval: int) -> "datetime.date | None":
    """Python equivalent of the JS _evtNext() helper.

    Returns the next occurrence of a recurring event on or after today,
    or None if target_date_iso is unparseable.
    """
    import datetime, calendar as _cal
    try:
        t = datetime.date.fromisoformat(target_date_iso)
    except (ValueError, TypeError):
        return None
    today = datetime.date.today()
    if repeat_unit == "none" or not repeat_unit:
        return t
    if t >= today:
        return t
    iv = max(1, int(repeat_interval or 1))
    n = t
    while n < today:
        if repeat_unit == "day":
            n += datetime.timedelta(days=iv)
        elif repeat_unit == "week":
            n += datetime.timedelta(weeks=iv)
        elif repeat_unit == "month":
            month = n.month + iv
            year  = n.year + (month - 1) // 12
            month = (month - 1) % 12 + 1
            day   = min(n.day, _cal.monthrange(year, month)[1])
            n     = n.replace(year=year, month=month, day=day)
        elif repeat_unit == "year":
            try:
                n = n.replace(year=n.year + iv)
            except ValueError:  # Feb 29 on non-leap year
                n = n.replace(year=n.year + iv, day=28)
    return n


def _rem_is_occurrence(item: dict, today_str: str) -> bool:
    """Return True if *today_str* (YYYY-MM-DD) is a valid firing day for
    a home Reminder widget item.

    Mirrors the JS ``_isReminderOccurrence`` logic in home-widgets-render.js.
    Non-recurring items fire exactly on their date.  Recurring items fire on
    every Nth day/week/month/year on or after the origin date.
    """
    import datetime
    unit   = item.get("repeat_unit") or "none"
    origin = item.get("date") or ""
    if not origin:
        return False
    try:
        t = datetime.date.fromisoformat(origin)
        d = datetime.date.fromisoformat(today_str)
    except (ValueError, TypeError):
        return False
    if unit == "none":
        return t == d
    if d < t:
        return False          # before start date
    iv = max(1, int(item.get("repeat_interval") or 1))
    if unit == "day":
        return (d - t).days % iv == 0
    if unit == "week":
        return (d - t).days % (iv * 7) == 0
    if unit == "month":
        months = (d.year - t.year) * 12 + (d.month - t.month)
        return d.day == t.day and months % iv == 0
    if unit == "year":
        return d.month == t.month and d.day == t.day and (d.year - t.year) % iv == 0
    return False


async def _widget_notif_loop():
    """Background task: push notifications for Countdown, Event, Subscription,
    Trip, CRM contact reminder, and home Reminder widget items.

    All channels share the widget_notif_sent dedup table so each alert fires
    at most once per dedup key per user device.
    """
    import os, datetime
    if not os.getenv("BW_VAPID_PRIVATE_KEY"):
        log.info("[widget-push] BW_VAPID_PRIVATE_KEY not set — widget push disabled")
        return
    from routers.push_db import (
        send_push, delete_subscription,
        get_countdown_widgets_with_subs, get_event_widgets_with_subs,
        get_due_crm_reminders_with_subs, get_reminder_widgets_with_subs,
        has_widget_notif_sent, mark_widget_notifs_sent, cleanup_old_widget_notifs,
    )
    from routers.home_crm_db import advance_crm_reminder, delete_contact_reminder
    from routers.home_subscriptions_db import get_due_subscription_reminders
    from routers.home_trip_db import get_due_trip_reminders, get_due_panel_reminders
    _INTERVAL = 60
    while True:
        await asyncio.sleep(_INTERVAL)
        try:
            now      = datetime.datetime.now()
            today    = datetime.date.today()
            date_str = today.isoformat()   # shared by all sections below
            stale_eps: set[str] = set()
            sent_keys: list[str] = []

            # ── Countdown: fire at the user-chosen time on target_date ──────────────
            now_hhmm = now.strftime("%H:%M")
            for row in await get_countdown_widgets_with_subs():
                if not row["target_date"]:
                    continue
                try:
                    td = datetime.date.fromisoformat(row["target_date"])
                except ValueError:
                    continue
                if td != today:
                    continue
                if now_hhmm < row["notify_time"]:
                    continue  # not yet
                key = f"countdown:{row['widget_id']}:{row['target_date']}"
                if await has_widget_notif_sent(key):
                    continue
                sub = {"endpoint": row["endpoint"],
                       "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                payload = {
                    "title": "\uD83C\uDF89 It's the day!",
                    "body":  f"{row['label']} is today!",
                    "icon":  "/static/img/icons/icon-192.png",
                    "badge": "/static/img/icons/badge-96.png",
                    "tag":   f"bw-countdown-{row['widget_id']}",
                }
                result = await send_push(sub, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:
                    sent_keys.append(key)

            # ── Events: fire N days before next occurrence ──────────────────────
            for row in await get_event_widgets_with_subs():
                for item in row["items"]:
                    lead_days = item.get("lead_days") or []
                    if not lead_days:
                        continue
                    nxt = _evt_next_occurrence(
                        item.get("target_date", ""),
                        item.get("repeat_unit", "none"),
                        item.get("repeat_interval", 1),
                    )
                    if nxt is None:
                        continue
                    nxt_iso = nxt.isoformat()
                    item_id = item.get("id", "")
                    for ld in lead_days:
                        try:
                            fire_date = nxt - datetime.timedelta(days=int(ld))
                        except (TypeError, ValueError):
                            continue
                        if fire_date != today:
                            continue
                        # Gate on notify_time — items without it default to 09:00.
                        # Prevents the loop from firing at 6 AM just because the
                        # date matches; mirrors the countdown notify_time check.
                        notify_time = item.get("notify_time") or "09:00"
                        if now_hhmm < notify_time:
                            continue
                        key = f"event:{row['widget_id']}:{item_id}:{nxt_iso}:{ld}"
                        if await has_widget_notif_sent(key):
                            continue
                        days_label = "Today!" if ld == 0 else (
                            "Tomorrow" if ld == 1 else f"In {ld} days"
                        )
                        sub = {"endpoint": row["endpoint"],
                               "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                        payload = {
                            "title": "\uD83D\uDCC5 Upcoming event",
                            "body":  f"{item.get('text', 'Event')} — {days_label}",
                            "icon":  "/static/img/icons/icon-192.png",
                            "badge": "/static/img/icons/badge-96.png",
                            "tag":   f"bw-event-{row['widget_id']}-{item_id}-{ld}",
                        }
                        result = await send_push(sub, payload)
                        if result is None:
                            stale_eps.add(row["endpoint"])
                        elif result:
                            sent_keys.append(key)

            # ── Subscriptions: fire selected offsets before next_payment_date ─────────
            # Subscriptions have no user-set time field — gate to 09:00–21:00
            # local so billing alerts never land at 3 AM during a maintenance
            # restart. Dedup includes the offset, so 30/3/1 day reminders can
            # each fire once for the same billing cycle.
            if "09:00" <= now_hhmm <= "21:00":
                for row in await get_due_subscription_reminders():
                    key = row["dedup_key"]
                    if await has_widget_notif_sent(key):
                        continue
                    days = (datetime.date.fromisoformat(row["next_payment_date"])
                            - today).days
                    when = "today" if days == 0 else (
                           "tomorrow" if days == 1 else f"in {days} days")
                    sub = {"endpoint": row["endpoint"],
                           "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                    payload = {
                        "title": "\uD83D\uDCB3 Subscription due",
                        "body":  (f"{row['name']} renews {when} "
                                  f"({row['currency']} {row['amount']:.2f})"),
                        "icon":  "/static/img/icons/icon-192.png",
                        "badge": "/static/img/icons/badge-96.png",
                        "tag":   f"bw-sub-{row['sub_id']}-{row.get('reminder_offset', days)}",
                    }
                    result = await send_push(sub, payload)
                    if result is None:
                        stale_eps.add(row["endpoint"])
                    elif result:
                        sent_keys.append(key)

            # ── Trip itinerary reminders ─────────────────────────────────────────
            for row in await get_due_trip_reminders():
                key = row["dedup_key"]
                if await has_widget_notif_sent(key):
                    continue
                day_ctx = row["trip_name"]
                if row["day_label"]:
                    day_ctx += f" — {row['day_label']}"
                sub = {"endpoint": row["endpoint"],
                       "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                payload = {
                    "title": "🔔 Trip reminder",
                    "body":  f"{row['title']}" + (f" ({day_ctx})" if day_ctx else ""),
                    "icon":  "/static/img/icons/icon-192.png",
                    "badge": "/static/img/icons/badge-96.png",
                    "tag":   f"bw-trip-{row['block_id']}",
                }
                result = await send_push(sub, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:
                    sent_keys.append(key)

            # ── Trip resource Reminder card items ─────────────────────────────────
            for row in await get_due_panel_reminders():
                key = row["dedup_key"]
                if await has_widget_notif_sent(key):
                    continue
                ctx = row["trip_name"] or row["panel_title"]
                sub = {"endpoint": row["endpoint"],
                       "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                payload = {
                    "title": "🔔 Trip reminder",
                    "body":  row["title"] + (f" ({ctx})" if ctx else ""),
                    "icon":  "/static/img/icons/icon-192.png",
                    "badge": "/static/img/icons/badge-96.png",
                    "tag":   f"bw-panel-remind-{row['panel_id']}-{row['item_id']}",
                }
                result = await send_push(sub, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:
                    sent_keys.append(key)

            # ── CRM contact reminders ───────────────────────────────────────
            # Parallel to the existing client-side poll but works even when
            # the tab is closed.  Recurring reminders are advanced to their
            # next date so they re-queue automatically.
            to_advance_recurring: list[tuple[int, int]] = []  # (reminder_id, user_id)
            to_delete_oneshot:    list[tuple[int, int]] = []  # (reminder_id, contact_id)
            crm_due = await get_due_crm_reminders_with_subs()
            if crm_due:
                log.info("[widget-push] crm: %d due reminder(s) at %s %s",
                         len(crm_due), date_str, now_hhmm)
            for row in crm_due:
                key = row["dedup_key"]
                if await has_widget_notif_sent(key):
                    continue
                contact  = row["contact_name"] or "Contact"
                body     = row["label"]
                if row["message"]:
                    body += f" \u2014 {row['message']}"
                sub = {"endpoint": row["endpoint"],
                       "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                payload = {
                    "title": f"\U0001f514 CRM \u2014 {contact}",
                    "body":  body,
                    "icon":  "/static/img/icons/icon-192.png",
                    "badge": "/static/img/icons/badge-96.png",
                    "tag":   f"bw-crm-rem-{row['reminder_id']}",
                    "data":  {"page_id": row["page_id"], "url": "/"},
                }
                result = await send_push(sub, payload)
                if result is None:
                    stale_eps.add(row["endpoint"])
                elif result:  # True = delivered; False = transient error, retry next tick
                    sent_keys.append(key)
                    if row["recurrence"] != "none":
                        to_advance_recurring.append(
                            (row["reminder_id"], row["user_id"])
                        )
                    else:
                        # One-time reminder fired — delete it so it leaves the
                        # upcoming list and doesn't re-trigger on the next tick.
                        to_delete_oneshot.append(
                            (row["reminder_id"], row["contact_id"])
                        )
            for rem_id, uid in to_advance_recurring:
                await advance_crm_reminder(rem_id, uid)
            for rem_id, contact_id in to_delete_oneshot:
                await delete_contact_reminder(rem_id, contact_id)

            # ── Home Reminder widget items ─────────────────────────────────
            # Items live in home_widgets.config_json, not a DB table, so we
            # parse them server-side and use _rem_is_occurrence() to check
            # whether today is a valid firing day for recurring items.
            today_str = date_str  # alias kept for _rem_is_occurrence() calls below
            for row in await get_reminder_widgets_with_subs():
                for item in row["items"]:
                    item_time = (item.get("time") or "").strip()
                    if not item_time or item_time > now_hhmm:
                        continue  # not yet
                    if not _rem_is_occurrence(item, today_str):
                        continue  # wrong day
                    # Stable dedup key: widget + date + time + sha256(text+time)[:8]
                    # sha256 is deterministic across restarts and workers;
                    # hash() must NOT be used here (PYTHONHASHSEED randomises it
                    # per-process, so every restart produces a new key and the
                    # notification re-fires as if it had never been sent).
                    text_hash = hashlib.sha256(
                        (item.get("text", "") + item_time).encode()
                    ).hexdigest()[:8]
                    key = f"hwrem:{row['widget_id']}:{today_str}:{item_time}:{text_hash}"
                    if await has_widget_notif_sent(key):
                        continue
                    sub = {"endpoint": row["endpoint"],
                           "keys": {"p256dh": row["p256dh"], "auth": row["auth"]}}
                    payload = {
                        "title": "\U0001f514 Reminder",
                        "body":  (item.get("text") or "You have a reminder").strip()[:200],
                        "icon":  "/static/img/icons/icon-192.png",
                        "badge": "/static/img/icons/badge-96.png",
                        "tag":   f"bw-hwrem-{row['widget_id']}-{item_time}",
                    }
                    result = await send_push(sub, payload)
                    if result is None:
                        stale_eps.add(row["endpoint"])
                    elif result:
                        sent_keys.append(key)

            # ── Housekeeping ──────────────────────────────────────────────────
            await mark_widget_notifs_sent(sent_keys)
            for ep in stale_eps:
                await delete_subscription(ep)
            if now.hour == 3 and now.minute < 2:   # cleanup once a night
                await cleanup_old_widget_notifs()
            if sent_keys:
                log.info("[widget-push] fired %d notification(s)", len(sent_keys))
        except Exception:
            log.exception("[widget-push] loop error")


async def _prewarm_thumbs() -> None:
    """Generate 400-px and 800-px WebP thumbnails for all existing image uploads.

    Runs once as a background task right after startup so the uploads grid
    is fast on first load for every user.  Files that already have an
    up-to-date cached thumbnail are skipped (mtime comparison).
    Runs in a thread pool so Pillow never blocks the async event loop.
    """
    import io as _io
    try:
        from PIL import Image as _Img, ImageOps as _IOs  # noqa: PLC0415
    except ImportError:
        log.info("thumb prewarm: Pillow not installed — skipping")
        return

    _WIDTHS   = (400, 800)
    _IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif",
                 ".bmp", ".tiff", ".tif", ".avif", ".heic", ".heif"}

    # Collect image filenames from both upload tables
    filenames: list[str] = []
    async with get_db() as db:
        for table in ("page_uploads", "note_attachments"):
            cur = await db.execute(
                f"SELECT filename, mime_type FROM {table} WHERE filename IS NOT NULL"
            )
            for fname, mime in await cur.fetchall():
                if (mime or "").lower().startswith("image/") or \
                   Path(fname).suffix.lower() in _IMG_EXTS:
                    filenames.append(fname)

    if not filenames:
        return

    generated = skipped = 0
    for fname in filenames:
        src = UPLOAD_DIR / fname
        if not src.exists():
            continue
        src_mtime = src.stat().st_mtime

        for w in _WIDTHS:
            thumb_dir  = UPLOAD_DIR / "_thumbs" / str(w)
            thumb_path = thumb_dir / fname
            thumb_path.parent.mkdir(parents=True, exist_ok=True)

            if thumb_path.exists() and thumb_path.stat().st_mtime >= src_mtime:
                skipped += 1
                continue

            # Run Pillow in a thread so we don't block the event loop
            def _gen(src=src, dst=thumb_path, w=w):
                with _Img.open(src) as img:
                    img = _IOs.exif_transpose(img)
                    if img.width > w:
                        img.thumbnail((w, w * 10), _Img.LANCZOS)
                    buf = _io.BytesIO()
                    img.save(buf, format="WEBP", quality=75)
                    dst.write_bytes(buf.getvalue())

            try:
                await asyncio.to_thread(_gen)
                generated += 1
            except Exception as exc:
                log.debug("thumb prewarm: skip %s w=%d — %s", fname, w, exc)

        await asyncio.sleep(0)   # yield so other tasks aren't starved

    log.info("thumb prewarm: generated=%d  already-current=%d", generated, skipped)


async def lifespan(app: FastAPI):
    # Generate PWA icons on first boot (no-op if files already exist)
    try:
        from bw_pwa_icons import generate_icons
        from bw_shortcut_icons import generate_shortcut_icons
        # CPU-bound (Pillow rendering); offload to thread so the event loop
        # isn't blocked during server startup.
        await asyncio.to_thread(generate_icons)
        await asyncio.to_thread(generate_shortcut_icons)
    except Exception:
        log.warning("PWA icon generation failed — continuing without icons")

    await init_db()
    await purge_expired_trash()   # clean up any trash older than 30 days on boot
    await purge_expired_home_pages()  # purge home pages trashed for >30 days
    await purge_old_demo_users()  # clean up stale demo accounts on boot
    await purge_old_rss_read_items()  # trim rss read-state to 10 per feed

    # ── Hybrid Search Phase 2: TF-IDF index ───────────────────────────
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    if not search_index.load_from_disk():
        # Pickles missing — build on first boot in the background
        asyncio.create_task(search_index.rebuild_index())
    _sq_scheduler = AsyncIOScheduler()
    _sq_scheduler.add_job(
        search_index.rebuild_index, "cron", hour=6, minute=0,
        id="bw_tfidf_rebuild", replace_existing=True,
    )
    # Phase 4A: hourly widget sync — widgets have no SQL triggers
    _sq_scheduler.add_job(
        search_index.sync_widget_items, "interval", hours=1,
        id="bw_widget_sync", replace_existing=True,
    )
    _sq_scheduler.start()
    asyncio.create_task(search_index.sync_widget_items())  # populate on boot
    # Phase 5: CRM contacts sync (boot + hourly)
    _sq_scheduler.add_job(
        search_index.sync_crm_contacts, "interval", hours=1,
        id="bw_crm_contact_sync", replace_existing=True,
    )
    asyncio.create_task(search_index.sync_crm_contacts())  # populate on boot
    # ── /Hybrid Search ────────────────────────────────────────────────

    purge_task   = asyncio.create_task(_demo_purge_loop())
    push_task    = asyncio.create_task(_reminder_push_loop())
    rss_task     = asyncio.create_task(_rss_notif_loop())
    bud_task     = asyncio.create_task(_bud_notif_loop())
    widget_task  = asyncio.create_task(_widget_notif_loop())
    prewarm_task = asyncio.create_task(_prewarm_thumbs())
    try:
        yield
    finally:
        _sq_scheduler.shutdown(wait=False)
        for t in (purge_task, push_task, rss_task, bud_task, widget_task, prewarm_task):
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass


from templates_env import templates, static_v  # shared instance with all custom filters

app = FastAPI(title="BookWorm", lifespan=lifespan)

# SessionMiddleware must be outermost (added last) so it runs first and
# populates request.session before AuthMiddleware reads it.
# BW_SECRET_KEY should be set in production; a random default means
# sessions are invalidated on every server restart (fine for dev).
app.add_middleware(AuthMiddleware)
# CSRF defense-in-depth (Origin/Referer check on unsafe methods). Inert unless
# BW_WEBAUTHN_ORIGIN is set; layered on top of the SameSite=lax cookie below.
app.add_middleware(_CSRFMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("BW_SECRET_KEY", load_secret_key()),
    # BW_HTTPS=true  → secure-only cookies (require HTTPS). Enable this whenever
    # the app is behind a TLS-terminating proxy (nginx, Caddy, Traefik, etc.).
    # Leave false only for plain-HTTP local-network / development use.
    https_only=os.getenv("BW_HTTPS", "false").lower() == "true",
    # SameSite=Lax: cookies are sent on same-site requests and top-level
    # navigations, but not on cross-site subrequests (iframes, AJAX from
    # foreign origins).  Lax is the right default for a web app behind a
    # reverse proxy — explicit here so a Starlette upgrade can't silently
    # change it.
    same_site="lax",
    max_age=86_400 * 30,  # 30-day cookie TTL; per-session expiry enforced in middleware
)
# Outermost — runs last on responses, so it stamps headers on everything.
app.add_middleware(_SecurityHeadersMiddleware)
app.add_middleware(_StaticCacheMiddleware)

# GZip all text responses ≥1 KB.  Typically cuts JS/CSS/HTML 65-80%.
# Must be added AFTER the security-headers middleware so it wraps the
# whole stack and compresses the final outgoing bytes.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# When BookWorm runs behind a reverse proxy (Cloudflare Tunnel, nginx, Traefik…)
# the proxy terminates TLS and forwards requests over plain HTTP on localhost.
# BW_TRUST_PROXY=true tells uvicorn's ProxyHeadersMiddleware to read the
# X-Forwarded-Proto / X-Forwarded-For headers so:
#   • request.url.scheme becomes 'https' (required for Secure cookies)
#   • request.client.host is the real visitor IP, not 127.0.0.1
# ⚠️ Only enable this when a trusted proxy is actually in front; never on a
#     server exposed directly to the internet without a proxy.
if os.getenv("BW_TRUST_PROXY", "false").lower() == "true":
    # Trust any upstream — intentionally "*" here.
    #
    # When BW_TRUST_PROXY is enabled the app is by definition behind a
    # reverse proxy (Nginx Proxy Manager, Caddy, Traefik, Cloudflare
    # Tunnel, etc.).  In Docker deployments the proxy container reaches
    # BookWorm via the Docker bridge network (172.16-172.31.x.x or
    # 192.168.x.x), NOT from 127.0.0.1, so a localhost-only whitelist
    # silently drops every X-Forwarded-Proto header — leaving BookWorm
    # thinking it is still on HTTP even when served over HTTPS.
    #
    # Using "*" is safe here because:
    #   1. The admin has explicitly opted in with BW_TRUST_PROXY=true.
    #   2. BookWorm should NOT be directly reachable from the internet
    #      when a proxy is in front (firewall / compose ports accordingly).
    #   3. The worst a LAN client spoofing the header can do is make
    #      their own session cookie Secure — not a meaningful attack.
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.mount("/static",  StaticFiles(directory="static"),  name="static")
# NOTE: /uploads is NOT a raw StaticFiles mount — ownership is verified
# per-request by the gated route below.  The old open mount would let any
# logged-in user fetch another user’s file by guessing the UUID filename.

app.include_router(auth_router.router)
app.include_router(account_router.router)
app.include_router(totp_router.router)
app.include_router(home_router.router)
app.include_router(home_rss_router.router)
app.include_router(home_crm_router.router)
app.include_router(home_subscriptions_router.router)
app.include_router(thiings_router.router)
app.include_router(home_trip_router.router)
app.include_router(home_trip_panels_router.router)
app.include_router(home_ai_router.router)
app.include_router(home_settle_router.router)
app.include_router(home_buds_router.router)
app.include_router(home_grid_router.router)
app.include_router(home_uploads_router.router)
app.include_router(home_uploads_docs_router.router)
app.include_router(home_uploads_annot_router.router)
app.include_router(home_uploads_folders_router.router)
app.include_router(home_uploads_catalogs_router.router)
app.include_router(wopi_router.router)
app.include_router(demo_router.router)
app.include_router(note_reminders_router.router)
app.include_router(notes_router.router)
app.include_router(note_dnd_router.router)
app.include_router(attachments_router.router)
app.include_router(categories_router.router)
app.include_router(workspaces_router.router)
app.include_router(workspace_databases_router.router)
app.include_router(tutorials_router.router)
app.include_router(tutorials_autofetch_router.router)
app.include_router(sharing_router.router)
app.include_router(push_router.router)
app.include_router(webauthn_router.router)
app.include_router(search_qa_router.router)
app.include_router(quick_ask_router.router)

# ── Ownership-gated file serving ──────────────────────────────────────────────
# Replaces the old open StaticFiles mount so that logged-in users cannot
# access each other's files by guessing a UUID filename.
#
# Subdirectory routes MUST come before the generic /uploads/{filename} route
# so FastAPI matches them first (its router is first-match, not best-match).

# Extensions whose content would EXECUTE if rendered inline on BookWorm's own
# origin. An uploaded .svg/.html with an embedded <script> is otherwise stored
# XSS: opening /uploads/evil.svg directly runs the script in the app origin.
# The global X-Content-Type-Options:nosniff doesn't help — the type really IS
# svg/html, so the browser renders it. We force a download instead and pin a
# locked-down CSP. NOTE: inline <img src="/uploads/x.svg"> still works —
# Content-Disposition is ignored for image subresources, and browsers never run
# scripts in <img>-loaded SVGs. Only top-level navigation / <iframe> is changed.
_UNSAFE_INLINE_EXTS = {".svg", ".svgz", ".html", ".htm", ".xhtml", ".xml", ".js", ".mjs", ".mhtml"}


def _serve_upload_file(path, **kwargs) -> FileResponse:
    """FileResponse for a user-uploaded file, neutralising active content types.

    Dangerous types (see _UNSAFE_INLINE_EXTS) are served as an attachment with
    a no-op CSP + nosniff so they can never execute as same-origin script.
    Everything else (images, PDFs, docx, …) is served normally/inline.
    """
    if path.suffix.lower() in _UNSAFE_INLINE_EXTS:
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Content-Security-Policy", "default-src 'none'; sandbox")
        headers.setdefault("X-Content-Type-Options", "nosniff")
        return FileResponse(path=path, filename=path.name, headers=headers, **kwargs)
    return FileResponse(path=path, **kwargs)


@app.get("/uploads/crm-pics/{filename}", include_in_schema=False)
async def serve_crm_pic(request: Request, filename: str):
    """Serve a CRM profile-picture to the page owner.

    Filename pattern: c{page_id}_{contact_id}.{ext}
    Ownership: caller must own the home_pages row for that page_id.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400)
    try:
        page_id = int(filename.lstrip("c").split("_")[0])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400)
    if not await get_home_page(page_id, uid):
        raise HTTPException(status_code=403)
    path = UPLOAD_DIR / "crm-pics" / filename
    if not path.exists():
        raise HTTPException(status_code=404)
    return _serve_upload_file(path)


@app.get("/uploads/trip-covers/{filename}", include_in_schema=False)
async def serve_trip_cover(request: Request, filename: str):
    """Serve a trip cover image (loc / spot / plan) to the page owner.

    Filename patterns:
      loc{page_id}_{loc_id}.{ext}
      spot{page_id}_{spot_id}.{ext}
      plan{page_id}_{plan_id}.{ext}
    Ownership: caller must own the home_pages row for that page_id.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400)
    try:
        # Strip the alpha prefix (loc / spot / plan) then grab first numeric segment
        m = re.match(r'^[a-z]+(\d+)_', filename)
        if not m:
            raise ValueError
        page_id = int(m.group(1))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400)
    if not await get_home_page(page_id, uid):
        raise HTTPException(status_code=403)
    path = UPLOAD_DIR / "trip-covers" / filename
    if not path.exists():
        raise HTTPException(status_code=404)
    return _serve_upload_file(path)


async def _trip_panel_doc_page_id(filename: str, uid: int) -> int | None:
    """Resolve a trip resource document filename to an owned trip page id."""
    panel_id = None
    m = re.match(r"^pdoc(\d+)_", filename)
    if m:
        panel_id = int(m.group(1))

    async with get_db() as db:
        if panel_id is not None:
            cur = await db.execute(
                """
                SELECT page_id
                  FROM trip_plan_panels
                 WHERE id=? AND user_id=?
                """,
                (panel_id, uid),
            )
            row = await cur.fetchone()
            if row:
                return int(row["page_id"])
        cur = await db.execute(
            """
            SELECT page_id
              FROM trip_plan_panels
             WHERE user_id=? AND content LIKE ?
             ORDER BY id DESC
             LIMIT 1
            """,
            (uid, f"%{filename}%"),
        )
        row = await cur.fetchone()
    return int(row["page_id"]) if row else None


async def _serve_trip_panel_doc(request: Request, filename: str):
    """Serve a trip resource document to the owner of its trip page.

    Filename pattern: pdoc{panel_id}_{random}.{ext}
    Ownership: panel_id maps back to trip_plan_panels.page_id/user_id.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400)
    page_id = await _trip_panel_doc_page_id(filename, int(uid))
    if page_id is None:
        raise HTTPException(status_code=404)
    if not await get_home_page(page_id, uid):
        raise HTTPException(status_code=403)
    path = UPLOAD_DIR / "trip-panel-docs" / filename
    if not path.exists():
        raise HTTPException(status_code=404)
    return _serve_upload_file(path)


@app.get("/home/trip-docs/{filename}", include_in_schema=False)
async def serve_trip_panel_doc_home(request: Request, filename: str):
    return await _serve_trip_panel_doc(request, filename)


@app.get("/uploads/trip-panel-docs/{filename}", include_in_schema=False)
async def serve_trip_panel_doc_uploads(request: Request, filename: str):
    return await _serve_trip_panel_doc(request, filename)


@app.get("/uploads/thumb/{filename:path}", include_in_schema=False)
async def serve_upload_thumb(request: Request, filename: str, w: int = 400):
    """Serve a fast, owner-verified, disk-cached thumbnail of any uploaded image.

    Only shrinks — never upscales.  Non-image files fall through to the full
    upload route.  Thumbnails are cached under UPLOAD_DIR/_thumbs/{w}/,
    regenerated whenever the source file is newer than the cached copy.
    Served with immutable cache headers so the browser never re-fetches.
    """
    import io as _io
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)
    if ".." in filename or filename.startswith("/") or filename.startswith("\\") or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # Clamp width to a sane range
    w = max(50, min(w, 1600))

    owner_uid = await get_upload_owner(filename)
    if owner_uid is None:
        raise HTTPException(status_code=404)
    if owner_uid != uid:
        raise HTTPException(status_code=403)

    src_path = UPLOAD_DIR / filename
    if not src_path.exists():
        raise HTTPException(status_code=404)

    # Only thumbnail images — anything else: redirect to the full-res route
    import mimetypes as _mt
    mime_guess = _mt.guess_type(src_path.name)[0] or ""
    if not mime_guess.startswith("image/"):
        return _serve_upload_file(src_path)

    # Build the cache path, mirroring any subdirectory structure (e.g. db-attr-files/)
    thumb_dir  = UPLOAD_DIR / "_thumbs" / str(w)
    thumb_path = thumb_dir / filename
    thumb_path.parent.mkdir(parents=True, exist_ok=True)

    # Regenerate if the source is newer than the cached thumbnail
    src_mtime  = src_path.stat().st_mtime
    need_regen = not thumb_path.exists() or thumb_path.stat().st_mtime < src_mtime

    if need_regen:
        try:
            from PIL import Image as _PILImage, ImageOps as _ImageOps  # noqa: PLC0415
            with _PILImage.open(src_path) as img:
                img = _ImageOps.exif_transpose(img)  # auto-rotate for phone photos
                if img.width > w:          # only shrink, never upscale
                    img.thumbnail((w, w * 10), _PILImage.LANCZOS)  # cap width, free height
                buf = _io.BytesIO()
                img.save(buf, format="WEBP", quality=75)
            thumb_path.write_bytes(buf.getvalue())
        except Exception:
            # Pillow failed (e.g. SVG, corrupt file) — serve the original
            return _serve_upload_file(src_path)

    return FileResponse(
        path=thumb_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/uploads/{filename:path}", include_in_schema=False)
async def serve_upload(request: Request, filename: str):
    """Serve a user upload only to the file's owner.

    The :path modifier lets this route match nested filenames such as
    db-attr-files/{uuid}.png that are stored with a subdirectory prefix.

    Auth flow:
      1. Reject unauthenticated sessions (401).
      2. Block path-traversal sequences ('..' or leading separators).
      3. Look up the owner of *filename* across both upload tables.
      4. Return 404 if the file is unknown — avoids leaking whether it exists.
      5. Return 403 if the caller is not the owner.
      6. Serve via FileResponse (streaming, supports Range requests).
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401)

    # Block path traversal — '..' anywhere in the path is never legitimate.
    # Leading separators are also rejected so an attacker can't escape UPLOAD_DIR.
    if ".." in filename or filename.startswith("/") or filename.startswith("\\") or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    owner_uid = await get_upload_owner(filename)
    if owner_uid is None:
        raise HTTPException(status_code=404)
    if owner_uid != uid:
        raise HTTPException(status_code=403)

    disk_path = UPLOAD_DIR / filename
    if not disk_path.exists():
        raise HTTPException(status_code=404)

    return _serve_upload_file(disk_path)


# ── PWA support routes ───────────────────────────────────────────────────────

_SW_PATH = os.path.join(os.path.dirname(__file__), "static", "js", "sw.js")


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    """Serve the service worker at root scope so it controls all pages.

    Injects the current static_v into CACHE_NAME so the SW cache is
    automatically invalidated on every server restart / new deployment.
    No more manually bumping bw-shell-vN.
    """
    try:
        with open(_SW_PATH, "r", encoding="utf-8") as f:
            body = f.read()
    except FileNotFoundError:
        return Response(status_code=404)
    # Replace the hard-coded cache name with the startup-time version so
    # any deployment that restarts the server also busts the PWA cache.
    body = body.replace(
        "const CACHE_NAME  = 'bw-shell-v3';",
        f"const CACHE_NAME  = 'bw-shell-{static_v}';",
    )
    return Response(
        content=body,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/manifest.json", include_in_schema=False)
async def pwa_manifest():
    """Web-app manifest with root-relative icon paths.

    Paths start with '/' so they resolve correctly regardless of what host,
    port, or tunnel (Cloudflare, ngrok, etc.) is serving the app.  Baking
    in an absolute base URL like the old version did is an anti-pattern —
    it breaks the moment the address changes.

    Icon URLs carry a `?v=<static_v>` cache-buster: a CDN in front (Cloudflare)
    caches the PNGs, and without a changing URL a new icon stays cached for
    hours. static_v changes on every restart, so a fresh deploy → fresh icon.
    """
    from templates_env import static_v
    _v = f"?v={static_v}"
    manifest = {
        "name": "BookWorm",
        "short_name": "BookWorm",
        "description": "Team note-taking app — notes, reminders, CRM & more.",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#1b4332",
        "theme_color": "#1b4332",
        "orientation": "any",
        "categories": ["productivity", "utilities"],
        "icons": [
            {
                "src": f"/static/img/icons/icon-192.png{_v}",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": f"/static/img/icons/icon-512.png{_v}",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any",
            },
            {
                "src": f"/static/img/icons/icon-maskable-512.png{_v}",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "maskable",
            },
        ],
        "screenshots": [],
        "shortcuts": [
            {
                "name": "New Note",
                "short_name": "New Note",
                "description": "Jump straight into creating a new note",
                # Routes through /quick-note so the note always lands in the
                # user's dedicated 'Quick Notes' workspace (find-or-create),
                # with a workspace active — avoids the welcome-screen 422.
                "url": "/quick-note",
                "icons": [{"src": "/static/img/icons/shortcut-new-note-192.png",
                            "sizes": "192x192", "type": "image/png"}],
            },
            {
                "name": "My Files",
                "short_name": "My Files",
                "description": "Open your uploads & files",
                "url": "/#bw=uploads",
                "icons": [{"src": "/static/img/icons/shortcut-my-files-192.png",
                            "sizes": "192x192", "type": "image/png"}],
            },
            {
                "name": "AI Search",
                "short_name": "AI Search",
                "description": "Instant AI-powered search across your notes",
                "url": "/quick-ask",
                "icons": [{"src": "/static/img/icons/shortcut-ai-search-192.png",
                            "sizes": "192x192", "type": "image/png"}],
            },
        ],
        "share_target": {
            "action": "/quick-ask",
            "method": "GET",
            "enctype": "application/x-www-form-urlencoded",
            "params": {"text": "q"},
        },
    }
    return JSONResponse(
        content=manifest,
        # PWA manifests must never be stale — browsers and OSes cache the
        # manifest at install time.  A long max-age means shortcut URLs,
        # icons, and share_target updates are invisible until the cache
        # expires.  no-cache forces a revalidation on every request so
        # reinstalls always get the current manifest.
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/offline", response_class=HTMLResponse, include_in_schema=False)
async def offline_page(request: Request):
    """Offline fallback page cached by the service worker."""
    return templates.TemplateResponse(request, "offline.html")


@app.get("/health")
async def health():
    """Lightweight liveness probe — no auth, no DB hit, no redirects.

    Used by Docker / Kubernetes health checks so they don't trigger a
    session redirect chain. Returns 200 + JSON when the process is alive.
    """
    return {"status": "ok"}


@app.get("/quick-note")
async def quick_note(request: Request):
    """PWA 'New Note' app-shortcut target.

    The shortcut used to open ``/#bw=new-note`` directly, which landed on the
    welcome screen with NO workspace selected — so the New Note button fired
    ``/notes/form/new?workspace_id=`` (empty) and FastAPI 422'd it ("Something
    went wrong"). It also left the note with no clear home.

    This endpoint finds-or-creates a dedicated 'Quick Notes' workspace for the
    user, then bounces into the SPA with that workspace active and the
    new-note form auto-opening (the existing ``#bw=new-note`` hash handler).
    Result: the shortcut always works, and every quick note lands in one
    predictable, findable place.
    """
    user_id = request.session.get("user_id")
    if not user_id:
        return RedirectResponse(url="/login")
    ws_id = await get_or_create_quick_notes_workspace(user_id)
    # Query param (not a #fragment): a redirect's fragment isn't reliably kept
    # across browsers/PWAs, so the new-note form would fail to auto-open. The
    # SPA's shortcut handler reads ?bw=new-note and strips it after firing.
    return RedirectResponse(url=f"/?ws={ws_id}&bw=new-note")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, ws: Optional[int] = None):
    """Render the main SPA shell.

    - No workspace selected: redirect to the user's own first workspace,
      or show the welcome state if they have none yet.
    - Workspace selected: validate it actually belongs to this user before
      loading any notes (prevents account bleed-through).
    """
    user_id = request.session.get("user_id")
    log.debug("GET /  user_id=%r  ws_param=%r  session_keys=%s", user_id, ws, list(request.session.keys()))

    # ── resolve active workspace ──────────────────────────────────────────
    if ws is None:
        # Find *this* user's first workspace — never fall back to ws=1.
        # Always show the welcome page on initial load — the user picks
        # a workspace from the sidebar. No auto-redirect to first_ws.
        pass  # fall through with active_ws_id=None → welcome state

    # ── guard: ensure the requested workspace belongs to this user ────────
    all_workspaces = await get_all_workspaces(user_id)
    user_ws_ids    = {w["id"] for w in all_workspaces}

    if ws is not None and ws not in user_ws_ids:
        # Someone navigated to another user's workspace (or a stale URL).
        # Send them to their own landing instead.
        first_ws = await get_first_workspace_id(user_id)
        redirect_to = f"/?ws={first_ws}" if first_ws else "/"
        return RedirectResponse(url=redirect_to)

    active_ws_id = ws  # None → welcome state; int → validated user workspace
    log.debug("GET /  active_ws_id=%r  user_ws_ids=%s", active_ws_id, user_ws_ids)

    open_workspaces = await get_open_workspaces(user_id)
    ws_tree         = await get_workspace_tree(user_id)
    open_ws_ids     = {w["id"] for w in open_workspaces}
    ws_id_set = await get_descendant_ids(active_ws_id) if active_ws_id is not None else None
    notes     = await search_notes(workspace_ids=list(ws_id_set)) if ws_id_set is not None else []
    if notes:
        _shared = await get_shared_object_ids("note", [n["id"] for n in notes])
        for note in notes:
            note["has_share_link"] = note["id"] in _shared
    categories      = await get_categories_for_workspace(active_ws_id)
    attr_defs       = await get_all_attr_defs()
    breadcrumbs: dict = {}
    for ow in open_workspaces:
        breadcrumbs[ow["id"]] = await get_workspace_breadcrumb(ow["id"], user_id)
    # also include the active workspace even if it isn't pinned to the top bar
    if active_ws_id is not None and active_ws_id not in breadcrumbs:
        breadcrumbs[active_ws_id] = await get_workspace_breadcrumb(active_ws_id, user_id)
    trashed_workspaces = await get_trashed_workspaces(user_id)
    home_pages         = await get_home_pages(user_id)
    trashed_hp          = await get_trashed_home_pages(user_id)
    trashed_home_pages  = trashed_hp
    current_username = request.session.get("username", "")
    current_role     = request.session.get("role", "user")
    # Determine if the active workspace is a database node, and load its cards.
    # Required so the initial hard-refresh render shows the card grid, not
    # note_list.html (which knows nothing about database workspaces).
    active_ws_type = "workspace"
    db_cards: list = []
    if active_ws_id is not None:
        ws_row = next((w for w in all_workspaces if w["id"] == active_ws_id), None)
        if ws_row:
            active_ws_type = ws_row.get("ws_type") or "workspace"
            if active_ws_type == "database":
                db_cards = await get_db_cards(db_id=active_ws_id, user_id=user_id)
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "current_username":   current_username,
            "current_user_id":    user_id,
            "current_role":       current_role,
            "notes":              notes,
            "categories":         categories,
            "attr_defs":          attr_defs,
            "today":              date.today().isoformat(),
            "open_workspaces":    open_workspaces,
            "all_workspaces":     all_workspaces,
            "ws_tree":            ws_tree,
            "trashed_workspaces": trashed_workspaces,
            "breadcrumbs":        breadcrumbs,
            "active_ws_id":       active_ws_id,
            "open_count":         len(open_workspaces),
            "open_ws_ids":        open_ws_ids,
            "active_ws_type":     active_ws_type,
            "db_cards":           db_cards,
            "home_pages":         home_pages,
            "trashed_home_pages": trashed_home_pages,
            "is_demo":            request.session.get("is_demo", False),
            "demo_expires_at":    request.session.get("demo_expires_at"),
            "current_user_id":    user_id,
        },
    )
    # Prevent the browser from caching this page — it is user-specific and must
    # always be fetched fresh so a new login never sees a previous user's data.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response
