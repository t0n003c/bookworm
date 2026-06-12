"""Back-compat shim — this module moved to app.api.home_subscriptions_db in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import home_subscriptions_db` /
`from routers.home_subscriptions_db import …` keep working unchanged. New code should
import from app.api.home_subscriptions_db directly."""
import sys

import app.api.home_subscriptions_db

sys.modules[__name__] = app.api.home_subscriptions_db
