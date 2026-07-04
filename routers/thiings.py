"""Back-compat shim for app.api.thiings."""
import sys

import app.api.thiings

sys.modules[__name__] = app.api.thiings
