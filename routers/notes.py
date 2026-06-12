"""Back-compat shim — this module moved to app.api.notes in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import notes` /
`from routers.notes import …` keep working unchanged. New code should
import from app.api.notes directly."""
import sys

import app.api.notes

sys.modules[__name__] = app.api.notes
