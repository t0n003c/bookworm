"""Back-compat shim — this module moved to app.api.webauthn in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import webauthn` /
`from routers.webauthn import …` keep working unchanged. New code should
import from app.api.webauthn directly."""
import sys

import app.api.webauthn

sys.modules[__name__] = app.api.webauthn
