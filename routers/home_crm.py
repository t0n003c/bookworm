"""Back-compat shim — this module moved to app.api.home_crm in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_crm` /
`from routers.home_crm import …` keep working unchanged. New code should
import from app.api.home_crm directly."""
import sys

import app.api.home_crm

sys.modules[__name__] = app.api.home_crm
