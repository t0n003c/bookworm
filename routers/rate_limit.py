"""In-process sliding-window rate limiter for login / 2FA endpoints.

Zero external dependencies — uses only stdlib collections and time.

Design
------
- One deque of monotonic timestamps per (IP, endpoint) key.
- Sliding window: only attempts within the last _WINDOW_SECS count.
- Once a key exceeds _MAX_FAILURES within the window it is hard-blocked
  until _LOCKOUT_SECS have elapsed, then the slate is wiped.
- record_success() clears counters on a correct credential so legitimate
  users who typo'd once aren't penalised after they get it right.
- State is in-process memory: resets on server restart and is not shared
  across worker processes.  For a single-worker deployment (the default
  uvicorn setup BookWorm uses) this is sufficient.

Tune via env vars if needed:
  BW_RL_WINDOW_SECS   (default 600  — 10 min sliding window)
  BW_RL_MAX_FAILURES  (default 5    — failures before lockout)
  BW_RL_LOCKOUT_SECS  (default 900  — 15 min lockout)
"""
from __future__ import annotations

import os
from collections import defaultdict, deque
from time import monotonic

from fastapi import HTTPException

_WINDOW_SECS: float = float(os.getenv("BW_RL_WINDOW_SECS", "600"))
_MAX_FAILURES: int  = int(os.getenv("BW_RL_MAX_FAILURES", "5"))
_LOCKOUT_SECS: float = float(os.getenv("BW_RL_LOCKOUT_SECS", "900"))

# { key -> deque of monotonic timestamps of recent failures }
_attempts: dict[str, deque] = defaultdict(deque)
# { key -> monotonic time when the hard block expires }
_blocked_until: dict[str, float] = {}


def _evict(key: str) -> None:
    """Drop timestamps older than the sliding window for *key*."""
    cutoff = monotonic() - _WINDOW_SECS
    dq = _attempts[key]
    while dq and dq[0] < cutoff:
        dq.popleft()


def check_rate_limit(key: str) -> None:
    """Raise HTTP 429 if *key* is currently blocked.

    Call this at the START of a login/2FA handler before touching credentials.
    key should be something like  f"{request.client.host}:login"
    """
    now = monotonic()
    until = _blocked_until.get(key)
    if until:
        if now < until:
            remaining = int(until - now)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many failed attempts. "
                    f"Try again in {remaining // 60 + 1} minute(s)."
                ),
                headers={"Retry-After": str(remaining)},
            )
        # Block expired — clear it and let them try again
        del _blocked_until[key]
        _attempts[key].clear()


def record_failure(key: str) -> None:
    """Record one failed attempt for *key*; impose a hard block when limit hit."""
    now = monotonic()
    _evict(key)
    _attempts[key].append(now)
    if len(_attempts[key]) >= _MAX_FAILURES:
        _blocked_until[key] = now + _LOCKOUT_SECS
        _attempts[key].clear()


def record_success(key: str) -> None:
    """Clear rate-limit state for *key* after a successful authentication."""
    _attempts.pop(key, None)
    _blocked_until.pop(key, None)
