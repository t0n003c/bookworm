"""Back-compat shim — this module moved to app.api.workspace_db_cards in Phase 4
(see ARCHITECTURE.md). Aliased so `from routers import workspace_db_cards` /
`from routers.workspace_db_cards import …` keep working unchanged. New code should
import from app.api.workspace_db_cards directly."""
import sys

import app.api.workspace_db_cards

sys.modules[__name__] = app.api.workspace_db_cards
