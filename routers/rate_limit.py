"""Back-compat shim — this module moved to app.api.rate_limit in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import rate_limit` /
`from routers.rate_limit import …` keep working unchanged. New code should
import from app.api.rate_limit directly."""
import sys

import app.api.rate_limit

sys.modules[__name__] = app.api.rate_limit
