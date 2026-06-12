"""Back-compat shim — this module moved to app.api.sharing in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import sharing` /
`from routers.sharing import …` keep working unchanged. New code should
import from app.api.sharing directly."""
import sys

import app.api.sharing

sys.modules[__name__] = app.api.sharing
