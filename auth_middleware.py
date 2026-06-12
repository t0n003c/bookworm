"""Back-compat shim — this module moved to app.api.middleware.auth in Phase 4
(see ARCHITECTURE.md). Aliased so `from auth_middleware import AuthMiddleware`
keeps working unchanged. New code should import from app.api.middleware.auth."""
import sys

import app.api.middleware.auth

sys.modules[__name__] = app.api.middleware.auth
