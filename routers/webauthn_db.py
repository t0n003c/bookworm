"""WebAuthn credential DB helpers — per-device biometric sign-in storage."""
from database import get_db


async def save_credential(
    user_id: int,
    credential_id: str,
    public_key: str,
    sign_count: int,
    device_name: str,
) -> None:
    """Store a newly registered WebAuthn credential (base64url-encoded fields)."""
    async with get_db() as db:
        await db.execute(
            """INSERT INTO webauthn_credentials
               (user_id, credential_id, public_key, sign_count, device_name)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, credential_id, public_key, sign_count, device_name),
        )
        await db.commit()


async def get_credentials(user_id: int) -> list[dict]:
    """Return all credentials for a user (id, device_name, created_at, last_used_at)."""
    async with get_db() as db:
        cur = await db.execute(
            """SELECT id, credential_id, device_name, created_at, last_used_at
               FROM webauthn_credentials
               WHERE user_id = ?
               ORDER BY created_at""",
            (user_id,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def has_credentials(user_id: int) -> bool:
    """Return True if the user has at least one registered WebAuthn credential."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM webauthn_credentials WHERE user_id = ? LIMIT 1",
            (user_id,),
        )
        return await cur.fetchone() is not None


async def get_all_credential_ids(user_id: int) -> list[str]:
    """Return all base64url credential IDs for a user (used to build allowCredentials)."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT credential_id FROM webauthn_credentials WHERE user_id = ?",
            (user_id,),
        )
        rows = await cur.fetchall()
        return [r["credential_id"] for r in rows]


async def get_credential_by_id(credential_id: str) -> dict | None:
    """Look up a credential by its base64url credential_id."""
    async with get_db() as db:
        cur = await db.execute(
            """SELECT id, user_id, credential_id, public_key, sign_count, device_name
               FROM webauthn_credentials
               WHERE credential_id = ?""",
            (credential_id,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def update_sign_count(credential_id: str, new_count: int) -> None:
    """Update the sign_count and last_used_at after a successful authentication."""
    async with get_db() as db:
        await db.execute(
            """UPDATE webauthn_credentials
               SET sign_count = ?, last_used_at = datetime('now')
               WHERE credential_id = ?""",
            (new_count, credential_id),
        )
        await db.commit()


async def delete_credential(cred_id: int, user_id: int) -> bool:
    """Delete a credential by row id, scoped to user_id for safety."""
    async with get_db() as db:
        cur = await db.execute(
            "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?",
            (cred_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0
