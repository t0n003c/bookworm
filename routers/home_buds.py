"""Back-compat shim — this module moved to app.api.home_buds in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_buds` /
`from routers.home_buds import …` keep working unchanged. New code should
import from app.api.home_buds directly."""
import sys

import app.api.home_buds

sys.modules[__name__] = app.api.home_buds
