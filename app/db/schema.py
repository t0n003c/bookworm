"""db.schema — the FULL database schema (CREATE TABLE statements) and seed defaults.

Static SQL/data only: no imports, no logic. `db.migrations.init_db()` runs every
statement here FIRST (CREATE TABLE IF NOT EXISTS — a no-op on an existing DB), then
applies additive/idempotent migrations + indexes + triggers on top. Because this
builds the complete current schema, a brand-new (empty) database boots cleanly:
the migrations that follow find every table/column they reference already present.

These definitions are the authoritative current shape of each table (FTS5 virtual
tables + their shadow tables are created by init_db(), not here). Re-exported from
`database.py` for backward compatibility. See ARCHITECTURE.md (Phase 2b).
"""

CREATE_TABLES_SQL = [
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
            title TEXT NOT NULL,
            content TEXT,
            meeting_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        , workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL, icon TEXT DEFAULT NULL, parent_note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE, parent_card_id INTEGER REFERENCES db_cards(id) ON DELETE CASCADE, is_inline_page INTEGER NOT NULL DEFAULT 0)
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
    CREATE TABLE IF NOT EXISTS workspace_categories (
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    PRIMARY KEY (workspace_id, category_id)
                )
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
    CREATE TABLE IF NOT EXISTS site_settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL DEFAULT ''
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        , role TEXT NOT NULL DEFAULT 'user', totp_secret TEXT DEFAULT NULL, totp_enabled INTEGER NOT NULL DEFAULT 0, unlimited_uploads INTEGER NOT NULL DEFAULT 0, llm_endpoint TEXT NOT NULL DEFAULT '', llm_api_key TEXT NOT NULL DEFAULT '', llm_model TEXT NOT NULL DEFAULT '')
    """,
    """
    CREATE TABLE IF NOT EXISTS rss_page_feeds (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    url        TEXT    NOT NULL,
                    label      TEXT    NOT NULL DEFAULT '',
                    color      TEXT    NOT NULL DEFAULT '#0053e2',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT    NOT NULL DEFAULT (datetime('now')), category TEXT NOT NULL DEFAULT '', source_widget_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL,
                    UNIQUE(page_id, url)
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS home_pages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name       TEXT    NOT NULL DEFAULT 'My Page',
            emoji      TEXT    NOT NULL DEFAULT '🏠',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        , config_json TEXT NOT NULL DEFAULT '{}', page_type TEXT NOT NULL DEFAULT 'dashboard', deleted_at DATETIME DEFAULT NULL, is_favorite INTEGER NOT NULL DEFAULT 0, fav_sort_order INTEGER NOT NULL DEFAULT 0)
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
        , group_id INTEGER REFERENCES home_widgets(id) ON DELETE SET NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS "workspaces" (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        name        TEXT NOT NULL,
                        emoji       TEXT NOT NULL DEFAULT '📁',
                        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                        is_open     INTEGER NOT NULL DEFAULT 1,
                        parent_id   INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
                        is_favorite INTEGER NOT NULL DEFAULT 0,
                        fav_sort_order INTEGER NOT NULL DEFAULT 0,
                        deleted_at  DATETIME DEFAULT NULL,
                        sort_order  INTEGER NOT NULL DEFAULT 0
                    , ws_type TEXT NOT NULL DEFAULT 'workspace')
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS rss_read_items (
                    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    page_id  INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    item_guid TEXT NOT NULL,
                    read_at  TEXT NOT NULL DEFAULT (datetime('now')), feed_id INTEGER REFERENCES rss_page_feeds(id) ON DELETE CASCADE,
                    PRIMARY KEY (user_id, page_id, item_guid)
                )
    """,
    """
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
                , profile_pic TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '', first_met_date TEXT NOT NULL DEFAULT '', relationship TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', profile_pic_upload_id INTEGER)
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS crm_contact_field_values (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
                    field_id   INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
                    value      TEXT    NOT NULL DEFAULT '',
                    UNIQUE(contact_id, field_id)
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS crm_stages (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                    name       TEXT    NOT NULL DEFAULT 'New Stage',
                    color      TEXT    NOT NULL DEFAULT '#0053e2',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                , project_id INTEGER REFERENCES crm_projects(id) ON DELETE SET NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS crm_contact_reminders (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    contact_id    INTEGER NOT NULL REFERENCES crm_contacts(id)      ON DELETE CASCADE,
                    field_id      INTEGER NOT NULL REFERENCES crm_custom_fields(id) ON DELETE CASCADE,
                    user_id       INTEGER NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
                    label         TEXT    NOT NULL DEFAULT '',
                    reminder_date TEXT    NOT NULL,
                    reminder_time TEXT    NOT NULL DEFAULT '09:00',
                    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
                , message TEXT NOT NULL DEFAULT '', recurrence TEXT NOT NULL DEFAULT 'none')
    """,
    """
    CREATE TABLE IF NOT EXISTS crm_projects (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                    name       TEXT    NOT NULL DEFAULT 'Project',
                    color      TEXT    NOT NULL DEFAULT '#0053e2',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS page_uploads (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id       INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    user_id       INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                    filename      TEXT    NOT NULL,
                    original_name TEXT    NOT NULL,
                    mime_type     TEXT    NOT NULL DEFAULT 'application/octet-stream',
                    size          INTEGER NOT NULL DEFAULT 0,
                    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
                , folder_id INTEGER REFERENCES upload_folders(id) ON DELETE SET NULL, db_card_id INTEGER REFERENCES db_cards(id) ON DELETE SET NULL, db_card_attr_id INTEGER REFERENCES db_card_attrs(id) ON DELETE SET NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS page_upload_tags (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    upload_src  TEXT    NOT NULL CHECK(upload_src IN ('note', 'page')),
                    upload_id   INTEGER NOT NULL,
                    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    tag         TEXT    NOT NULL,
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(upload_src, upload_id, user_id, tag)
                )
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS upload_folders (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id     INTEGER NOT NULL REFERENCES home_pages(id)      ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                    name        TEXT    NOT NULL,
                    parent_id   INTEGER REFERENCES upload_folders(id)            ON DELETE SET NULL,
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                , deleted_at DATETIME DEFAULT NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS upload_catalogs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id     INTEGER NOT NULL REFERENCES home_pages(id)      ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                    name        TEXT    NOT NULL,
                    parent_id   INTEGER REFERENCES upload_catalogs(id)           ON DELETE SET NULL,
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                , deleted_at DATETIME DEFAULT NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS upload_catalog_files (
                    catalog_id  INTEGER NOT NULL REFERENCES upload_catalogs(id)  ON DELETE CASCADE,
                    upload_id   INTEGER NOT NULL REFERENCES page_uploads(id)     ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
                    added_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (catalog_id, upload_id)
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS buds (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        widget_id         INTEGER NOT NULL REFERENCES home_widgets(id) ON DELETE CASCADE,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name              TEXT    NOT NULL,
        flower_species    TEXT    NOT NULL DEFAULT 'daisy',
        see_every_days    INTEGER NOT NULL DEFAULT 7,
        health            REAL    NOT NULL DEFAULT 100.0,
        health_updated_at DATE    NOT NULL DEFAULT (date('now')),
        last_watered_week TEXT,
        crm_contact_id    INTEGER REFERENCES crm_contacts(id) ON DELETE SET NULL,
        notes             TEXT,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    , contact_reminder_time TEXT, contact_reminder_last_sent DATE)
    """,
    """
    CREATE TABLE IF NOT EXISTS bud_fertilize_plans (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        bud_id       INTEGER NOT NULL REFERENCES buds(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        planned_date DATE,
        note         TEXT,
        completed_at DATETIME,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    , visit_reminder_enabled INTEGER NOT NULL DEFAULT 0, visit_reminder_sent DATE, visit_reminder_time TEXT NOT NULL DEFAULT '09:00')
    """,
    """
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
    """,
    """
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
                , website_url TEXT NOT NULL DEFAULT '', reminder_days INTEGER NOT NULL DEFAULT 0, start_date TEXT, cleared_date TEXT)
    """,
    """
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
                , location_id INTEGER REFERENCES trip_locations(id) ON DELETE SET NULL)
    """,
    """
    CREATE TABLE IF NOT EXISTS trip_days (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id    INTEGER NOT NULL REFERENCES home_pages(id) ON DELETE CASCADE,
                    user_id    INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
                    day_label  TEXT    NOT NULL DEFAULT '',
                    day_date   TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                , plan_id INTEGER REFERENCES trip_plans(id) ON DELETE CASCADE)
    """,
    """
    CREATE TABLE IF NOT EXISTS trip_day_spots (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    day_id     INTEGER NOT NULL REFERENCES trip_days(id)  ON DELETE CASCADE,
                    spot_id    INTEGER NOT NULL REFERENCES trip_spots(id) ON DELETE CASCADE,
                    time_label TEXT    NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(day_id, spot_id)
                )
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS trip_location_attrs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    location_id INTEGER NOT NULL
                                REFERENCES trip_locations(id) ON DELETE CASCADE,
                    attr_key    TEXT    NOT NULL,
                    attr_value  TEXT    NOT NULL DEFAULT '',
                    sort_order  INTEGER NOT NULL DEFAULT 0
                )
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS trip_spot_attrs (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    spot_id    INTEGER NOT NULL
                               REFERENCES trip_spots(id) ON DELETE CASCADE,
                    attr_key   TEXT    NOT NULL,
                    attr_value TEXT    NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0
                )
    """,
    """
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
                , cover_url TEXT NOT NULL DEFAULT '')
    """,
    """
    CREATE TABLE IF NOT EXISTS trip_day_blocks (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    day_id     INTEGER NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
                    block_type TEXT    NOT NULL DEFAULT 'note',
                    order_idx  INTEGER NOT NULL DEFAULT 0,
                    time_label TEXT    NOT NULL DEFAULT '',
                    content    TEXT    NOT NULL DEFAULT '{}'
                , reminder_at TEXT)
    """,
    """
    CREATE TABLE IF NOT EXISTS note_reminders (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id       INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
                    note_id       INTEGER          REFERENCES notes(id)  ON DELETE SET NULL,
                    label         TEXT    NOT NULL DEFAULT '',
                    reminder_date TEXT    NOT NULL,
                    reminder_time TEXT    NOT NULL DEFAULT '09:00',
                    fired         INTEGER NOT NULL DEFAULT 0,
                    created_at    DATETIME         DEFAULT CURRENT_TIMESTAMP
                , message TEXT NOT NULL DEFAULT '')
    """,
    """
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
                , cover_upload_id INTEGER)
    """,
    """
    CREATE TABLE IF NOT EXISTS db_card_attrs (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_id    INTEGER NOT NULL REFERENCES db_cards(id) ON DELETE CASCADE,
                    attr_key   TEXT    NOT NULL,
                    attr_value TEXT    NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0
                , attr_type TEXT NOT NULL DEFAULT 'text', attr_options TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'always')
    """,
    """
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
    """,
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    endpoint   TEXT    NOT NULL UNIQUE,
                    p256dh     TEXT    NOT NULL,
                    auth       TEXT    NOT NULL,
                    user_agent TEXT    NOT NULL DEFAULT '',
                    created_at DATETIME         DEFAULT CURRENT_TIMESTAMP
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS rss_feed_notifs (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    feed_url   TEXT    NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, feed_url)
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS rss_notif_seen (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_url  TEXT    NOT NULL,
                    item_guid TEXT    NOT NULL,
                    seen_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(feed_url, item_guid)
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS widget_notif_sent (
                    key      TEXT    NOT NULL PRIMARY KEY,
                    sent_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                )
    """,
    """
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            credential_id TEXT    NOT NULL UNIQUE,
            public_key    TEXT    NOT NULL,
            sign_count    INTEGER NOT NULL DEFAULT 0,
            device_name   TEXT    NOT NULL DEFAULT 'My Device',
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used_at  DATETIME
        , biometric_type TEXT NOT NULL DEFAULT 'auto')
    """,
    """
    CREATE TABLE IF NOT EXISTS crm_conversation_log (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
                    page_id    INTEGER NOT NULL REFERENCES home_pages(id)   ON DELETE CASCADE,
                    user_id    INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
                    note       TEXT    NOT NULL DEFAULT '',
                    logged_at  DATETIME DEFAULT CURRENT_TIMESTAMP
                )
    """,
    """
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
    """,
    """
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
