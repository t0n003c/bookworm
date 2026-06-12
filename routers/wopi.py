"""Back-compat shim — this module moved to app.api.wopi in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import wopi` /
`from routers.wopi import …` keep working unchanged. New code should
import from app.api.wopi directly."""
import sys

import app.api.wopi

sys.modules[__name__] = app.api.wopi
