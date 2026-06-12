"""Back-compat shim — this module moved to app.api.home in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home` /
`from routers.home import …` keep working unchanged. New code should
import from app.api.home directly."""
import sys

import app.api.home

sys.modules[__name__] = app.api.home
