"""Back-compat shim — this module moved to app.api.workspace_databases in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import workspace_databases` /
`from routers.workspace_databases import …` keep working unchanged. New code should
import from app.api.workspace_databases directly."""
import sys

import app.api.workspace_databases

sys.modules[__name__] = app.api.workspace_databases
