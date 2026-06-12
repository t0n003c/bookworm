"""Back-compat shim — this module moved to app.api.categories_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import categories_db` /
`from routers.categories_db import …` keep working unchanged. New code should
import from app.api.categories_db directly."""
import sys

import app.api.categories_db

sys.modules[__name__] = app.api.categories_db
