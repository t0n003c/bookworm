"""Back-compat shim — this module moved to app.services.search.search_index in
Phase 4 (see ARCHITECTURE.md). Aliased so `from search_index import …` keeps
working unchanged. New code should import from app.services.search.search_index."""
import sys

import app.services.search.search_index

sys.modules[__name__] = app.services.search.search_index
