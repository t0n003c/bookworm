"""app — the BookWorm application package (Clean/layered architecture).

The `app/` package gives the layers a real import boundary (see ARCHITECTURE.md):
  app.core  — cross-cutting infra (config, db session, deps); imports nothing app-internal
  app.db    — schema + migrations

Migration is incremental (strangler-fig): infra now lives here, while the old
top-level `core/`, `db/`, `database.py` paths remain as thin re-export shims so
the rest of the app keeps importing exactly as before. Routers, main.py and the
Docker entrypoint move in later sub-phases.
"""
