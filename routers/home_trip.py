"""Back-compat shim — this module moved to app.api.home_trip in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_trip` /
`from routers.home_trip import …` keep working unchanged. New code should
import from app.api.home_trip directly."""
import sys

import app.api.home_trip

sys.modules[__name__] = app.api.home_trip
