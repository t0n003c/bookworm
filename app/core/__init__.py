"""app.core — cross-cutting infrastructure.

Depends only on stdlib / third-party packages, never on app-internal feature
code (routers, services). Everything else may import `app.core`. Holds:
  config — typed BW_* Settings (single source of truth)
  db     — get_db() connection factory + DB_PATH (the DB session layer)
  deps   — shared FastAPI request deps / session accessors
"""
