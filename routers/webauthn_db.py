"""Back-compat shim — this module moved to app.api.webauthn_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import webauthn_db` /
`from routers.webauthn_db import …` keep working unchanged. New code should
import from app.api.webauthn_db directly."""
import sys

import app.api.webauthn_db

sys.modules[__name__] = app.api.webauthn_db
