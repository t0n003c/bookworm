"""core — cross-cutting infrastructure for BookWorm.

This package holds framework-agnostic concerns that the rest of the app depends
on but which depend on nothing else in the app: configuration, (later) logging,
security primitives, and the DB session factory.

Dependency rule: `core` may import only the standard library and third-party
packages — never `routers`, `main`, or any feature module. Everything else may
import `core`. See ARCHITECTURE.md.
"""
