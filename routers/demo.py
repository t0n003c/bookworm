"""Demo mode — ephemeral sessions for unauthenticated visitors.

Each click of "Try Demo" on the login page:
  1. Purges any demo users older than 24 h (cascade-deletes their data).
  2. Creates a fresh temp user (username: demo_<12-char uuid hex>, role: demo).
  3. Seeds that user with example workspaces, notes, a home page + widgets.
  4. Logs them in as a SESSION-ONLY cookie (no expires_at → dies with the tab).
  5. Redirects to /.

Nothing the demo user does is visible to real users (data is per-user in SQLite).
"""
import asyncio
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from database import get_db
from routers.attachments_db import UPLOAD_DIR
from routers.auth_db import delete_user, hash_password
from routers.seed_uploads import seed_flower_uploads

log = logging.getLogger(__name__)
router = APIRouter()

_DEMO_PREFIX       = "demo_"
_DEMO_SESSION_HOURS = 2   # session cookie hard limit for demo users

# Set BW_DEMO_ENABLED=false to remove the "Try Demo" button and disable the
# route entirely — useful for private team deployments.
_DEMO_ENABLED = os.getenv("BW_DEMO_ENABLED", "true").lower() == "true"


# ── Cleanup ───────────────────────────────────────────────────────────────────

async def purge_old_demo_users() -> int:
    """Delete demo users created more than 2 h ago, plus ALL their data.

    Delegates to delete_user() so there is exactly one deletion path —
    no risk of this function and delete_user() drifting out of sync.
    Also cleans up attachment files from disk (demo users rarely have
    uploads, but correctness matters).
    """
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM users "
            "WHERE role = 'demo' "
            "AND created_at < datetime('now', '-2 hours')",
        )
        stale_ids = [r[0] for r in await cur.fetchall()]

    if not stale_ids:
        return 0

    all_filenames: list[str] = []
    for uid in stale_ids:
        all_filenames += await delete_user(uid)

    for name in all_filenames:
        try:
            (UPLOAD_DIR / name).unlink(missing_ok=True)
        except OSError:
            pass

    return len(stale_ids)


# ── Seed data ─────────────────────────────────────────────────────────────────

_NOTE_SYNC = """\
## Agenda

- [ ] Q2 OKR check-in
- [ ] Blocker review
- [x] Announce new tool: **BookWorm** 📚
- [ ] Open floor

## Attendees

| Name | Role | Status |
|------|------|--------|
| Alex | Product Lead | ✅ Present |
| Sam | Engineering | ✅ Present |
| Riley | Design | 🟡 Remote |
| Jordan | QA | ❌ Absent |

## Key Decisions

> **Decided:** BookWorm will be adopted as the team's primary note-taking tool starting this week.

## Action Items

- [ ] @Alex — Share onboarding guide by EOD Friday
- [ ] @Sam — Migrate old Confluence notes by Apr 14
- [ ] @Riley — Design new workspace icons (due Apr 10)

## Notes

Great energy today! The team is excited about slash-commands and the live Markdown preview.\
"""

_NOTE_ROADMAP = """\
# Q2 2026 — Grocery Team Roadmap

## Strategic Goals

1. **Reduce out-of-stocks** by 15% across produce
2. **Improve shrink tracking** with weekly audits
3. **Launch** self-checkout pilot in 3 stores

## Milestone Timeline

| Milestone | Owner | Due Date | Status |
|-----------|-------|----------|--------|
| Pilot store selection | Alex | Apr 15 | 🔄 In Progress |
| Vendor negotiation | Jordan | Apr 28 | ⏳ Pending |
| Staff training | Riley | May 5 | ⏳ Pending |
| Go-live | Sam | May 20 | ⏳ Pending |

## Risks

> ⚠️ Supply chain delays may push vendor negotiation to late April.  
> Mitigation: engage backup vendor by Apr 21.

## Success Metrics

- Out-of-stock rate: **< 3%** (currently 17.8 %)
- Shrink delta: **< 0.8 %** (currently 1.1 %)
- Customer satisfaction: **≥ 4.2 / 5** post-pilot survey\
"""

