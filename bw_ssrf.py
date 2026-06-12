"""Back-compat shim — this module moved to app.core.ssrf in Phase 4
(see ARCHITECTURE.md). Aliased so `from bw_ssrf import …` keeps working
unchanged. New code should import from app.core.ssrf directly."""
import sys

import app.core.ssrf

sys.modules[__name__] = app.core.ssrf
