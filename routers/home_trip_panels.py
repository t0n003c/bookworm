"""Back-compat shim — this module moved to app.api.home_trip_panels in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_trip_panels` /
`from routers.home_trip_panels import …` keep working unchanged. New code should
import from app.api.home_trip_panels directly."""
import sys

import app.api.home_trip_panels

sys.modules[__name__] = app.api.home_trip_panels
