"""Back-compat shim — this module moved to app.api.push in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import push` /
`from routers.push import …` keep working unchanged. New code should
import from app.api.push directly."""
import sys

import app.api.push

sys.modules[__name__] = app.api.push
