"""Back-compat shim — this module moved to app.core.deps in Phase 4
(see ARCHITECTURE.md). Aliased so `from core.deps import current_user_id,
session_user_id` keeps working unchanged. New code should import from
app.core.deps directly."""
import sys

import app.core.deps

sys.modules[__name__] = app.core.deps
