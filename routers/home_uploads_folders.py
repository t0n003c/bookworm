"""Back-compat shim — this module moved to app.api.home_uploads_folders in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_uploads_folders` /
`from routers.home_uploads_folders import …` keep working unchanged. New code should
import from app.api.home_uploads_folders directly."""
import sys

import app.api.home_uploads_folders

sys.modules[__name__] = app.api.home_uploads_folders
