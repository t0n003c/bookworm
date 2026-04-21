"""Database initialization and connection management."""
import aiosqlite
import asyncio
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
            await db.commit()
        except Exception:
            pass  # column already exists — idempotent

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
            await db.commit()
        except Exception:
            pass  # column already exists — idempotent

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

        await db.commit()

@asynccontextmanager
async def get_db():
    """Async context manager yielding a live DB connection.

    Pragmas applied on every connection:
      - foreign_keys   : enforce referential integrity
      - journal_mode   : WAL for concurrent readers + one writer (safe for
                         multiple async tasks and up to a few uvicorn workers)
      - busy_timeout   : wait up to 5 s before raising "database is locked"
                         instead of failing immediately under write contention
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys  = ON")
        await db.execute("PRAGMA journal_mode  = WAL")
        await db.execute("PRAGMA busy_timeout  = 5000")
        yield db
