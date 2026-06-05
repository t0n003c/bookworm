"""Database initialization and connection management."""
import aiosqlite
import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

# BW_DATA_DIR lets Docker (or any deployment) redirect the database
# to a persistent volume.  Defaults to "." so local dev is unchanged.
_DATA_DIR = Path(os.getenv("BW_DATA_DIR", "."))
_DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = _DATA_DIR / "bookworm.db"


CREATE_TABLES_SQL = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        emoji      TEXT NOT NULL DEFAULT '📁',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#0053e2',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS attr_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        field_type TEXT NOT NULL DEFAULT 'text',
        options TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        content TEXT,
        meeting_date DATE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS note_categories (
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, category_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS note_attributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        attr_def_id INTEGER REFERENCES attr_definitions(id) ON DELETE SET NULL,
        key TEXT NOT NULL,
        value TEXT
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS notes_updated_at
    AFTER UPDATE ON notes
    BEGIN
        UPDATE notes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
    """,
    """
    CREATE TABLE IF NOT EXISTS note_attachments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
        size          INTEGER NOT NULL DEFAULT 0,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS home_pages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL DEFAULT 'My Page',
        emoji       TEXT    NOT NULL DEFAULT '🏠',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        config_json TEXT    NOT NULL DEFAULT '{}',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS home_widgets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id     INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
        widget_type TEXT    NOT NULL,
        style       TEXT    NOT NULL DEFAULT 'default',
        config_json TEXT    NOT NULL DEFAULT '{}',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id  TEXT    NOT NULL UNIQUE,
        public_key     TEXT    NOT NULL,
        sign_count     INTEGER NOT NULL DEFAULT 0,
        device_name    TEXT    NOT NULL DEFAULT 'My Device',
        biometric_type TEXT    NOT NULL DEFAULT 'auto',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at   DATETIME
    )
    """,
]

SEED_WORKSPACE_NAME = "Grocery Team"
SEED_WORKSPACE_EMOJI = "🛒"

SEED_CATEGORIES = [
    ("Team Meeting", "#0053e2", "General team meeting notes"),
    ("Action Items", "#ea1100", "Tasks and follow-ups"),
    ("Decision", "#2a8703", "Key decisions made"),
    ("Retrospective", "#995213", "Retro and improvement notes"),
    ("Planning", "#ffc220", "Sprint or project planning"),
]


async def init_db() -> None:
    """Initialize database schema, run migrations, and seed defaults."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        for sql in CREATE_TABLES_SQL:
            await db.execute(sql)

        # ── Index: notes(workspace_id, meeting_date DESC) ─────────────────────
        # Speeds up search_notes() WHERE workspace_id IN (...) ORDER BY date.
        # CREATE INDEX IF NOT EXISTS is idempotent — safe to run every boot.
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_ws_date "
            "ON notes(workspace_id, meeting_date DESC)"
        )

        # ── Index: workspaces(user_id) ───────────────────────────────────────
        # Speeds up sidebar workspace listing (SELECT ... WHERE user_id=? ORDER BY
        # sort_order) which runs on every page load for every authenticated user.
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_ws_user "
            "ON workspaces(user_id, sort_order)"
        )

        # ── Index: webauthn_credentials(user_id) ─────────────────────────────
        # Speeds up passkey authentication (SELECT ... WHERE user_id=?) which
        # runs on every WebAuthn login attempt.
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_webauthn_user "
            "ON webauthn_credentials(user_id)"
        )

        # ── Migration: drop stale global UNIQUE on workspaces.name ───────────
        # Original single-user schema had `name TEXT NOT NULL UNIQUE`.
        # Multi-user requires only per-user uniqueness; the global constraint
        # breaks demo mode and any two users who share a workspace name.
        # SQLite cannot DROP constraints, so we rebuild the table.
        ws_ddl_cur = await db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='workspaces'"
        )
        ws_ddl_row = await ws_ddl_cur.fetchone()
        ws_ddl = ws_ddl_row[0] if ws_ddl_row else ""
        if "name TEXT NOT NULL UNIQUE" in ws_ddl:
            await db.execute("PRAGMA foreign_keys = OFF")
            await db.execute("""
                CREATE TABLE workspaces_new (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    name        TEXT NOT NULL,
                    emoji       TEXT NOT NULL DEFAULT '📁',
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_open     INTEGER NOT NULL DEFAULT 1,
                    parent_id   INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    deleted_at  DATETIME DEFAULT NULL,
                    sort_order  INTEGER NOT NULL DEFAULT 0
                )
            """)
            await db.execute("""
                INSERT INTO workspaces_new
                    (id, user_id, name, emoji, created_at,
                     is_open, parent_id, is_favorite, deleted_at, sort_order)
                SELECT
                    id, user_id, name, emoji, created_at,
                    COALESCE(is_open, 1),
                    parent_id,
                    COALESCE(is_favorite, 0),
                    deleted_at,
                    COALESCE(sort_order, id * 10)
                FROM workspaces
            """)
            await db.execute("DROP TABLE workspaces")
            await db.execute("ALTER TABLE workspaces_new RENAME TO workspaces")
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_ws_sort "
                "ON workspaces(parent_id, sort_order)"
            )
            await db.execute("PRAGMA foreign_keys = ON")

        # Seed default workspace — fresh-install only.
        # Only insert if the workspaces table is completely empty.  Any prior
        # row (active, trashed, or migrated) means we already seeded; picking
        # that row is fine because default_ws_id is only used below to backfill
        # notes whose workspace_id is NULL, a one-time migration step.
        ws_count_cur = await db.execute("SELECT COUNT(*) FROM workspaces")
        ws_count = (await ws_count_cur.fetchone())[0]
        if ws_count == 0:
            cur = await db.execute(
                "INSERT INTO workspaces (name, emoji) VALUES (?, ?)",
                (SEED_WORKSPACE_NAME, SEED_WORKSPACE_EMOJI),
            )
            default_ws_id = cur.lastrowid
        else:
            ws_any = await db.execute("SELECT id FROM workspaces LIMIT 1")
            default_ws_id = (await ws_any.fetchone())[0]

        # ── workspaces migrations (single PRAGMA read) ────────────────────────
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}

        if "is_open" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1"
            )
            await db.execute("UPDATE workspaces SET is_open = 1")

        if "parent_id" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN "
                "parent_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"
            )

        if "is_favorite" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"
            )

        if "deleted_at" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN deleted_at DATETIME DEFAULT NULL"
            )

        if "user_id" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN "
                "user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
            )
            # One-time backfill: rows that existed before this column was added
            # have no owner — assign them to the first (super-admin) user.
            # This block only runs on the single boot where the column is new;
            # on every subsequent boot user_id is already in ws_cols so we
            # never touch NULL rows again (prevents orphaned demo data from
            # being re-assigned to the superadmin after a purge).
            await db.execute(
                "UPDATE workspaces SET user_id = "
                "(SELECT id FROM users ORDER BY id ASC LIMIT 1) "
                "WHERE user_id IS NULL"
            )

        if "sort_order" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
            )
            await db.execute("UPDATE workspaces SET sort_order = id * 10")
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_ws_sort "
                "ON workspaces(parent_id, sort_order)"
            )

        # ── workspaces.ws_type — database node support (reuses ws_cols from above)
        if "ws_type" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN ws_type TEXT NOT NULL DEFAULT 'workspace'"
            )

        # ── users migrations (single PRAGMA read) ─────────────────────────────
        cursor = await db.execute("PRAGMA table_info(users)")
        u_cols = {r[1] for r in await cursor.fetchall()}

        if "role" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"
            )
        # Backfill: the very first user (lowest id) is the super-admin
        await db.execute(
            "UPDATE users SET role = 'superadmin' "
            "WHERE id = (SELECT MIN(id) FROM users) AND role != 'superadmin'"
        )

        if "totp_secret" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL"
            )
        if "totp_enabled" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0"
            )

        # ── Phase 4B: per-user LLM settings ─────────────────────────────────
        # User key takes precedence over site-wide key in get_effective_llm_settings().
        if "llm_endpoint" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN llm_endpoint TEXT NOT NULL DEFAULT ''"
            )
        if "llm_api_key" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN llm_api_key TEXT NOT NULL DEFAULT ''"
            )
        if "llm_model" not in u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN llm_model TEXT NOT NULL DEFAULT ''"
            )

        # ── notes migrations (single PRAGMA read) ─────────────────────────────
        cursor = await db.execute("PRAGMA table_info(notes)")
        n_cols = {r[1] for r in await cursor.fetchall()}

        if "icon" not in n_cols:
            await db.execute("ALTER TABLE notes ADD COLUMN icon TEXT DEFAULT NULL")

        if "workspace_id" not in n_cols:
            await db.execute(
                "ALTER TABLE notes ADD COLUMN "
                "workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"
            )

        # Backfill: assign any orphaned notes to the default workspace
        await db.execute(
            "UPDATE notes SET workspace_id = ? WHERE workspace_id IS NULL", (default_ws_id,)
        )

        # ── FTS5 full-text search index (Phase 1) ─────────────────────────
        # External content table — no duplication; snippet() reads from notes.
        # First-creation gate: 'rebuild' populates from existing rows once only.
        _fts_check = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
        )
        _fts_existed = (await _fts_check.fetchone()) is not None

        await db.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                title,
                content,
                content='notes',
                content_rowid='id'
            )
        """)
        if not _fts_existed:
            # Populate from all existing notes — runs once on first migration
            await db.execute("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')")

        # Sync triggers — idempotent (IF NOT EXISTS)
        # UPDATE trigger: AFTER UPDATE OF title, content only — prevents
        # double-fire with the existing notes_updated_at trigger (which only
        # touches updated_at and would otherwise cause two FTS re-indexes).
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_fts_ai
            AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_fts_au
            AFTER UPDATE OF title, content ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, content)
                VALUES('delete', old.id, old.title, old.content);
                INSERT INTO notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS notes_fts_ad
            AFTER DELETE ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, content)
                VALUES('delete', old.id, old.title, old.content);
            END
        """)
        await db.commit()
        # ── /FTS5 ─────────────────────────────────────────────────────────

        # ── Phase 4A: search_items shadow table + FTS5 ────────────────────
        # Unified denormalised table covering db_cards, workspaces, and
        # home_widgets.  Notes stay in notes_fts (real-time triggers).
        # db_cards + workspaces get their own triggers below.
        # Widgets have no SQL-level triggers (config_json needs Python to
        # parse) — they are refreshed by the hourly APScheduler job.
        _si_check = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='search_items'"
        )
        _si_existed = (await _si_check.fetchone()) is not None

        await db.execute("""
            CREATE TABLE IF NOT EXISTS search_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                item_type  TEXT    NOT NULL,
                item_id    INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                title      TEXT    NOT NULL DEFAULT '',
                body       TEXT    NOT NULL DEFAULT '',
                link_data  TEXT    NOT NULL DEFAULT '{}',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(item_type, item_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_search_items_user "
            "ON search_items(user_id)"
        )

        await db.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS search_items_fts
            USING fts5(title, body, content='search_items', content_rowid='id')
        """)

        # db_cards triggers
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS search_items_dbc_ai
            AFTER INSERT ON db_cards BEGIN
                INSERT OR REPLACE INTO search_items
                    (item_type, item_id, user_id, title, body, link_data)
                VALUES (
                    'db_card', new.id, new.user_id,
                    COALESCE(new.title, ''), COALESCE(new.note_content, ''),
                    json_object('ws_id', new.db_id)
                );
                INSERT INTO search_items_fts(rowid, title, body)
                SELECT id, title, body FROM search_items
                WHERE  item_type = 'db_card' AND item_id = new.id;
            END
        """)
        # ── Recreate (not IF NOT EXISTS) so rowid-fix always applies ───────
        await db.execute("DROP TRIGGER IF EXISTS search_items_dbc_au")
        await db.execute("""
            CREATE TRIGGER search_items_dbc_au
            AFTER UPDATE OF title, note_content ON db_cards BEGIN
                -- FTS delete FIRST (while shadow table still holds old content)
                INSERT INTO search_items_fts(search_items_fts, rowid, title, body)
                SELECT 'delete', si.id, si.title, si.body
                FROM   search_items si
                WHERE  si.item_type = 'db_card' AND si.item_id = old.id;
                -- Update shadow table
                UPDATE search_items
                SET    title      = COALESCE(new.title, ''),
                       body       = COALESCE(new.note_content, ''),
                       updated_at = datetime('now')
                WHERE  item_type = 'db_card' AND item_id = old.id;
                -- Re-insert FTS with new content
                INSERT INTO search_items_fts(rowid, title, body)
                SELECT id, title, body FROM search_items
                WHERE  item_type = 'db_card' AND item_id = new.id;
            END
        """)
        await db.execute("DROP TRIGGER IF EXISTS search_items_dbc_ad")
        await db.execute("""
            CREATE TRIGGER search_items_dbc_ad
            AFTER DELETE ON db_cards BEGIN
                -- FTS delete FIRST (rowid from search_items, content still valid)
                INSERT INTO search_items_fts(search_items_fts, rowid, title, body)
                SELECT 'delete', si.id, si.title, si.body
                FROM   search_items si
                WHERE  si.item_type = 'db_card' AND si.item_id = old.id;
                DELETE FROM search_items
                WHERE  item_type = 'db_card' AND item_id = old.id;
            END
        """)

        # workspace triggers
        await db.execute("DROP TRIGGER IF EXISTS search_items_ws_ai")
        await db.execute("""
            CREATE TRIGGER search_items_ws_ai
            AFTER INSERT ON workspaces BEGIN
                INSERT OR IGNORE INTO search_items
                    (item_type, item_id, user_id, title, body, link_data)
                VALUES (
                    'workspace', new.id, new.user_id,
                    COALESCE(new.emoji, '') || ' ' || COALESCE(new.name, ''), '',
                    json_object('ws_id', new.id)
                );
                -- Sync FTS immediately after shadow-table insert
                INSERT OR IGNORE INTO search_items_fts(rowid, title, body)
                SELECT id, title, body FROM search_items
                WHERE  item_type = 'workspace' AND item_id = new.id;
            END
        """)
        await db.execute("DROP TRIGGER IF EXISTS search_items_ws_au")
        await db.execute("""
            CREATE TRIGGER search_items_ws_au
            AFTER UPDATE OF name, emoji ON workspaces BEGIN
                -- FTS delete FIRST (shadow table still holds old title)
                INSERT INTO search_items_fts(search_items_fts, rowid, title, body)
                SELECT 'delete', si.id, si.title, si.body
                FROM   search_items si
                WHERE  si.item_type = 'workspace' AND si.item_id = old.id;
                -- Update shadow table
                UPDATE search_items
                SET    title      = COALESCE(new.emoji, '') || ' ' || COALESCE(new.name, ''),
                       updated_at = datetime('now')
                WHERE  item_type = 'workspace' AND item_id = old.id;
                -- Re-insert FTS with new title
                INSERT INTO search_items_fts(rowid, title, body)
                SELECT id, title, body FROM search_items
                WHERE  item_type = 'workspace' AND item_id = new.id;
            END
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS search_items_ws_soft_del
            AFTER UPDATE OF deleted_at ON workspaces
            WHEN new.deleted_at IS NOT NULL BEGIN
                DELETE FROM search_items
                WHERE  item_type = 'workspace' AND item_id = old.id;
            END
        """)

        # First-boot population — only runs once when the table is brand-new.
        # Widgets are populated by the hourly APScheduler job instead.
        if not _si_existed:
            await db.execute("""
                INSERT OR IGNORE INTO search_items
                    (item_type, item_id, user_id, title, body, link_data)
                SELECT
                    'db_card', id, user_id,
                    COALESCE(title, ''), COALESCE(note_content, ''),
                    json_object('ws_id', db_id)
                FROM db_cards
            """)
            await db.execute("""
                INSERT OR IGNORE INTO search_items
                    (item_type, item_id, user_id, title, body, link_data)
                SELECT
                    'workspace', id, user_id,
                    COALESCE(emoji, '') || ' ' || COALESCE(name, ''), '',
                    json_object('ws_id', id)
                FROM workspaces WHERE deleted_at IS NULL
            """)
            # Populate FTS from existing rows
            await db.execute(
                "INSERT INTO search_items_fts(search_items_fts) VALUES('rebuild')"
            )
        # ── /Phase 4A ──────────────────────────────────────────────────────


        for name, color, desc in SEED_CATEGORIES:
            await db.execute(
                "INSERT OR IGNORE INTO categories (name, color, description) VALUES (?, ?, ?)",
                (name, color, desc),
            )

        # Migration: create workspace_categories join table if missing
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS workspace_categories (
                workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                PRIMARY KEY (workspace_id, category_id)
            )
            """
        )

        # Backfill: ensure every existing workspace is linked to every existing category
        # (so no data is lost on first migration — workspaces added later inherit from parent)
        await db.execute(
            """
            INSERT OR IGNORE INTO workspace_categories (workspace_id, category_id)
            SELECT w.id, c.id FROM workspaces w CROSS JOIN categories c
            """
        )

        # Migration: add config_json to home_pages (stores col_count etc.)
        cursor = await db.execute("PRAGMA table_info(home_pages)")
        hp_cols = {r[1] for r in await cursor.fetchall()}
        if "config_json" not in hp_cols:
            await db.execute(
                "ALTER TABLE home_pages ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'"
            )
        if "page_type" not in hp_cols:
            await db.execute(
                "ALTER TABLE home_pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'dashboard'"
            )
        if "deleted_at" not in hp_cols:
            await db.execute(
                "ALTER TABLE home_pages ADD COLUMN deleted_at DATETIME DEFAULT NULL"
            )

        # ── RSS Reader tables ──────────────────────────────────────────────────
        # Feeds subscribed to a specific RSS Reader page
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rss_page_feeds (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                url        TEXT    NOT NULL,
                label      TEXT    NOT NULL DEFAULT '',
                color      TEXT    NOT NULL DEFAULT '#0053e2',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL DEFAULT (datetime('now')),
                UNIQUE(page_id, url)
            )
        """)
        # Persistent per-user read state (guid = item identifier from feed)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rss_read_items (
                user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                page_id  INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                item_guid TEXT NOT NULL,
                read_at  TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, page_id, item_guid)
            )
        """)

        # ── rss_page_feeds: add category column (migration) ──────────────────
        try:
            await db.execute(
                "ALTER TABLE rss_page_feeds ADD COLUMN category TEXT NOT NULL DEFAULT ''"
            )
        except Exception:
            pass  # column already exists — idempotent

        # ── rss_read_items: add feed_id for per-feed read-cap (migration) ──────
        # feed_id tracks which rss_page_feeds row an item belongs to so we can
        # enforce a max-10-per-feed retention policy without touching old rows.
        # NULL feed_id = legacy row (pre-migration); purge_old_rss_read_items()
        # deletes those on startup since we cannot group them per-feed anyway.
        try:
            await db.execute(
                "ALTER TABLE rss_read_items ADD COLUMN feed_id INTEGER "
                "REFERENCES rss_page_feeds(id) ON DELETE CASCADE"
            )
        except Exception:
            pass  # column already exists — idempotent
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_rss_read_feed "
            "ON rss_read_items(user_id, feed_id, read_at DESC)"
        )

        # ── Subscriptions (Wallos-inspired recurring cost tracker) ──────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id           INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                name              TEXT    NOT NULL,
                amount            REAL    NOT NULL DEFAULT 0,
                currency          TEXT    NOT NULL DEFAULT 'USD',
                cycle             INTEGER NOT NULL DEFAULT 3,
                -- 1=daily  2=weekly  3=monthly  4=yearly
                frequency         INTEGER NOT NULL DEFAULT 1,
                -- billing repeats every N cycles (e.g. freq=3,cycle=3 → every 3 months)
                category          TEXT    NOT NULL DEFAULT '',
                color             TEXT    NOT NULL DEFAULT '#0053e2',
                next_payment_date TEXT,
                -- ISO date YYYY-MM-DD, nullable
                active            INTEGER NOT NULL DEFAULT 1,
                notes             TEXT    NOT NULL DEFAULT '',
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_subscriptions_page "
            "ON subscriptions(page_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_subscriptions_next_payment "
            "ON subscriptions(page_id, next_payment_date)"
        )
        # website_url added Phase 1 icon fix — safe to run on existing DB
        try:
            await db.execute(
                "ALTER TABLE subscriptions ADD COLUMN "
                "website_url TEXT NOT NULL DEFAULT ''"
            )
        except Exception:
            pass  # column already exists

        # reminder_days: how many days before due date to show a reminder banner
        # 0 = no reminder (default)
        try:
            await db.execute(
                "ALTER TABLE subscriptions ADD COLUMN "
                "reminder_days INTEGER NOT NULL DEFAULT 0"
            )
        except Exception:
            pass  # column already exists

        # start_date: when the subscription began (ISO date YYYY-MM-DD, nullable)
        try:
            await db.execute(
                "ALTER TABLE subscriptions ADD COLUMN start_date TEXT"
            )
        except Exception:
            pass  # column already exists

        # cleared_date: set to next_payment_date when user marks renewal as paid.
        # A subscription is hidden from Upcoming Renewals while
        # cleared_date >= next_payment_date (auto-reappears next billing cycle).
        try:
            await db.execute(
                "ALTER TABLE subscriptions ADD COLUMN cleared_date TEXT"
            )
        except Exception:
            pass  # column already exists

        # ── rss_page_feeds: add source_widget_id column (migration) ───────────
        # Tracks which RSS widget originally synced this feed.
        # NULL = manually added feed.  ON DELETE SET NULL means widget deletion
        # automatically clears the link (feed is kept, badge disappears).
        # get_db() enforces PRAGMA foreign_keys=ON on every connection.
        try:
            await db.execute(
                "ALTER TABLE rss_page_feeds "
                "ADD COLUMN source_widget_id INTEGER "
                "REFERENCES home_widgets(id) ON DELETE SET NULL"
            )
        except Exception:
            pass  # column already exists — idempotent

        # ── webauthn_credentials: biometric_type (additive migration) ─────────
        _cur = await db.execute("PRAGMA table_info(webauthn_credentials)")
        _wa_cols = {r[1] for r in await _cur.fetchall()}
        if "biometric_type" not in _wa_cols:
            await db.execute(
                "ALTER TABLE webauthn_credentials ADD COLUMN "
                "biometric_type TEXT NOT NULL DEFAULT 'auto'"
            )

        await db.commit()

        # ── site_settings: persistent runtime flags (admin-toggleable) ────────
        # Separate from env vars so superadmin can change them without a restart.
        # BW_ALLOW_REGISTRATION seeds the initial value on first boot; after that
        # the DB value is authoritative and the env var is ignored.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS site_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        """)
        reg_seed = "true" if os.getenv("BW_ALLOW_REGISTRATION", "true").lower() == "true" else "false"
        await db.execute(
            "INSERT OR IGNORE INTO site_settings (key, value) VALUES ('registration_open', ?)",
            (reg_seed,),
        )

        # ── CRM tables (Phase 1) ──────────────────────────────────────────────
        # Each CRM page is its own independent contact database (per-page scope).
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_contacts (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id      INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                name         TEXT    NOT NULL DEFAULT '',
                email        TEXT    NOT NULL DEFAULT '',
                phone        TEXT    NOT NULL DEFAULT '',
                company      TEXT    NOT NULL DEFAULT '',
                tags         TEXT    NOT NULL DEFAULT '',
                avatar_emoji TEXT    NOT NULL DEFAULT '👤',
                sort_order   INTEGER NOT NULL DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS crm_contacts_updated_at
            AFTER UPDATE ON crm_contacts
            BEGIN
                UPDATE crm_contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END
        """)
        # Phase 5: clean up search_items when a contact is deleted.
        # (No FK cascade — search_items links by item_type+item_id, not FK.)
        await db.execute("DROP TRIGGER IF EXISTS search_items_crm_contact_ad")
        await db.execute("""
            CREATE TRIGGER search_items_crm_contact_ad
            AFTER DELETE ON crm_contacts BEGIN
                INSERT INTO search_items_fts(search_items_fts, rowid, title, body)
                SELECT 'delete', si.id, si.title, si.body
                FROM   search_items si
                WHERE  si.item_type = 'crm_contact' AND si.item_id = old.id;
                DELETE FROM search_items
                WHERE  item_type = 'crm_contact' AND item_id = old.id;
            END
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_custom_fields (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                label      TEXT    NOT NULL,
                field_type TEXT    NOT NULL DEFAULT 'text',
                options    TEXT    NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_contact_field_values (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
                field_id   INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
                value      TEXT    NOT NULL DEFAULT '',
                UNIQUE(contact_id, field_id)
            )
        """)

        # ── CRM tables (Phase 2) ──────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_stages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                name       TEXT    NOT NULL DEFAULT 'New Stage',
                color      TEXT    NOT NULL DEFAULT '#0053e2',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_deals (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                contact_id INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
                stage_id   INTEGER REFERENCES crm_stages(id)   ON DELETE SET NULL,
                title      TEXT    NOT NULL DEFAULT '',
                value      REAL    NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS crm_deals_updated_at
            AFTER UPDATE ON crm_deals
            BEGIN
                UPDATE crm_deals SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END
        """)

        # ── crm_contact_reminders table (additive) ───────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_contact_reminders (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id    INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
                field_id      INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
                user_id       INTEGER NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
                label         TEXT    NOT NULL DEFAULT '',
                reminder_date TEXT    NOT NULL,
                reminder_time TEXT    NOT NULL DEFAULT '09:00',
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_crm_reminders_user_date
                ON crm_contact_reminders(user_id, reminder_date)
        """)
        # ── crm_contact_reminders: message column (additive) ─────────────────
        cur = await db.execute("PRAGMA table_info(crm_contact_reminders)")
        _crm_rem_cols = {r[1] for r in await cur.fetchall()}
        if "message" not in _crm_rem_cols:
            await db.execute(
                "ALTER TABLE crm_contact_reminders ADD COLUMN message TEXT NOT NULL DEFAULT ''"
            )
        if "recurrence" not in _crm_rem_cols:
            await db.execute(
                "ALTER TABLE crm_contact_reminders ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'"
            )

        # ── crm_contacts: profile_pic column (additive migration) ─────────────
        cur = await db.execute("PRAGMA table_info(crm_contacts)")
        _crm_contact_cols = {r[1] for r in await cur.fetchall()}
        if "profile_pic" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN profile_pic TEXT NOT NULL DEFAULT ''"
            )
        if "birthday" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN birthday TEXT NOT NULL DEFAULT ''"
            )
        if "first_met_date" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN first_met_date TEXT NOT NULL DEFAULT ''"
            )
        if "relationship" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN relationship TEXT NOT NULL DEFAULT ''"
            )
        if "address" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN address TEXT NOT NULL DEFAULT ''"
            )
        # profile_pic_upload_id — FK to page_uploads for referential integrity
        # When the upload is deleted, application layer clears both this and profile_pic.
        if "profile_pic_upload_id" not in _crm_contact_cols:
            await db.execute(
                "ALTER TABLE crm_contacts ADD COLUMN profile_pic_upload_id INTEGER"
            )

        # ── Migrate relationship column: free-text → JSON array ──────────────
        # Runs once at startup; idempotent — already-valid JSON arrays are skipped.
        _rel_rows = await (await db.execute(
            "SELECT id, relationship FROM crm_contacts "
            "WHERE relationship IS NOT NULL AND relationship != ''"
        )).fetchall()
        for _rr in _rel_rows:
            _raw = _rr[1]
            try:
                _v = json.loads(_raw)
                if isinstance(_v, list):
                    continue        # already JSON array — nothing to do
            except (json.JSONDecodeError, ValueError):
                pass
            _items = [x.strip() for x in _raw.split(',') if x.strip()]
            await db.execute(
                "UPDATE crm_contacts SET relationship=? WHERE id=?",
                (json.dumps(_items), _rr[0]),
            )
        await db.commit()

        # ── crm_conversation_log table (additive) ───────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_conversation_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id)   ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
                note       TEXT    NOT NULL DEFAULT '',
                logged_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_crm_convo_contact
                ON crm_conversation_log(contact_id, logged_at DESC)
        """)

        # ── crm_projects (pipeline projects — stages belong to a project) ────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS crm_projects (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                name       TEXT    NOT NULL DEFAULT 'Project',
                color      TEXT    NOT NULL DEFAULT '#0053e2',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # ── crm_stages: project_id column (additive migration) ────────────────
        cur = await db.execute("PRAGMA table_info(crm_stages)")
        _crm_stage_cols = {r[1] for r in await cur.fetchall()}
        if "project_id" not in _crm_stage_cols:
            await db.execute(
                "ALTER TABLE crm_stages ADD COLUMN "
                "project_id INTEGER REFERENCES crm_projects(id) ON DELETE SET NULL"
            )

        # ── page_uploads (standalone files for Uploads homespace pages) ─────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS page_uploads (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id       INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id       INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                filename      TEXT    NOT NULL,
                original_name TEXT    NOT NULL,
                mime_type     TEXT    NOT NULL DEFAULT 'application/octet-stream',
                size          INTEGER NOT NULL DEFAULT 0,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_page_uploads_user "
            "ON page_uploads(user_id, created_at)"
        )

        # ── page_upload_tags (user-defined tags across note + standalone files) ─────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS page_upload_tags (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                upload_src  TEXT    NOT NULL CHECK(upload_src IN ('note', 'page')),
                upload_id   INTEGER NOT NULL,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                tag         TEXT    NOT NULL,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(upload_src, upload_id, user_id, tag)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_page_upload_tags_user "
            "ON page_upload_tags(user_id, tag)"
        )

        # ── pdf_annotations (overlay annotations stored as % coords, no PyMuPDF needed) ────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pdf_annotations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
                file_id     INTEGER NOT NULL REFERENCES page_uploads(id) ON DELETE CASCADE,
                page_num    INTEGER NOT NULL DEFAULT 0,
                type        TEXT    NOT NULL,
                x_pct       REAL    NOT NULL,
                y_pct       REAL    NOT NULL,
                width_pct   REAL    NOT NULL DEFAULT 0.2,
                height_pct  REAL    NOT NULL DEFAULT 0.05,
                color       TEXT    NOT NULL DEFAULT '#ffc220',
                content     TEXT    NOT NULL DEFAULT '',
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_pdf_annot_file "
            "ON pdf_annotations(file_id, user_id)"
        )

        # ── upload_folders (virtual folder tree scoped to an uploads home page) ────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS upload_folders (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id     INTEGER NOT NULL REFERENCES home_pages(id)      ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                parent_id   INTEGER REFERENCES upload_folders(id)            ON DELETE SET NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_folders_page "
            "ON upload_folders(page_id, user_id, parent_id, sort_order)"
        )

        # ── upload_folders.deleted_at (soft-delete, additive) ────────────────────────────────
        cur = await db.execute("PRAGMA table_info(upload_folders)")
        _uf_cols = {r[1] for r in await cur.fetchall()}
        if "deleted_at" not in _uf_cols:
            await db.execute(
                "ALTER TABLE upload_folders ADD COLUMN deleted_at DATETIME DEFAULT NULL"
            )

        # ── page_uploads.folder_id column (additive) ────────────────────────────────────────────
        cur = await db.execute("PRAGMA table_info(page_uploads)")
        _pu_cols = {r[1] for r in await cur.fetchall()}
        if "folder_id" not in _pu_cols:
            await db.execute(
                "ALTER TABLE page_uploads ADD COLUMN "
                "folder_id INTEGER REFERENCES upload_folders(id) ON DELETE SET NULL"
            )

        # ── upload_catalogs (many-to-many label tree for uploads pages) ──────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS upload_catalogs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id     INTEGER NOT NULL REFERENCES home_pages(id)      ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                parent_id   INTEGER REFERENCES upload_catalogs(id)           ON DELETE SET NULL,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_upload_catalogs_page "
            "ON upload_catalogs(page_id, user_id, parent_id, sort_order)"
        )

        # ── upload_catalogs.deleted_at (soft-delete, additive) ───────────────────────────────
        cur = await db.execute("PRAGMA table_info(upload_catalogs)")
        _uc_cols = {r[1] for r in await cur.fetchall()}
        if "deleted_at" not in _uc_cols:
            await db.execute(
                "ALTER TABLE upload_catalogs ADD COLUMN deleted_at DATETIME DEFAULT NULL"
            )

        # ── upload_catalog_files (M2M junction: catalogs ↔ page_uploads) ────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS upload_catalog_files (
                catalog_id  INTEGER NOT NULL REFERENCES upload_catalogs(id)  ON DELETE CASCADE,
                upload_id   INTEGER NOT NULL REFERENCES page_uploads(id)     ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (catalog_id, upload_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_ucf_upload "
            "ON upload_catalog_files(upload_id, user_id)"
        )

        # ── Buds widget tables ──────────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS buds (
                id                INTEGER  PRIMARY KEY AUTOINCREMENT,
                widget_id         INTEGER  NOT NULL REFERENCES home_widgets(id) ON DELETE CASCADE,
                user_id           INTEGER  NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
                name              TEXT     NOT NULL,
                flower_species    TEXT     NOT NULL DEFAULT 'daisy',
                see_every_days    INTEGER  NOT NULL DEFAULT 7,
                health            REAL     NOT NULL DEFAULT 100.0,
                health_updated_at DATE     NOT NULL DEFAULT (date('now')),
                last_watered_week TEXT,
                crm_contact_id    INTEGER  REFERENCES crm_contacts(id) ON DELETE SET NULL,
                notes             TEXT,
                sort_order        INTEGER  NOT NULL DEFAULT 0,
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS bud_fertilize_plans (
                id           INTEGER  PRIMARY KEY AUTOINCREMENT,
                bud_id       INTEGER  NOT NULL REFERENCES buds(id) ON DELETE CASCADE,
                user_id      INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                planned_date DATE,
                note         TEXT,
                completed_at DATETIME,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_buds_widget "
            "ON buds(widget_id, sort_order)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_buds_user "
            "ON buds(user_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_buds_crm "
            "ON buds(crm_contact_id)"
        )

        # ── Grid Homespace page cells ──────────────────────────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS home_grid_cells (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id     INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                position    INTEGER NOT NULL DEFAULT 0,
                cell_type   TEXT    NOT NULL DEFAULT 'empty',
                upload_id   INTEGER REFERENCES page_uploads(id) ON DELETE SET NULL,
                aspect      TEXT    NOT NULL DEFAULT '1:1',
                caption     TEXT    NOT NULL DEFAULT '',
                config_json TEXT    NOT NULL DEFAULT '{}',
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_grid_cells_page "
            "ON home_grid_cells(page_id, position)"
        )

        # ── users.unlimited_uploads (per-user upload cap bypass, 2026-04) ──────────────────
        cur = await db.execute("PRAGMA table_info(users)")
        _u_cols = {r[1] for r in await cur.fetchall()}
        if "unlimited_uploads" not in _u_cols:
            await db.execute(
                "ALTER TABLE users ADD COLUMN unlimited_uploads INTEGER NOT NULL DEFAULT 0"
            )

        # ── home_widgets.group_id — widget stack carousel (self-referential FK) ─────────────
        # A widget with group_id pointing to a 'stack' type widget is a child slide.
        # ON DELETE SET NULL: deleting the stack container frees children automatically.
        # PRAGMA foreign_keys=ON is set by get_db() on every connection.
        cur = await db.execute("PRAGMA table_info(home_widgets)")
        _hw_cols = {r[1] for r in await cur.fetchall()}
        if "group_id" not in _hw_cols:
            await db.execute(
                "ALTER TABLE home_widgets ADD COLUMN "
                "group_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL"
            )

        # ── Trip Planning homespace page tables ─────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_spots (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id        INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id        INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                name           TEXT    NOT NULL,
                spot_type      TEXT    NOT NULL DEFAULT 'Other',
                cover_url      TEXT    NOT NULL DEFAULT '',
                map_url        TEXT    NOT NULL DEFAULT '',
                notes          TEXT    NOT NULL DEFAULT '',
                priority       INTEGER NOT NULL DEFAULT 3,
                estimated_cost REAL    NOT NULL DEFAULT 0,
                currency       TEXT    NOT NULL DEFAULT 'USD',
                sort_order     INTEGER NOT NULL DEFAULT 0,
                created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS trip_spots_updated_at
            AFTER UPDATE ON trip_spots
            BEGIN
                UPDATE trip_spots SET updated_at = datetime('now') WHERE id = NEW.id;
            END
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_spots_page "
            "ON trip_spots(page_id, user_id)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_days (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                day_label  TEXT    NOT NULL DEFAULT '',
                day_date   TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_days_page "
            "ON trip_days(page_id, user_id)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_day_spots (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                day_id     INTEGER NOT NULL REFERENCES trip_days(id)  ON DELETE CASCADE,
                spot_id    INTEGER NOT NULL REFERENCES trip_spots(id) ON DELETE CASCADE,
                time_label TEXT    NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                UNIQUE(day_id, spot_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_day_spots_day "
            "ON trip_day_spots(day_id)"
        )

        # ── trip_day_blocks (flexible block content inside day lanes) ───────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_day_blocks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                day_id     INTEGER NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
                block_type TEXT    NOT NULL DEFAULT 'note',
                order_idx  INTEGER NOT NULL DEFAULT 0,
                time_label TEXT    NOT NULL DEFAULT '',
                content    TEXT    NOT NULL DEFAULT '{}'
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_day_blocks_day "
            "ON trip_day_blocks(day_id)"
        )
        # reminder_at: ISO datetime "YYYY-MM-DDTHH:MM" stored for push
        # notifications on itinerary block reminders.
        try:
            await db.execute(
                "ALTER TABLE trip_day_blocks ADD COLUMN reminder_at TEXT"
            )
            await db.commit()
        except Exception:
            pass

        # ── trip_locations (research locations layer, parent of spots) ────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_locations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                name       TEXT    NOT NULL,
                priority   INTEGER NOT NULL DEFAULT 3,
                notes      TEXT    NOT NULL DEFAULT '',
                cover_url  TEXT    NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_locations_page "
            "ON trip_locations(page_id, user_id, sort_order)"
        )

        # ── trip_location_attrs (user-defined key/value attributes per location)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_location_attrs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                location_id INTEGER NOT NULL
                            REFERENCES trip_locations(id) ON DELETE CASCADE,
                attr_key    TEXT    NOT NULL,
                attr_value  TEXT    NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_loc_attrs_loc "
            "ON trip_location_attrs(location_id)"
        )

        # ── trip_spot_attrs (user-defined key/value attributes per spot)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_spot_attrs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                spot_id    INTEGER NOT NULL
                           REFERENCES trip_spots(id) ON DELETE CASCADE,
                attr_key   TEXT    NOT NULL,
                attr_value TEXT    NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_spot_attrs_spot "
            "ON trip_spot_attrs(spot_id)"
        )

        # ── trip_spots.location_id (additive FK to trip_locations) ────────────
        cur = await db.execute("PRAGMA table_info(trip_spots)")
        _ts_cols = {r[1] for r in await cur.fetchall()}
        if "location_id" not in _ts_cols:
            await db.execute(
                "ALTER TABLE trip_spots ADD COLUMN "
                "location_id INTEGER REFERENCES trip_locations(id) ON DELETE SET NULL"
            )

        # ── trip_plans (itinerary segments; parent of plan-tab days) ───────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_plans (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                plan_name  TEXT    NOT NULL DEFAULT 'Trip',
                plan_desc  TEXT    NOT NULL DEFAULT '',
                start_date TEXT    NOT NULL DEFAULT '',
                end_date   TEXT    NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_plans_page "
            "ON trip_plans(page_id, user_id)"
        )
        # trip_plans.cover_url (added 2026-04)
        cur = await db.execute("PRAGMA table_info(trip_plans)")
        _tp_cols = {r[1] for r in await cur.fetchall()}
        if "cover_url" not in _tp_cols:
            await db.execute(
                "ALTER TABLE trip_plans ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''"
            )
        # trip_days.plan_id — nullable so pre-existing days survive
        cur = await db.execute("PRAGMA table_info(trip_days)")
        _td_cols = {r[1] for r in await cur.fetchall()}
        if "plan_id" not in _td_cols:
            await db.execute(
                "ALTER TABLE trip_days ADD COLUMN "
                "plan_id INTEGER REFERENCES trip_plans(id) ON DELETE CASCADE"
            )

        # 🗂️ trip_plan_panels — trip-scoped utility cards (documents, packing,
        #    budget, emergency info, notes) rendered alongside day lanes.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS trip_plan_panels (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id     INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
                plan_id     INTEGER NOT NULL REFERENCES trip_plans(id)  ON DELETE CASCADE,
                panel_type  TEXT    NOT NULL,
                title       TEXT    NOT NULL DEFAULT '',
                content     TEXT    NOT NULL DEFAULT '{}',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_trip_plan_panels_plan "
            "ON trip_plan_panels(plan_id)"
        )

        # ── Workspace Databases: card tables ────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS db_cards (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                db_id           INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                user_id         INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                title           TEXT    NOT NULL DEFAULT 'Untitled',
                cover_url       TEXT    NOT NULL DEFAULT '',
                note_content    TEXT    NOT NULL DEFAULT '',
                note_box_height INTEGER NOT NULL DEFAULT 200,
                sort_order      INTEGER NOT NULL DEFAULT 0,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_db_cards_db "
            "ON db_cards(db_id, sort_order)"
        )
        await db.execute("""
            CREATE TABLE IF NOT EXISTS db_card_attrs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id      INTEGER NOT NULL REFERENCES db_cards(id) ON DELETE CASCADE,
                attr_key     TEXT    NOT NULL,
                attr_value   TEXT    NOT NULL DEFAULT '',
                attr_type    TEXT    NOT NULL DEFAULT 'text',
                attr_options TEXT    NOT NULL DEFAULT '',
                sort_order   INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_db_card_attrs_card "
            "ON db_card_attrs(card_id, sort_order)"
        )
        # ── additive migrations for attr_type / attr_options ──────────────────
        _dca_cols = {r[1] for r in await (await db.execute(
            "PRAGMA table_info(db_card_attrs)"
        )).fetchall()}
        if "attr_type" not in _dca_cols:
            await db.execute(
                "ALTER TABLE db_card_attrs ADD COLUMN attr_type TEXT NOT NULL DEFAULT 'text'"
            )
        if "attr_options" not in _dca_cols:
            await db.execute(
                "ALTER TABLE db_card_attrs ADD COLUMN attr_options TEXT NOT NULL DEFAULT ''"
            )
        if "visibility" not in _dca_cols:
            await db.execute(
                "ALTER TABLE db_card_attrs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'always'"
            )
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS db_cards_updated_at
            AFTER UPDATE ON db_cards
            BEGIN
                UPDATE db_cards SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END
        """)

        # ── db_cards: cover_upload_id link (migration) ───────────────────────────
        # Ties a card cover to its page_uploads row so deletions on either side
        # stay consistent.  The BEFORE DELETE trigger fires while OLD.id is still
        # matchable in db_cards, clearing both fields before the upload row goes.
        cur = await db.execute("PRAGMA table_info(db_cards)")
        _dc_cols = {row[1] for row in await cur.fetchall()}
        if "cover_upload_id" not in _dc_cols:
            await db.execute(
                "ALTER TABLE db_cards ADD COLUMN cover_upload_id INTEGER"
            )
        await db.execute("""
            CREATE TRIGGER IF NOT EXISTS page_uploads_cover_unlink
            BEFORE DELETE ON page_uploads
            BEGIN
                UPDATE db_cards
                   SET cover_url       = '',
                       cover_upload_id = NULL
                 WHERE cover_upload_id = OLD.id;
            END
        """)

        # ── page_uploads: db_card_id + db_card_attr_id link (migration) ───────────
        # Tags attr-file uploads so the Uploads page can show a badge linking back
        # to the card, and so deletes propagate in both directions.
        # Additive + idempotent — safe to run on a live DB.
        cur = await db.execute("PRAGMA table_info(page_uploads)")
        _pu2_cols = {row[1] for row in await cur.fetchall()}
        if "db_card_id" not in _pu2_cols:
            await db.execute(
                "ALTER TABLE page_uploads ADD COLUMN "
                "db_card_id INTEGER REFERENCES db_cards(id) ON DELETE SET NULL"
            )
        if "db_card_attr_id" not in _pu2_cols:
            await db.execute(
                "ALTER TABLE page_uploads ADD COLUMN "
                "db_card_attr_id INTEGER REFERENCES db_card_attrs(id) ON DELETE SET NULL"
            )

        # ── note_reminders — inline reminders set via /reminder slash command ──
        await db.execute("""
            CREATE TABLE IF NOT EXISTS note_reminders (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
                note_id       INTEGER          REFERENCES notes(id)  ON DELETE SET NULL,
                label         TEXT    NOT NULL DEFAULT '',
                reminder_date TEXT    NOT NULL,
                reminder_time TEXT    NOT NULL DEFAULT '09:00',
                message       TEXT    NOT NULL DEFAULT '',
                fired         INTEGER NOT NULL DEFAULT 0,
                created_at    DATETIME         DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_note_reminders_user_date
                ON note_reminders(user_id, reminder_date)
        """)
        # additive: message column (existing DBs created before this column)
        cur = await db.execute("PRAGMA table_info(note_reminders)")
        _nr_cols = {r[1] for r in await cur.fetchall()}
        if "message" not in _nr_cols:
            await db.execute(
                "ALTER TABLE note_reminders ADD COLUMN message TEXT NOT NULL DEFAULT ''"
            )

        # ── push_subscriptions — Web Push (PushSubscription from browser) ────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                endpoint   TEXT    NOT NULL UNIQUE,
                p256dh     TEXT    NOT NULL,
                auth       TEXT    NOT NULL,
                user_agent TEXT    NOT NULL DEFAULT '',
                created_at DATETIME         DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_push_subs_user
                ON push_subscriptions(user_id)
        """)

        # ── RSS per-feed notification opt-ins ───────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rss_feed_notifs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                feed_url   TEXT    NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, feed_url)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_rss_feed_notifs_user "
            "ON rss_feed_notifs(user_id)"
        )
        # ── RSS seen-item dedup (prevents resending items already notified) ────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rss_notif_seen (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_url  TEXT    NOT NULL,
                item_guid TEXT    NOT NULL,
                seen_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(feed_url, item_guid)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_rss_notif_seen_url "
            "ON rss_notif_seen(feed_url)"
        )

        # ── widget_notif_sent: dedup guard for countdown + event push alerts ─────
        # key format:
        #   countdown:{widget_id}:{target_date}
        #   event:{widget_id}:{item_id}:{occurrence_iso}:{lead_days}
        await db.execute("""
            CREATE TABLE IF NOT EXISTS widget_notif_sent (
                key      TEXT    NOT NULL PRIMARY KEY,
                sent_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS public_share_links (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                token       TEXT    NOT NULL UNIQUE,
                object_type TEXT    NOT NULL
                            CHECK(object_type IN ('note', 'db_card')),
                object_id   INTEGER NOT NULL,
                owner_id    INTEGER NOT NULL
                            REFERENCES users(id) ON DELETE CASCADE,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at  DATETIME DEFAULT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_pub_share_token "
            "ON public_share_links(token)"
        )
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_pub_share_object "
            "ON public_share_links(object_type, object_id, owner_id)"
        )

        # ── Performance indexes (2026-05-13) ────────────────────────────────────────────────
        # SQLite does NOT auto-index FK columns — every FK without an explicit index is a
        # potential full table scan.  These 11 indexes cover the highest-traffic query paths
        # identified by the perf-detective audit.  All use IF NOT EXISTS — safe to re-run.

        # home_pages — hit on every session page load
        #   Query shape: WHERE user_id=? AND deleted_at IS NULL ORDER BY sort_order
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_home_pages_user "
            "ON home_pages(user_id, deleted_at, sort_order)"
        )
        # home_widgets — FK; fetched on every home page render
        #   Query shape: WHERE page_id=? ORDER BY sort_order, id
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_home_widgets_page "
            "ON home_widgets(page_id, sort_order)"
        )
        # notes — primary filter in every search_notes() call
        #   Query shape: WHERE workspace_id IN (?,?,?) ORDER BY meeting_date DESC
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_workspace "
            "ON notes(workspace_id, meeting_date DESC)"
        )
        # note_categories — reverse direction of the PK (note_id, category_id)
        #   Needed for bulk-category JOIN in the N+1 fix: WHERE category_id IN (...)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_cat_category "
            "ON note_categories(category_id)"
        )
        # note_attributes — FK; called per-note in _fetch_note_attributes
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_attrs_note "
            "ON note_attributes(note_id)"
        )
        # note_attachments — FK; called per-note in attachment fetch
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_note_attach_note "
            "ON note_attachments(note_id)"
        )
        # crm_contacts — every CRM page query filters on both page_id and user_id
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_crm_contacts_page_user "
            "ON crm_contacts(page_id, user_id, sort_order)"
        )
        # crm_custom_fields — same dual-column filter as contacts
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_crm_fields_page_user "
            "ON crm_custom_fields(page_id, user_id, sort_order)"
        )
        # crm_stages — pipeline board renders depend on this
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_crm_stages_page_user "
            "ON crm_stages(page_id, user_id, sort_order)"
        )
        # crm_deals — joined with contacts; stage_id also appears in WHERE
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_crm_deals_page_user "
            "ON crm_deals(page_id, user_id, stage_id, sort_order)"
        )
        # bud_fertilize_plans — _get_pending_plan() queries bud_id + user_id + completed_at
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_bud_plans_bud_user "
            "ON bud_fertilize_plans(bud_id, user_id, completed_at, planned_date)"
        )

        # ── buds: contact reminder fields (additive migration) ──────────────────────
        # contact_reminder_time      — HH:MM at which to send the overdue push, NULL = off
        # contact_reminder_last_sent — DATE we last sent it (dedup guard)
        for _col, _defn in [
            ("contact_reminder_time",      "TEXT"),
            ("contact_reminder_last_sent",  "DATE"),
        ]:
            _buds_cols = [r[1] for r in (await (await db.execute("PRAGMA table_info(buds)")).fetchall())]
            if _col not in _buds_cols:
                await db.execute(f"ALTER TABLE buds ADD COLUMN {_col} {_defn}")

        # ── bud_fertilize_plans: visit reminder fields (additive migration) ────────
        # visit_reminder_enabled — 1 = push reminder at 9am on planned_date
        # visit_reminder_sent    — DATE sent (dedup guard)
        # visit_reminder_time    — HH:MM when push fires (default '09:00')
        for _col, _defn in [
            ("visit_reminder_enabled", "INTEGER NOT NULL DEFAULT 0"),
            ("visit_reminder_sent",    "DATE"),
            ("visit_reminder_time",    "TEXT NOT NULL DEFAULT '09:00'"),
        ]:
            _plan_cols = [r[1] for r in (await (await db.execute("PRAGMA table_info(bud_fertilize_plans)")).fetchall())]
            if _col not in _plan_cols:
                await db.execute(f"ALTER TABLE bud_fertilize_plans ADD COLUMN {_col} {_defn}")

        # ── One-shot cleanup: purge orphaned page_upload_tags ─────────────────────
        # Before attachments_db.delete_attachment_record was fixed to cascade
        # into page_upload_tags, deleting a note attachment left orphaned tag
        # rows behind.  Clean them up once so ghost filter pills go away.
        await db.execute(
            """
            DELETE FROM page_upload_tags
            WHERE upload_src = 'note'
              AND NOT EXISTS (
                    SELECT 1 FROM note_attachments na
                    WHERE na.id = page_upload_tags.upload_id
              )
            """
        )
        # Also purge page-src tags whose file no longer exists.
        await db.execute(
            """
            DELETE FROM page_upload_tags
            WHERE upload_src = 'page'
              AND NOT EXISTS (
                    SELECT 1 FROM page_uploads pu
                    WHERE pu.id = page_upload_tags.upload_id
              )
            """
        )

        # ── ai_usage_log (per-query LLM token + cost tracking) ────────────────────────
        # One row per successful LLM stream.  cost_usd is NULL for models
        # whose pricing is not in search_llm._MODEL_COSTS (e.g. local Ollama).
        await db.execute("""
            CREATE TABLE IF NOT EXISTS ai_usage_log (
                id            INTEGER  PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                queried_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                model         TEXT     NOT NULL DEFAULT '',
                input_tokens  INTEGER  NOT NULL DEFAULT 0,
                output_tokens INTEGER  NOT NULL DEFAULT 0,
                cost_usd      REAL,
                query_text    TEXT     NOT NULL DEFAULT '',
                answer_text   TEXT     NOT NULL DEFAULT ''
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date "
            "ON ai_usage_log(user_id, queried_at)"
        )
        # Additive migration — answer_text added after initial ship
        await db.execute(
            "ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS "
            "answer_text TEXT NOT NULL DEFAULT ''"
        )

        await db.commit()

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