_NOTE_GUIDE = """\
# Welcome to BookWorm 📚

BookWorm is your team's smart, Markdown-powered note hub. Here's what you can do!

## ✏️ Writing Notes

Type in the **Markdown editor** and watch the live preview update in real time.  
Switch between **Markdown**, **Split**, or **Preview** modes using the toolbar buttons.

## ⚡ Slash Commands

Type `/` at the start of any line to open the **command palette**:

| Command | Result |
|---------|--------|
| `/heading` | Insert H1–H3 headings |
| `/table` | Insert a Markdown table |
| `/todo` | Checkbox checklist |
| `/code` | Fenced code block |
| `/columns` | Side-by-side layout |
| `/details` | Collapsible section |

## 🗂 Workspaces

Organize notes into **Workspaces** — nestable folders. Drag-and-drop to reorder,  
click ⭐ to favorite your most-visited ones.

## 🏠 Home Pages

Build personal **dashboards** with drag-and-drop widgets:

- 🕐 Clock & Stopwatch
- 📋 Todo lists
- 🔗 Note links
- 📅 Event calendar
- 📝 Sticky notes
- 💬 Quote of the day

## 💡 Pro Tips

- Press `Ctrl+K` to search across all your notes
- Drag the `⠿` grip in Preview mode to reorder content blocks
- Right-click any word for instant spell-check suggestions\
"""

_NOTE_RETRO = """\
# Sprint 7 Retrospective — Mar 31

## 🟢 What Went Well

- Delivered the **self-checkout UX** ahead of schedule
- Team communication improved noticeably this sprint
- Zero production incidents 🎉

## 🔴 What Didn't Go Well

- Story estimation was off by ~40 % on the scanning module
- Two items blocked by an external API dependency for 3 days

## 🔵 Action Items

- [ ] Break large stories into sub-tasks during grooming (Owner: Sam)
- [ ] Create a dependency registry to surface blockers early (Owner: Alex)
- [ ] Schedule "estimation workshop" for sprint kickoff (Owner: Riley)

## Team Mood

> "Energized and optimistic — let's carry this momentum into Q2!" — Jordan

---

*Next retro: Apr 28*\
"""


