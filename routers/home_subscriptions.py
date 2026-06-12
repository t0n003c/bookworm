"""Back-compat shim — this module moved to app.api.home_subscriptions in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_subscriptions` /
`from routers.home_subscriptions import …` keep working unchanged. New code should
import from app.api.home_subscriptions directly."""
import sys

import app.api.home_subscriptions

sys.modules[__name__] = app.api.home_subscriptions
