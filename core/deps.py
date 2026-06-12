"""core.deps — shared FastAPI request dependencies / typed session accessors.

`_uid(request)` was copy-pasted into 15 routers with small, accidental
variations (different 401 `detail` strings, `int(uid)` vs `uid`, one raising
`PermissionError`). These are the canonical versions; routers alias or delegate
to them so the logic lives in exactly one place.

Note: protected routes are already gated by `AuthMiddleware` before the handler
runs, so the "missing user_id" branch here is effectively unreachable in
practice — these are in-handler typed accessors, not the primary auth gate.
"""
from fastapi import HTTPException, Request


def current_user_id(request: Request, *, detail: str | None = "Not authenticated") -> int:
    """Return the authenticated user's id from the session, or raise HTTP 401.

    `detail` is a parameter so each call site keeps its exact response body — the
    consolidation is behaviour-preserving. `HTTPException(status_code=401)` and
    `HTTPException(status_code=401, detail=None)` are identical (default detail is
    None), and `int(uid) == uid` for the integer ids stored in the session.
    """
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail=detail)
    return int(uid)


def session_user_id(request: Request) -> int:
    """Strict accessor mirroring `request.session["user_id"]` — raises KeyError if
    absent (only reachable when authenticated, so that path is unreachable)."""
    return request.session["user_id"]
