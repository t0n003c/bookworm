"""Back-compat shim — this module moved to app.api.push_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import push_db` /
`from routers.push_db import …` keep working unchanged. New code should
import from app.api.push_db directly."""
import sys

import app.api.push_db

sys.modules[__name__] = app.api.push_db
