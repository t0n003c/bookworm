"""Back-compat shim — this module moved to app.api.note_reminders in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import note_reminders` /
`from routers.note_reminders import …` keep working unchanged. New code should
import from app.api.note_reminders directly."""
import sys

import app.api.note_reminders

sys.modules[__name__] = app.api.note_reminders
