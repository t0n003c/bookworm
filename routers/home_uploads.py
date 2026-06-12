"""Back-compat shim — this module moved to app.api.home_uploads in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_uploads` /
`from routers.home_uploads import …` keep working unchanged. New code should
import from app.api.home_uploads directly."""
import sys

import app.api.home_uploads

sys.modules[__name__] = app.api.home_uploads
