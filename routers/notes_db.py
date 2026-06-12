"""Back-compat shim — this module moved to app.api.notes_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import notes_db` /
`from routers.notes_db import …` keep working unchanged. New code should
import from app.api.notes_db directly."""
import sys

import app.api.notes_db

sys.modules[__name__] = app.api.notes_db
