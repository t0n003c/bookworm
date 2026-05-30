"""Auth middleware — redirect unauthenticated / expired sessions to /login.

For regular browser navigations we return a plain 302.
For HTMX requests (HX-Request header present) we return an empty 200 with
the HX-Redirect header.  HTMX's native handling of HX-Redirect performs a
full-page window.location assignment BEFORE any swap machinery runs, so the
login HTML is never injected into a content div.

The old approach (302 + client-side XHR responseURL interceptor) was
unreliable: XHR follows 302s transparently, the 302 headers are gone by the
time HTMX sees the response, and window.location.replace() doesn't halt JS
execution synchronously — so HTMX could complete a swap before the navigation
took effect, producing a broken half-page login inside the app shell.
"""
from time import monotonic
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from database import get_db
from security import session_is_expired

# Paths that don't require a session
_PUBLIC = {
    "/login", "/setup", "/register", "/favicon.ico",
    "/2fa/verify",
    "/2fa/webauthn/begin",    # called during pending-2FA session (no full session yet)
    "/2fa/webauthn/complete", # same — promotes pending → full session
    "/demo/start", "/demo/end",
    "/demo/pre-end",    # pagehide beacon — user may be mid-session
    "/demo/cancel-end", # refresh cancel — session still valid
    "/demo/alive",      # heartbeat poller — must work even after user is deleted
    "/health",
    # PWA — must be public so browsers/OS can fetch them without a session
    "/manifest.json", "/sw.js", "/offline",
}

# ── TTL cache for _user_exists ────────────────────────────────────────────────
# Avoids a DB round-trip on every authenticated request.  A positive entry
# means the user existed at the time of the last check.  TTL is intentionally
# short (120 s) so that a deleted or disabled account stops being accepted
# within 2 minutes, which is a very acceptable window for a team app.
#
# Negative results (user NOT found) are never cached — we always re-query so
# that a user who is restored to the DB is recognised immediately.
_USER_CACHE: dict[int, float] = {}   # { user_id → monotonic expiry time }
_USER_CACHE_TTL = 120.0              # seconds


def _cache_evict_expired() -> None:
    """Drop expired entries — called probabilistically to bound memory use."""
    now = monotonic()
    expired = [uid for uid, exp in _USER_CACHE.items() if exp < now]
    for uid in expired:
        _USER_CACHE.pop(uid, None)


async def _user_exists(user_id: int) -> bool:
    """Return True if user_id is present in the users table.

    Positive results are cached for _USER_CACHE_TTL seconds to avoid a DB
    query on every request.  Expired entries and negative results always
    trigger a fresh DB lookup.
    """
    now = monotonic()
    expiry = _USER_CACHE.get(user_id)
    if expiry and expiry > now:
        return True   # cache hit

    async with get_db() as db:
        cur = await db.execute("SELECT 1 FROM users WHERE id = ?", (user_id,))
        found = await cur.fetchone() is not None

    if found:
        _USER_CACHE[user_id] = now + _USER_CACHE_TTL
        # Probabilistic eviction: ~1-in-50 calls to keep dict bounded.
        import random
        if random.randint(0, 49) == 0:
            _cache_evict_expired()
    else:
        # User was deleted — immediately remove stale positive entry if present.
        _USER_CACHE.pop(user_id, None)

    return found


class AuthMiddleware(BaseHTTPMiddleware):
    @staticmethod
    def _bounce(target: str, request: Request) -> Response:
        """Return HX-Redirect for HTMX requests, plain 302 otherwise.

        HX-Redirect makes HTMX do a full-page window.location assignment
        BEFORE any swap runs, so login HTML never lands inside a content div.
        """
        if request.headers.get("HX-Request"):
            return Response(status_code=200, headers={"HX-Redirect": target})
        return RedirectResponse(target, status_code=302)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Always allow static assets, WOPI server-to-server callbacks (token-auth,
        # no session cookie), and public auth pages.
        # NOTE: /wopi/ is prefix-checked here (like /static/), NOT added to _PUBLIC.
        # _PUBLIC is for exact named paths only.
        if (path.startswith("/static/")
                or path.startswith("/wopi/")
                or path.startswith("/share/view/")   # public share links — token auth, no session
                or path in _PUBLIC):
            return await call_next(request)

        uid     = request.session.get("user_id")
        is_demo = request.session.get("is_demo", False)

        # ── Phase 1: no session or session already expired ─────────────────
        if not uid or session_is_expired(request.session):
            request.session.clear()
            return self._bounce("/login", request)

        # ── Phase 2: session looks valid — confirm user still exists in DB ─
        if not await _user_exists(uid):
            request.session.clear()
            if is_demo and request.headers.get("HX-Request"):
                # Demo user deleted mid-session, HTMX request in flight.
                # X-BW-Demo-Ended:1 lets the JS interceptor show the branded
                # modal instead of a cold redirect.  HX-Reswap:none stops
                # HTMX from trying to swap the empty body into any target.
                return Response(
                    status_code=200,
                    headers={"X-BW-Demo-Ended": "1", "HX-Reswap": "none"},
                )
            # Regular user deleted, or non-HTMX navigation → plain redirect.
            target = "/login?admin_ended=1" if is_demo else "/login"
            return self._bounce(target, request)

        return await call_next(request)