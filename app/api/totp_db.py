"""TOTP DB helpers — read/write 2FA fields on the users table."""
import pyotp
from database import get_db


async def get_totp_status(user_id: int) -> dict:
    """Return {totp_enabled: bool, totp_secret: str|None} for a user."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT totp_enabled, totp_secret FROM users WHERE id = ?",
            (user_id,),
        )
        row = await cur.fetchone()
        if not row:
            return {"totp_enabled": False, "totp_secret": None}
        return {
            "totp_enabled": bool(row["totp_enabled"]),
            "totp_secret":  row["totp_secret"],
        }


async def save_pending_secret(user_id: int, secret: str) -> None:
    """Persist a pending TOTP secret (not yet enabled)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET totp_secret = ? WHERE id = ?",
            (secret, user_id),
        )
        await db.commit()


async def enable_totp(user_id: int) -> None:
    """Mark TOTP as enabled for a user (secret already saved)."""
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET totp_enabled = 1 WHERE id = ?",
            (user_id,),
        )
        await db.commit()


async def disable_totp(user_id: int) -> None:
    """Disable TOTP and wipe the secret."""
    async with get_db() as db:
        await db.execute(
            "UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?",
            (user_id,),
        )
        await db.commit()


def verify_totp_code(secret: str, code: str) -> bool:
    """Return True if code is valid for secret (±1 window = 90-second grace)."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code.strip(), valid_window=1)


def make_totp_uri(secret: str, username: str) -> str:
    """Return an otpauth:// URI suitable for QR code generation."""
    return pyotp.TOTP(secret).provisioning_uri(
        name=username, issuer_name="BookWorm"
    )
