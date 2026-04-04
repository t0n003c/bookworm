"""Auth DB helpers — user creation, lookup, password hashing."""
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


async def delete_user(user_id: int) -> None:
    """Hard-delete a user account.

    Their workspaces are orphaned (user_id set to NULL) but NOT deleted,
    so data is preserved and can be reassigned later by a superadmin.
    """
    async with get_db() as db:
        # Orphan their workspaces rather than cascading delete
        await db.execute(
            "UPDATE workspaces SET user_id = NULL WHERE user_id = ?", (user_id,)
        )
        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()


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