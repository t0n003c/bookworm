"""Back-compat shim — this module moved to app.api.seed_uploads in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import seed_uploads` /
`from routers.seed_uploads import …` keep working unchanged. New code should
import from app.api.seed_uploads directly."""
import sys

import app.api.seed_uploads

sys.modules[__name__] = app.api.seed_uploads
