"""Auth DB helpers — user creation, lookup, password hashing."""
import os
import bcrypt
from database import get_db


# ── password helpers ──────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── read helpers ──────────────────────────────────────────────

async def user_count() -> int:
    async with get_db() as db:
        cur = await db.execute("SELECT COUNT(*) FROM users")
        row = await cur.fetchone()
        return row[0]


async def get_user_by_username(username: str) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_user_by_id(user_id: int) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, username, role, created_at FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_all_users() -> list[dict]:
    """Return all users (superadmin panel)."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY id ASC"
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


# ── auth ──────────────────────────────────────────────────────

async def authenticate(username: str, password: str) -> dict | None:
    """Return user dict (with role) if credentials are valid, else None."""
    user = await get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


# ── write helpers ─────────────────────────────────────────────

async def create_user(
    username: str,
    password: str,
    role: str = "user",
) -> int:
    """Create a user and return their new id."""
    hashed = hash_password(password)
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, hashed, role),
        )
        await db.commit()
        return cur.lastrowid


async def delete_user(user_id: int) -> list[str]:
    """Fully delete a user and ALL their data. Returns disk filenames to unlink.

    Deletion order (respects FK constraints with foreign_keys=ON):
      1. Collect attachment filenames for disk cleanup (DB rows cascade from notes).
      2. DELETE notes in user's workspaces   -> cascades note_categories,
         note_attributes, note_attachments.
      3. DELETE workspaces                   -> cascades workspace_categories.
      4. DELETE user                         -> cascades home_pages -> home_widgets.
    """
    async with get_db() as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # 1. Grab attachment filenames before notes disappear.
        cur = await db.execute(
            "SELECT a.filename FROM note_attachments a "
            "JOIN notes n ON a.note_id = n.id "
            "JOIN workspaces w ON n.workspace_id = w.id "
            "WHERE w.user_id = ?",
            (user_id,),
        )
        filenames = [r[0] for r in await cur.fetchall()]

        # 2. Notes (cascades note_categories, note_attributes, note_attachments).
        await db.execute(
            "DELETE FROM notes WHERE workspace_id IN "
            "(SELECT id FROM workspaces WHERE user_id = ?)",
            (user_id,),
        )

        # 3. Workspaces (cascades workspace_categories).
        await db.execute("DELETE FROM workspaces WHERE user_id = ?", (user_id,))

        # 4. User row (cascades home_pages -> home_widgets).
        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))

        await db.commit()
        return filenames


async def update_username(user_id: int, new_username: str) -> None:
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET username = ? WHERE id = ?",
            (new_username, user_id),
        )
        await db.commit()


async def update_password(user_id: int, new_password: str) -> None:
    hashed = hash_password(new_password)
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hashed, user_id),
        )
        await db.commit()


# ── site settings ───────────────────────────────────────────────────

async def get_registration_open() -> bool:
    """Read registration_open from site_settings (DB-authoritative after first boot)."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT value FROM site_settings WHERE key = 'registration_open'"
        )
        row = await cur.fetchone()
        if row is None:
            # Table not yet migrated (very first request before init_db completes)
            return os.getenv("BW_ALLOW_REGISTRATION", "true").lower() == "true"
        return row["value"] == "true"


async def set_registration_open(value: bool) -> None:
    """Persist registration_open toggle to site_settings."""
    async with get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO site_settings (key, value) VALUES ('registration_open', ?)",
            ("true" if value else "false",),
        )
        await db.commit()


async def get_unlimited_uploads() -> bool:
    """Return True when superadmin has lifted the per-file upload size cap."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT value FROM site_settings WHERE key = 'unlimited_uploads'"
        )
        row = await cur.fetchone()
        return row is not None and row["value"] == "true"


async def set_unlimited_uploads(value: bool) -> None:
    """Persist unlimited_uploads toggle to site_settings."""
    async with get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO site_settings (key, value) VALUES ('unlimited_uploads', ?)",
            ("true" if value else "false",),
        )
        await db.commit()