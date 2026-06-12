"""Back-compat shim — this module moved to app.api.home_rss in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_rss` /
`from routers.home_rss import …` keep working unchanged. New code should
import from app.api.home_rss directly."""
import sys

import app.api.home_rss

sys.modules[__name__] = app.api.home_rss
