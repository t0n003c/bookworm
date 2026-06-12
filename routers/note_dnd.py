"""Back-compat shim — this module moved to app.api.note_dnd in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import note_dnd` /
`from routers.note_dnd import …` keep working unchanged. New code should
import from app.api.note_dnd directly."""
import sys

import app.api.note_dnd

sys.modules[__name__] = app.api.note_dnd
