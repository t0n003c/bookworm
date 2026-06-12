"""Back-compat shim — this module moved to app.api.search_qa in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import search_qa` /
`from routers.search_qa import …` keep working unchanged. New code should
import from app.api.search_qa directly."""
import sys

import app.api.search_qa

sys.modules[__name__] = app.api.search_qa
