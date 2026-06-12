"""Back-compat shim — this module moved to app.models in Phase 4
(see ARCHITECTURE.md). Aliased so `from models import …` keeps working
unchanged. New code should import from app.models directly."""
import sys

import app.models

sys.modules[__name__] = app.models
