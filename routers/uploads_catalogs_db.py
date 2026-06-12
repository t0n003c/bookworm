"""Back-compat shim — this module moved to app.api.uploads_catalogs_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import uploads_catalogs_db` /
`from routers.uploads_catalogs_db import …` keep working unchanged. New code should
import from app.api.uploads_catalogs_db directly."""
import sys

import app.api.uploads_catalogs_db

sys.modules[__name__] = app.api.uploads_catalogs_db
