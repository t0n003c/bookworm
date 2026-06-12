"""Back-compat shim — this module moved to app.api.home_ai in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_ai` /
`from routers.home_ai import …` keep working unchanged. New code should
import from app.api.home_ai directly."""
import sys

import app.api.home_ai

sys.modules[__name__] = app.api.home_ai
