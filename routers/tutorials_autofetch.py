"""Back-compat shim — this module moved to app.api.tutorials_autofetch in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import tutorials_autofetch` /
`from routers.tutorials_autofetch import …` keep working unchanged. New code should
import from app.api.tutorials_autofetch directly."""
import sys

import app.api.tutorials_autofetch

sys.modules[__name__] = app.api.tutorials_autofetch
