"""Back-compat shim — this module moved to app.api.home_uploads_annot in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_uploads_annot` /
`from routers.home_uploads_annot import …` keep working unchanged. New code should
import from app.api.home_uploads_annot directly."""
import sys

import app.api.home_uploads_annot

sys.modules[__name__] = app.api.home_uploads_annot
