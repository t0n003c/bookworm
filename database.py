"""Database initialization and connection management."""
import aiosqlite
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

DB_PATH = Path("bookworm.db")


CREATE_TABLES_SQL = [
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        emoji TEXT NOT NULL DEFAULT '📁',
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

        # Seed default workspace and get its id
        await db.execute(
            "INSERT OR IGNORE INTO workspaces (name, emoji) VALUES (?, ?)",
            (SEED_WORKSPACE_NAME, SEED_WORKSPACE_EMOJI),
        )
        cursor = await db.execute(
            "SELECT id FROM workspaces WHERE name = ?", (SEED_WORKSPACE_NAME,)
        )
        row = await cursor.fetchone()
        default_ws_id = row[0] if row else 1

        # Migration: add is_open column to workspaces if missing
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}
        if "is_open" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1"
            )
            await db.execute("UPDATE workspaces SET is_open = 1")

        # Migration: add parent_id column to workspaces if missing
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}
        if "parent_id" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN parent_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"
            )

        # Migration: add is_favorite column to workspaces if missing
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}
        if "is_favorite" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0"
            )

        # Migration: add deleted_at (soft-delete / trash) column if missing
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}
        if "deleted_at" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN deleted_at DATETIME DEFAULT NULL"
            )

        # Migration: add sort_order column for drag-and-drop reordering
        cursor = await db.execute("PRAGMA table_info(workspaces)")
        ws_cols = {r[1] for r in await cursor.fetchall()}
        if "sort_order" not in ws_cols:
            await db.execute(
                "ALTER TABLE workspaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
            )
            # Backfill: preserve existing creation order using id spacing
            await db.execute("UPDATE workspaces SET sort_order = id * 10")
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_ws_sort "
                "ON workspaces(parent_id, sort_order)"
            )

        # Migration: add icon column to notes if missing
        cursor = await db.execute("PRAGMA table_info(notes)")
        cols = {r[1] for r in await cursor.fetchall()}
        if "icon" not in cols:
            await db.execute("ALTER TABLE notes ADD COLUMN icon TEXT DEFAULT NULL")

        # Migration: add workspace_id column to notes if missing
        cursor = await db.execute("PRAGMA table_info(notes)")
        cols = {r[1] for r in await cursor.fetchall()}
        if "workspace_id" not in cols:
            await db.execute("ALTER TABLE notes ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL")
            # Assign existing notes to the default workspace
            await db.execute("UPDATE notes SET workspace_id = ? WHERE workspace_id IS NULL", (default_ws_id,))

        # Seed existing notes that have no workspace
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

        await db.commit()


@asynccontextmanager
async def get_db():
    """Async context manager yielding a live DB connection."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        yield db
