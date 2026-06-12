"""app.api — the HTTP layer (routers + middleware).

Thin adapters: parse the request, call a service / repository, render a template
or return JSON. Imports `app.services`, `app.core`, `app.db` — never the reverse.
"""
