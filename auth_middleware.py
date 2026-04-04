"""Auth middleware — redirect unauthenticated / expired sessions to /login."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse

from security import session_is_expired

# Paths that don't require a session
_PUBLIC = {"/login", "/setup", "/register", "/favicon.ico", "/2fa/verify"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Always allow static assets and public auth pages
        if path.startswith("/static/") or path in _PUBLIC:
            return await call_next(request)
        # Require a valid, non-expired session
        if not request.session.get("user_id") or session_is_expired(request.session):
            request.session.clear()
            return RedirectResponse("/login", status_code=302)
        return await call_next(request)