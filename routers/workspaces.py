"""Back-compat shim — this module moved to app.api.workspaces in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import workspaces` /
`from routers.workspaces import …` keep working unchanged. New code should
import from app.api.workspaces directly."""
import sys

import app.api.workspaces

sys.modules[__name__] = app.api.workspaces
