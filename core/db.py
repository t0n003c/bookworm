"""core.db — the async SQLite connection factory.

The single accessor for the database: every async DB access in the app goes
through `get_db()`, which applies the connection PRAGMAs (foreign keys, WAL,
etc.) on each connection. Paths derive from `core.config` (BW_DATA_DIR).

This is the `core` DB-session layer (see ARCHITECTURE.md). It depends only on
aiosqlite + `core.config` — never on routers or feature modules. Schema and
migrations live separately (`database.init_db()` today; `db/migrations.py` in a
later phase). `database.py` re-exports `get_db`/`DB_PATH` so existing
`from database import get_db` imports keep working unchanged.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import aiosqlite

from core.config import settings

# Data directory + DB file path (BW_DATA_DIR). mkdir on import so a first boot in
# a fresh volume just works.
DATA_DIR = settings.data_dir
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "bookworm.db"


@asynccontextmanager
async def get_db():
    """Async context manager yielding a live DB connection.

    PRAGMAs applied on every connection
    ------------------------------------
    foreign_keys   enforce referential integrity.
    journal_mode   WAL — concurrent readers + one writer; safe for multiple
                   async tasks and a small uvicorn worker pool.
    synchronous    NORMAL (1) — safe with WAL; skips the extra fsync that
                   FULL mode does and that is only needed for non-WAL journals.
                   Data is still durable across OS crashes; only a hard power
                   cut mid-write could lose the last committed transaction, which
                   is acceptable for a team notes app.  (SQLite docs § 8.1)
    busy_timeout   Wait up to 5 s before raising “database is locked” under
                   write contention instead of failing immediately.
    cache_size     -16384 → 16 MB page-cache per connection.  SQLite default is
                   -2000 (2 MB).  More RAM kept warm = fewer disk reads for
                   repeated queries (note lists, category joins, etc.).
    mmap_size      128 MB memory-mapped I/O region.  Sequential reads bypass the
                   kernel pread() syscall entirely, which matters most for large
                   blobs and full-table scans.  Has no effect on WAL writes.
    temp_store     MEMORY — keep temp tables / sort buffers in RAM rather than
                   writing them to disk.  Only affects intermediate query work;
                   no data-loss risk.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys  = ON")
        await db.execute("PRAGMA journal_mode  = WAL")
        await db.execute("PRAGMA synchronous   = NORMAL")
        await db.execute("PRAGMA busy_timeout  = 5000")
        await db.execute("PRAGMA cache_size    = -16384")  # 16 MB
        await db.execute("PRAGMA mmap_size     = 134217728")  # 128 MB
        await db.execute("PRAGMA temp_store    = MEMORY")
        yield db
