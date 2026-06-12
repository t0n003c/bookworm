"""Back-compat shim — this module moved to app.api.totp_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import totp_db` /
`from routers.totp_db import …` keep working unchanged. New code should
import from app.api.totp_db directly."""
import sys

import app.api.totp_db

sys.modules[__name__] = app.api.totp_db