async def _seed_demo(user_id: int) -> None:
    """Populate a fresh demo user with workspaces, notes, home page, and widgets."""
    async with get_db() as db:
        await db.execute("PRAGMA foreign_keys = ON")
        today = str(date.today())

        # ── Workspaces ────────────────────────────────────────────────────
        cur = await db.execute(
            "INSERT INTO workspaces(user_id, name, emoji, sort_order) VALUES(?,?,?,?)",
            (user_id, "Team Notes", "📋", 10),
        )
        ws_team = cur.lastrowid

        cur = await db.execute(
            "INSERT INTO workspaces(user_id, name, emoji, parent_id, sort_order)"
            " VALUES(?,?,?,?,?)",
            (user_id, "Q2 Planning", "📊", ws_team, 20),
        )
        ws_q2 = cur.lastrowid

        await db.execute(
            "INSERT INTO workspaces(user_id, name, emoji, sort_order) VALUES(?,?,?,?)",
            (user_id, "Archive", "🗂", 30),
        )

        # ── Link all workspaces to all categories (workspace_categories) ────
        # The init_db backfill only runs at startup for existing rows;
        # demo workspaces created afterwards are left with 0 links.
        await db.execute(
            """
            INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id)
            SELECT w.id, c.id
            FROM workspaces w CROSS JOIN categories c
            WHERE w.user_id = ?
            """,
            (user_id,),
        )

        # ── Categories (global table — INSERT OR IGNORE avoids duplicates) ──
        for name, color, desc in [
            ("Team Meeting", "#0053e2", "General team meeting notes"),
            ("Action Items", "#ea1100", "Tasks and follow-ups"),
            ("Planning",     "#ffc220", "Sprint or project planning"),
            ("Retrospective","#995213", "Retro and improvement notes"),
        ]:
            await db.execute(
                "INSERT OR IGNORE INTO categories(name, color, description) VALUES(?,?,?)",
                (name, color, desc),
            )

        async def _cat(name: str) -> int | None:
            cur = await db.execute("SELECT id FROM categories WHERE name=?", (name,))
            row = await cur.fetchone()
            return row[0] if row else None

        cat_meeting = await _cat("Team Meeting")
        cat_action  = await _cat("Action Items")
        cat_planning = await _cat("Planning")
        cat_retro   = await _cat("Retrospective")

        # ── Notes ─────────────────────────────────────────────────────────
        async def _note(ws_id, title, content):
            cur = await db.execute(
                "INSERT INTO notes(workspace_id, title, content, meeting_date)"
                " VALUES(?,?,?,?)",
                (ws_id, title, content, today),
            )
            return cur.lastrowid

        note_sync    = await _note(ws_team, "📅 Weekly Team Sync — Apr 7", _NOTE_SYNC)
        note_roadmap = await _note(ws_q2,   "🎯 Q2 Goals & Roadmap",       _NOTE_ROADMAP)
        note_guide   = await _note(ws_team, "📖 Getting Started with BookWorm", _NOTE_GUIDE)
        note_retro   = await _note(ws_q2,   "🔁 Sprint 7 Retrospective",    _NOTE_RETRO)

        # ── Note ↔ Category links ─────────────────────────────────────────
        def _nc(note_id, cat_id):
            return (note_id, cat_id)

        links = [
            (note_sync,    cat_meeting),
            (note_sync,    cat_action),
            (note_roadmap, cat_planning),
            (note_retro,   cat_retro),
            (note_retro,   cat_action),
        ]
        for note_id, cat_id in links:
            if cat_id:
                await db.execute(
                    "INSERT OR IGNORE INTO note_categories VALUES(?,?)", (note_id, cat_id)
                )

        # ── Home page ─────────────────────────────────────────────────────
        cur = await db.execute(
            "INSERT INTO home_pages(user_id, name, emoji, sort_order, config_json)"
            " VALUES(?,?,?,?,?)",
            (user_id, "My Dashboard", "🏠", 1, json.dumps({"col_count": 3})),
        )
        page_id = cur.lastrowid

        # ── Widgets ───────────────────────────────────────────────────────
        widgets = [
            # (widget_type, style, config_dict, sort_order)
            ("title", "default", {
                "text":     "👋 Welcome to BookWorm!",
                "subtitle": "Demo mode — explore freely, nothing saves permanently.",
                "align":    "center",
            }, 10),
            ("clock", "default", {
                "label":    "Team Time",
                "timezone": "America/Chicago",
            }, 20),
            ("note_link", "default", {
                "note_id":    note_guide,
                "note_title": "📖 Getting Started with BookWorm",
            }, 30),
            ("todo", "default", {
                "title": "Try These Out ✅",
                "items": [
                    {"text": "Open a note and edit it",            "done": False},
                    {"text": "Type / in the editor",               "done": False},
                    {"text": "Create a new workspace",             "done": False},
                    {"text": "Add a widget to this page",          "done": True},
                    {"text": "Switch to Split or Preview mode",    "done": False},
                ],
            }, 40),
            ("text", "default", {
                "content": (
                    "## About This Demo\n\n"
                    "This is a **live preview** of BookWorm in action.\n\n"
                    "Feel free to create, edit, and delete notes. "
                    "Everything exists only for your current session and disappears "
                    "when you close the browser.\n\n"
                    "Ready to use it for real? **Sign up for an account** — it's free!"
                ),
            }, 50),
            ("sticky", "paper", {
                "content": (
                    "📌 **Pro tip:** Type `/` at the start of any "
                    "line in the editor to open the slash-command palette!"
                ),
            }, 60),
        ]

        for wtype, style, cfg, sort in widgets:
            await db.execute(
                "INSERT INTO home_widgets(page_id, widget_type, style, config_json, sort_order)"
                " VALUES(?,?,?,?,?)",
                (page_id, wtype, style, json.dumps(cfg), sort),
            )

        await db.commit()


# ── In-memory pending-deletion registry ──────────────────────────────────────
# Maps demo user_id → asyncio.Task that will delete the user after a grace
# period.  Populated by the pagehide beacon (/demo/pre-end); cancelled by the
# first request on a page refresh (/demo/cancel-end).
# Lives in process memory — survives across requests but not server restarts
# (background purge handles any stragglers left after a restart).
_pending_delete: dict[int, "asyncio.Task[None]"] = {}


