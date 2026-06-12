"""Back-compat shim — this module moved to app.api.attachments in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import attachments` /
`from routers.attachments import …` keep working unchanged. New code should
import from app.api.attachments directly."""
import sys

import app.api.attachments

sys.modules[__name__] = app.api.attachments
