"""Back-compat shim — this module moved to app.api.totp in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import totp` /
`from routers.totp import …` keep working unchanged. New code should
import from app.api.totp directly."""
import sys

import app.api.totp

sys.modules[__name__] = app.api.totp
