"""Auth middleware — redirect unauthenticated requests to /login."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse

# Paths that don't require a session
_PUBLIC = {"/login", "/setup", "/favicon.ico"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Always allow static assets and public auth pages
        if path.startswith("/static/") or path in _PUBLIC:
            return await call_next(request)
        # Require a valid session
        if not request.session.get("user_id"):
            return RedirectResponse("/login", status_code=302)
        return await call_next(request)