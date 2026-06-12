"""Back-compat shim — this module moved to app.api.auth_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import auth_db` /
`from routers.auth_db import …` keep working unchanged. New code should
import from app.api.auth_db directly."""
import sys

import app.api.auth_db

sys.modules[__name__] = app.api.auth_db
