"""Back-compat shim — this module moved to app.api.workspaces_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import workspaces_db` /
`from routers.workspaces_db import …` keep working unchanged. New code should
import from app.api.workspaces_db directly."""
import sys

import app.api.workspaces_db

sys.modules[__name__] = app.api.workspaces_db
