"""Back-compat shim — this module moved to app.core.db in Phase 4
(see ARCHITECTURE.md). Aliased so `from core.db import get_db, DB_PATH, DATA_DIR`
keeps working unchanged. New code should import from app.core.db directly."""
import sys

import app.core.db

sys.modules[__name__] = app.core.db
