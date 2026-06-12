"""app.services — business logic / use-cases.

Reusable logic that doesn't depend on the HTTP layer (no FastAPI Request/Response).
Imports app.repositories, app.models, app.core. Callable from routers, a CLI, or
a cron job without going through HTTP.
"""
