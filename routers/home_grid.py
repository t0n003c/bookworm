"""Back-compat shim — this module moved to app.api.home_grid in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_grid` /
`from routers.home_grid import …` keep working unchanged. New code should
import from app.api.home_grid directly."""
import sys

import app.api.home_grid

sys.modules[__name__] = app.api.home_grid
