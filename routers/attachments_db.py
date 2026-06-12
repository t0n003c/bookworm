"""Back-compat shim — this module moved to app.api.attachments_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import attachments_db` /
`from routers.attachments_db import …` keep working unchanged. New code should
import from app.api.attachments_db directly."""
import sys

import app.api.attachments_db

sys.modules[__name__] = app.api.attachments_db
