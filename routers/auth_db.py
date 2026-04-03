"""Auth DB helpers — user creation, lookup, password hashing."""
import bcrypt
from database import get_db


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


async def user_count() -> int:
    async with get_db() as db:
        cur = await db.execute("SELECT COUNT(*) FROM users")
        row = await cur.fetchone()
        return row[0]


async def get_user_by_username(username: str) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def get_user_by_id(user_id: int) -> dict | None:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def authenticate(username: str, password: str) -> dict | None:
    """Return user dict if credentials are valid, else None."""
    user = await get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


async def create_user(username: str, password: str) -> int:
    hashed = hash_password(password)
    async with get_db() as db:
        cur = await db.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hashed),
        )
        await db.commit()
        return cur.lastrowid


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