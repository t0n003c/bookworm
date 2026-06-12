"""Back-compat shim — this module moved to app.db.migrations in Phase 4
(see ARCHITECTURE.md). Aliased so `from db.migrations import init_db` keeps
working unchanged. New code should import from app.db.migrations directly."""
import sys

import app.db.migrations

sys.modules[__name__] = app.db.migrations
