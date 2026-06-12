"""Back-compat shim — this module moved to app.core.config in Phase 4
(see ARCHITECTURE.md). Aliased so `from core.config import …` keeps working
unchanged (every name + identity preserved). New code should import from
app.core.config directly."""
import sys

import app.core.config

sys.modules[__name__] = app.core.config
