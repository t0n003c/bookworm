"""Database facade.

The DB layer was split for clarity (see ARCHITECTURE.md, Phase 2):
  * core.db       - the connection factory get_db() + DB_PATH (session layer)
  * db.schema     - CREATE TABLE statements + seed defaults
  * db.migrations - init_db() (additive, idempotent migrations)

This module re-exports them so the many existing `from database import ...`
call sites keep working unchanged.
"""
from core.db import DATA_DIR as _DATA_DIR, DB_PATH, get_db  # noqa: F401  (re-export)
from db.schema import (  # noqa: F401  (re-export)
    CREATE_TABLES_SQL,
    SEED_CATEGORIES,
    SEED_WORKSPACE_EMOJI,
    SEED_WORKSPACE_NAME,
)
from db.migrations import init_db  # noqa: F401  (re-export)
