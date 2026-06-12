"""Back-compat shim — this module moved to app.api.categories in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import categories` /
`from routers.categories import …` keep working unchanged. New code should
import from app.api.categories directly."""
import sys

import app.api.categories

sys.modules[__name__] = app.api.categories
