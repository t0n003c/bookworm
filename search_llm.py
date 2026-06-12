"""Back-compat shim — this module moved to app.services.search.search_llm in
Phase 4 (see ARCHITECTURE.md). Aliased so `from search_llm import …` keeps
working unchanged. New code should import from app.services.search.search_llm."""
import sys

import app.services.search.search_llm

sys.modules[__name__] = app.services.search.search_llm
