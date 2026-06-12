"""Recovery (backup) codes — one-time 2FA fallback.

Codes are high-entropy random strings, so a fast hash (sha256 of the normalised
code) is sufficient — there's nothing to brute-force. Each code is single-use
(`used_at`); generating a new set wipes the old one. Verification consumes the
code atomically so a code can never be replayed.
"""
import hashlib
import secrets

from app.core.db import get_db

# Crockford-ish alphabet — no 0/O/1/I/L to avoid transcription mistakes.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE_LEN = 10          # → formatted as XXXXX-XXXXX
_DEFAULT_N = 10


def _normalise(code: str) -> str:
    """Strip spaces/dashes and uppercase so user input is forgiving."""
    return "".join(c for c in code.upper() if c.isalnum())


def _hash(normalised: str) -> str:
    return hashlib.sha256(normalised.encode()).hexdigest()


def _new_code() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LEN))
    return f"{raw[:5]}-{raw[5:]}"


async def generate_recovery_codes(user_id: int, n: int = _DEFAULT_N) -> list[str]:
    """Replace any existing codes with a fresh set; return the plaintext once."""
    codes = [_new_code() for _ in range(n)]
    async with get_db() as db:
        await db.execute("DELETE FROM recovery_codes WHERE user_id = ?", (user_id,))
        for c in codes:
            await db.execute(
                "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)",
                (user_id, _hash(_normalise(c))),
            )
        await db.commit()
    return codes


async def verify_and_consume_recovery_code(user_id: int, code: str) -> bool:
    """Return True if `code` is a valid unused code for the user, and consume it."""
    norm = _normalise(code)
    if not norm:
        return False
    h = _hash(norm)
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id FROM recovery_codes "
            "WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
            (user_id, h),
        )
        row = await cur.fetchone()
        if not row:
            return False
        # Atomic consume — only succeeds if still unused (guards against races).
        upd = await db.execute(
            "UPDATE recovery_codes SET used_at = CURRENT_TIMESTAMP "
            "WHERE id = ? AND used_at IS NULL",
            (row[0],),
        )
        await db.commit()
        return upd.rowcount == 1


async def count_unused_recovery_codes(user_id: int) -> int:
    async with get_db() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
            (user_id,),
        )
        return (await cur.fetchone())[0]
