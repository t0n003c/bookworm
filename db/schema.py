"""Back-compat shim — this module moved to app.db.schema in Phase 4
(see ARCHITECTURE.md). Aliased so `from db.schema import CREATE_TABLES_SQL,
SEED_*` keeps working unchanged. New code should import from app.db.schema
directly."""
import sys

import app.db.schema

sys.modules[__name__] = app.db.schema
