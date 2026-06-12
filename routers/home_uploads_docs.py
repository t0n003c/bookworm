"""Back-compat shim — this module moved to app.api.home_uploads_docs in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_uploads_docs` /
`from routers.home_uploads_docs import …` keep working unchanged. New code should
import from app.api.home_uploads_docs directly."""
import sys

import app.api.home_uploads_docs

sys.modules[__name__] = app.api.home_uploads_docs
