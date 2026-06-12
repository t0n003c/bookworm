"""Back-compat shim — this module moved to app.api.demo in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import demo` /
`from routers.demo import …` keep working unchanged. New code should
import from app.api.demo directly."""
import sys

import app.api.demo

sys.modules[__name__] = app.api.demo
