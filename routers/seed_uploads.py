"""Seed default flower uploads for every new account (real and demo).

Called immediately after a user row is created — from auth.py (setup &
register), account.py (admin-create), and demo.py (_seed_demo).

Design decisions
----------------
* Each user gets their own UUID-named copies of the PNGs so that a
  user deleting a flower from their page never affects anyone else.
* Idempotent: if the user already has a home page named _PAGE_NAME
  (even if created manually) the function returns early without touching
  anything.
* Non-fatal: any individual file copy failure is logged and skipped so
  a missing static asset can't break account creation.
"""
import logging
import shutil
import uuid
from pathlib import Path

from database import get_db
from routers.attachments_db import UPLOAD_DIR

log = logging.getLogger(__name__)

# Source directory — these are the flower growth-stage PNGs used by the
# Buds widget.  They live in version-controlled static assets.
_STATIC_BUDS = Path("static/img/buds")

# Non-flower files that live in the same directory — skip them.
_SKIP: frozenset[str] = frozenset({"buds_bg.png", "icon.png", "Tinh1.png"})

# Home-page settings for the auto-created uploads page.
_PAGE_NAME  = "My Flowers"
_PAGE_EMOJI = "🌸"


async def seed_flower_uploads(user_id: int) -> None:
    """Create a '🌸 My Flowers' uploads page and populate it with all flower PNGs.

    Safe to call multiple times — does nothing if the page already exists.
    """
    if not _STATIC_BUDS.exists():
        log.warning("seed_flower_uploads: %s not found — skipping", _STATIC_BUDS)
        return

    flowers = sorted(
        p for p in _STATIC_BUDS.iterdir()
        if p.suffix.lower() == ".png" and p.name not in _SKIP
    )
    if not flowers:
        log.warning("seed_flower_uploads: no flower PNGs found in %s", _STATIC_BUDS)
        return

    async with get_db() as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # ── Idempotency check ──────────────────────────────────────────
        cur = await db.execute(
            "SELECT id FROM home_pages"
            " WHERE user_id = ? AND name = ? AND deleted_at IS NULL",
            (user_id, _PAGE_NAME),
        )
        if await cur.fetchone():
            return  # already seeded for this user

        # ── Create the uploads home page ───────────────────────────────
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM home_pages WHERE user_id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        next_sort = (row[0] if row else 0) + 10

        cur = await db.execute(
            "INSERT INTO home_pages(user_id, name, emoji, sort_order, page_type)"
            " VALUES (?, ?, ?, ?, 'uploads')",
            (user_id, _PAGE_NAME, _PAGE_EMOJI, next_sort),
        )
        page_id = cur.lastrowid

        # ── Copy flowers and insert upload records ─────────────────────
        seeded = 0
        for src in flowers:
            dest_name = f"{uuid.uuid4().hex}{src.suffix}"
            dest      = UPLOAD_DIR / dest_name
            try:
                shutil.copy2(src, dest)
                size = dest.stat().st_size
            except OSError as exc:
                log.warning(
                    "seed_flower_uploads: failed to copy %s → %s: %s",
                    src.name, dest_name, exc,
                )
                continue

            await db.execute(
                "INSERT INTO page_uploads"
                "  (page_id, user_id, filename, original_name, mime_type, size)"
                " VALUES (?, ?, ?, ?, 'image/png', ?)",
                (page_id, user_id, dest_name, src.name, size),
            )
            seeded += 1

        await db.commit()

    log.info(
        "seed_flower_uploads: created '%s' page (id=%d) with %d flowers for user_id=%d",
        _PAGE_NAME, page_id, seeded, user_id,
    )
