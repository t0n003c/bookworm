"""Back-compat shim — this module moved to app.api.auth in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import auth` /
`from routers.auth import …` keep working unchanged. New code should
import from app.api.auth directly."""
import sys

import app.api.auth

sys.modules[__name__] = app.api.auth
