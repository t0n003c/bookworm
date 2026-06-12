"""Back-compat shim — this module moved to app.api.tutorials in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import tutorials` /
`from routers.tutorials import …` keep working unchanged. New code should
import from app.api.tutorials directly."""
import sys

import app.api.tutorials

sys.modules[__name__] = app.api.tutorials
