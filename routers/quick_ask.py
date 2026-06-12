"""Back-compat shim — this module moved to app.api.quick_ask in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import quick_ask` /
`from routers.quick_ask import …` keep working unchanged. New code should
import from app.api.quick_ask directly."""
import sys

import app.api.quick_ask

sys.modules[__name__] = app.api.quick_ask