async def _run_delete_after(uid: int, delay: float = 5.0) -> None:
    """Sleep for `delay` seconds then actually delete the demo user."""
    try:
        await asyncio.sleep(delay)
    except asyncio.CancelledError:
        return                      # refresh cancel arrived in time — bail out
    _pending_delete.pop(uid, None)
    # Re-check the user still exists and is still a demo account
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM users WHERE id=? AND role='demo'", (uid,)
        )
        if not await cur.fetchone():
            return   # already deleted (admin, duplicate beacon, etc.)
    filenames = await delete_user(uid)
    for name in filenames:
        try:
            (UPLOAD_DIR / name).unlink(missing_ok=True)
        except OSError:
            pass
    log.info("Demo: auto-deleted user id=%d after tab close", uid)


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/demo/pre-end")
async def demo_pre_end(request: Request) -> Response:
    """Pagehide beacon — schedule deletion after a 5-second grace period.

    Does NOT clear the session cookie so that a page refresh can fire
    /demo/cancel-end and cancel the pending task before it executes.
    Safe to call multiple times (idempotent: won't schedule twice).
    """
    uid     = request.session.get("user_id")
    is_demo = request.session.get("is_demo", False)
    if uid and is_demo and uid not in _pending_delete:
        task = asyncio.get_event_loop().create_task(_run_delete_after(uid))
        _pending_delete[uid] = task
        log.debug("Demo: scheduled deletion for user id=%d (5s grace)", uid)
    return Response(status_code=204)


@router.post("/demo/cancel-end")
async def demo_cancel_end(request: Request) -> Response:
    """Called on page refresh to cancel a pending deletion.

    The client sends this immediately on page load if sessionStorage contains
    the 'bw_demo_ending' flag set by the pagehide handler.
    """
    uid = request.session.get("user_id")
    if uid:
        task = _pending_delete.pop(uid, None)
        if task:
            task.cancel()
            log.debug("Demo: cancelled pending deletion for user id=%d (refresh)", uid)
    return Response(status_code=204)


@router.post("/demo/start")
async def demo_start(request: Request):
    """Spin up a temporary demo user, seed example data, and log them in."""
    if not _DEMO_ENABLED:
        return RedirectResponse("/login", status_code=302)
    purged = await purge_old_demo_users()
    if purged:
        log.info("Demo: purged %d stale demo user(s)", purged)

    # Unique slug avoids username collision for concurrent demo sessions
    username = f"{_DEMO_PREFIX}{uuid.uuid4().hex[:12]}"
    pw_hash  = hash_password(uuid.uuid4().hex)   # random, never used

    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO users(username, password_hash, role) VALUES(?,?,?)",
            (username, pw_hash, "demo"),
        )
        await db.commit()
        user_id = cur.lastrowid

    log.info("Demo: created user %s (id=%d)", username, user_id)
    await _seed_demo(user_id)
    await seed_flower_uploads(user_id)

    # Session with a hard 2-hour expiry so auth middleware auto-redirects
    # to /login when time is up — no manual polling needed.
    expires = datetime.now(timezone.utc) + timedelta(hours=_DEMO_SESSION_HOURS)
    expires_iso = expires.isoformat()

    request.session["user_id"]        = user_id
    request.session["username"]       = username
    request.session["role"]           = "demo"
    request.session["is_demo"]        = True
    request.session["expires_at"]     = expires_iso   # read by session_is_expired()
    request.session["demo_expires_at"] = expires_iso  # read by the countdown timer

    return RedirectResponse("/", status_code=302)


@router.post("/demo/end")
async def demo_end(request: Request) -> Response:
    """Immediately delete the calling demo user and clear their session.

    Called two ways:
      1. navigator.sendBeacon() on pagehide  — fires when the tab/browser closes.
      2. Explicit 'End Demo' button click    — lets the user clean up on demand.

    Safe to call multiple times (idempotent): if the user is already gone
    the delete is a no-op. Returns 204 so beacons don't wait for a body.
    """
    uid     = request.session.get("user_id")
    is_demo = request.session.get("is_demo", False)

    if uid and is_demo:
        try:
            filenames = await delete_user(uid)
            for name in filenames:
                try:
                    (UPLOAD_DIR / name).unlink(missing_ok=True)
                except OSError:
                    pass
        except Exception:
            log.exception("demo_end: error deleting demo user %s", uid)

    request.session.clear()
    return Response(status_code=204)


@router.get("/demo/alive")
async def demo_alive(request: Request) -> JSONResponse:
    """Heartbeat for the client-side admin-deletion poller.

    Public route (in _PUBLIC) so it stays reachable even after the user row is
    deleted.  The client polls every 20 s; when alive==false the browser shows
    the 'Admin ended your session' modal instead of letting the next HTMX
    request produce a broken half-page login.
    """
    uid     = request.session.get("user_id")
    is_demo = request.session.get("is_demo", False)
    if not uid or not is_demo:
        return JSONResponse({"alive": False})
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM users WHERE id = ? AND role = 'demo'", (uid,)
        )
        row = await cur.fetchone()
    return JSONResponse({"alive": row is not None})
