"""Back-compat shim — this module moved to app.api.account in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import account` /
`from routers.account import …` keep working unchanged. New code should
import from app.api.account directly."""
import sys

import app.api.account

sys.modules[__name__] = app.api.account
