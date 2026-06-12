"""Back-compat shim — this module moved to app.api.sharing_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import sharing_db` /
`from routers.sharing_db import …` keep working unchanged. New code should
import from app.api.sharing_db directly."""
import sys

import app.api.sharing_db

sys.modules[__name__] = app.api.sharing_db
