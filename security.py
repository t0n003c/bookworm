"""Back-compat shim — this module moved to app.core.security in Phase 4
(see ARCHITECTURE.md). Aliased so `from security import …` keeps working
unchanged. New code should import from app.core.security directly."""
import sys

import app.core.security

sys.modules[__name__] = app.core.security
