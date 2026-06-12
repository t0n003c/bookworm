"""TF-IDF semantic search index — Phase 2+4, Hybrid Search Q&A.

Nightly rebuild at 6 AM via APScheduler (wired in main.py lifespan).
A synchronous build runs in an executor so it never blocks the event loop.
Module-level state is swapped atomically under a threading.Lock so
concurrent queries always see a consistent snapshot.

Phase 4A additions:
- Index now covers notes, db_cards, workspaces, and text-bearing home_widgets.
- _item_ids / _item_types parallel arrays replace the old _note_ids.
- semantic_search() returns [{item_type, item_id, score}] — callers updated.
- sync_widget_items() keeps search_items shadow table in sync (hourly).

User isolation: the global matrix covers all users.
semantic_search() filters results to user_ids[i] == user_id BEFORE
returning anything — no content from other users is ever exposed.

Pickles are stored in BW_DATA_DIR alongside bookworm.db.
They survive server restarts; a fresh boot loads them in ~200 ms.
"""
import asyncio
import json
import logging
import os
import pickle
import sqlite3
import threading

from database import DB_PATH, _DATA_DIR

log = logging.getLogger(__name__)

# ── Pickle file paths (under BW_DATA_DIR) ────────────────────────────────
_PKL_VECTORIZER  = _DATA_DIR / "bw_tfidf_vectorizer.pkl"
_PKL_MATRIX      = _DATA_DIR / "bw_tfidf_matrix.pkl"
_PKL_ITEM_IDS    = _DATA_DIR / "bw_tfidf_item_ids.pkl"    # renamed from note_ids
_PKL_ITEM_TYPES  = _DATA_DIR / "bw_tfidf_item_types.pkl"  # new in Phase 4A
_PKL_USER_IDS    = _DATA_DIR / "bw_tfidf_user_ids.pkl"

# ── Module-level state — replaced atomically on each rebuild ─────────────
_vectorizer       = None   # sklearn TfidfVectorizer (fitted)
_matrix           = None   # scipy sparse matrix [n_items × n_features]
_item_ids: list   = []     # parallel: item primary keys
_item_types: list = []     # parallel: 'note'|'db_card'|'workspace'|'widget'
_user_ids: list   = []     # parallel: owning user's id
_lock = threading.Lock()

# Widget types that carry user-authored text worth indexing
_TEXT_WIDGET_TYPES = {"text", "sticky", "title", "todo", "reminder", "countdown"}


def is_ready() -> bool:
    """True if an index is in memory and ready to serve queries."""
    return _matrix is not None


def load_from_disk() -> bool:
    """Load pickles from disk. Returns True on success.

    Falls back gracefully if Phase 4A pickles are missing (first boot
    after upgrade) — the full rebuild is triggered automatically.
    """
    global _vectorizer, _matrix, _item_ids, _item_types, _user_ids
    try:
        v  = pickle.loads(_PKL_VECTORIZER.read_bytes())
        m  = pickle.loads(_PKL_MATRIX.read_bytes())
        u  = pickle.loads(_PKL_USER_IDS.read_bytes())
        # Try Phase 4A pickles; fall back to old note_ids pickle on first upgrade
        try:
            ids   = pickle.loads(_PKL_ITEM_IDS.read_bytes())
            types = pickle.loads(_PKL_ITEM_TYPES.read_bytes())
        except FileNotFoundError:
            # Pre-Phase-4 install: old pickle was bw_tfidf_note_ids.pkl
            old_pkl = _DATA_DIR / "bw_tfidf_note_ids.pkl"
            ids   = pickle.loads(old_pkl.read_bytes())
            types = ["note"] * len(ids)
        with _lock:
            _vectorizer  = v
            _matrix      = m
            _item_ids    = ids
            _item_types  = types
            _user_ids    = u
        log.info("search_index: loaded from disk — %d items", len(ids))
        return True
    except Exception as exc:
        log.debug("search_index: disk load skipped — %s", exc)
        return False


def _extract_widget_text(widget_type: str, config_json_str: str) -> str:
    """Extract indexable plain text from a widget's config_json blob."""
    try:
        cfg = json.loads(config_json_str or "{}")
    except (json.JSONDecodeError, ValueError):
        return ""

    if widget_type in ("text", "sticky"):
        return str(cfg.get("text") or "")
    if widget_type == "title":
        return str(cfg.get("title") or "")
    if widget_type == "countdown":
        return str(cfg.get("label") or "")
    if widget_type == "todo":
        items = cfg.get("items") or []
        return " ".join(str(it.get("text") or "") for it in items if it.get("text"))
    if widget_type == "reminder":
        items = cfg.get("items") or []
        return " ".join(str(it.get("label") or "") for it in items if it.get("label"))
    return ""


def _sync_rebuild() -> None:
    """Blocking CPU-bound rebuild. Call via loop.run_in_executor(None, ...)."""
    global _vectorizer, _matrix, _item_ids, _item_types, _user_ids
    from sklearn.feature_extraction.text import TfidfVectorizer

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        # ── Notes ────────────────────────────────────────────────────────
        note_rows = conn.execute("""
            SELECT n.id AS item_id, n.title, n.content, w.user_id
            FROM   notes      n
            JOIN   workspaces w ON w.id = n.workspace_id
            WHERE  w.deleted_at IS NULL
        """).fetchall()

        # ── DB cards ─────────────────────────────────────────────────────
        card_rows = conn.execute("""
            SELECT id AS item_id, user_id,
                   COALESCE(title, '')        AS title,
                   COALESCE(note_content, '') AS content
            FROM   db_cards
        """).fetchall()

        # ── Workspaces ───────────────────────────────────────────────────
        ws_rows = conn.execute("""
            SELECT id AS item_id, user_id,
                   COALESCE(emoji, '') || ' ' || COALESCE(name, '') AS title
            FROM   workspaces
            WHERE  deleted_at IS NULL
        """).fetchall()

        # ── Text-bearing widgets ─────────────────────────────────────────
        widget_rows = conn.execute("""
            SELECT hw.id AS item_id, hp.user_id,
                   hw.widget_type, hw.config_json
            FROM   home_widgets hw
            JOIN   home_pages   hp ON hp.id = hw.page_id
            WHERE  hw.widget_type IN ('text','sticky','title','todo','reminder','countdown')
        """).fetchall()
    finally:
        conn.close()

    item_ids   = []
    item_types = []
    user_ids   = []
    corpus     = []

    for r in note_rows:
        item_ids.append(int(r["item_id"]))
        item_types.append("note")
        user_ids.append(r["user_id"])
        corpus.append((r["title"] or "") + " " + (r["content"] or ""))

    for r in card_rows:
        item_ids.append(int(r["item_id"]))
        item_types.append("db_card")
        user_ids.append(r["user_id"])
        corpus.append((r["title"] or "") + " " + (r["content"] or ""))

    for r in ws_rows:
        item_ids.append(int(r["item_id"]))
        item_types.append("workspace")
        user_ids.append(r["user_id"])
        corpus.append(r["title"] or "")

    for r in widget_rows:
        text = _extract_widget_text(r["widget_type"], r["config_json"])
        if not text.strip():
            continue
        item_ids.append(int(r["item_id"]))
        item_types.append("widget")
        user_ids.append(r["user_id"])
        corpus.append(text)

    if not corpus:
        log.warning("search_index: nothing to index — skipping rebuild")
        return

    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        sublinear_tf=True,
        max_features=50_000,
        strip_accents="unicode",
    )
    matrix = vectorizer.fit_transform(corpus)

    # Persist — write to temp files first, then atomically rename so a crash
    # mid-write never leaves a mix of old/new pickle files on disk.
    import tempfile
    pkl_pairs = [
        (_PKL_VECTORIZER, pickle.dumps(vectorizer)),
        (_PKL_MATRIX,     pickle.dumps(matrix)),
        (_PKL_ITEM_IDS,   pickle.dumps(item_ids)),
        (_PKL_ITEM_TYPES, pickle.dumps(item_types)),
        (_PKL_USER_IDS,   pickle.dumps(user_ids)),
    ]
    for dest, data in pkl_pairs:
        fd, tmp_path = tempfile.mkstemp(dir=dest.parent, prefix=".bw_tmp_")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp_path, dest)  # atomic on POSIX and Windows
        except Exception:
            os.unlink(tmp_path)   # clean up orphaned temp on failure
            raise

    with _lock:
        _vectorizer  = vectorizer
        _matrix      = matrix
        _item_ids    = item_ids
        _item_types  = item_types
        _user_ids    = user_ids

    log.info(
        "search_index: rebuilt — %d items (%d notes, %d cards, %d workspaces, %d widgets)",
        len(item_ids),
        sum(1 for t in item_types if t == "note"),
        sum(1 for t in item_types if t == "db_card"),
        sum(1 for t in item_types if t == "workspace"),
        sum(1 for t in item_types if t == "widget"),
    )


async def rebuild_index() -> None:
    """Async wrapper. Runs the sync rebuild in a thread-pool executor."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _sync_rebuild)
    except Exception:
        log.exception("search_index: rebuild failed")


def semantic_search(query: str, user_id: int, top_k: int = 50) -> list:
    """Cosine similarity over the global matrix, filtered to user_id.

    Returns [{item_type, item_id, score}] sorted by score descending.
    Score is in [0, 1]; results below 0.01 are dropped.
    Safe to call concurrently — reads only; no mutation.
    """
    if _matrix is None or _vectorizer is None:
        return []
    try:
        from sklearn.metrics.pairwise import cosine_similarity
        q_vec = _vectorizer.transform([query])
        sims  = cosine_similarity(q_vec, _matrix).flatten()
        # Over-sample before user-filter to ensure we fill top_k
        top_i = sims.argsort()[::-1][: top_k * 4]
        results = []
        for i in top_i:
            if _user_ids[i] != user_id:
                continue
            score = float(sims[i])
            if score < 0.01:
                break
            results.append({
                "item_type": _item_types[i],
                "item_id":   int(_item_ids[i]),
                "score":     score,
            })
            if len(results) >= top_k:
                break
        return results
    except Exception:
        log.exception("search_index: semantic_search failed")
        return []


def _sync_widget_items() -> int:
    """Sync text-bearing widgets into search_items. Returns row count upserted."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT hw.id, hp.user_id, hw.widget_type, hw.config_json,
                   hp.id AS page_id
            FROM   home_widgets hw
            JOIN   home_pages   hp ON hp.id = hw.page_id
            WHERE  hw.widget_type IN ('text','sticky','title','todo','reminder','countdown')
        """).fetchall()

        count = 0
        for r in rows:
            text = _extract_widget_text(r["widget_type"], r["config_json"])
            if not text.strip():
                continue
            link_data = json.dumps({"page_id": r["page_id"]})
            # Upsert into shadow table
            conn.execute("""
                INSERT INTO search_items (item_type, item_id, user_id, title, body, link_data)
                VALUES ('widget', ?, ?, ?, ?, ?)
                ON CONFLICT(item_type, item_id) DO UPDATE SET
                    body       = excluded.body,
                    updated_at = datetime('now')
            """, (r["id"], r["user_id"], r["widget_type"], text, link_data))
            count += 1

        if count == 0:
            log.debug("search_index: widget sync — no text widgets found, skipping FTS rebuild")
            return count

        # Rebuild the FTS index to reflect upserted rows
        conn.execute("INSERT INTO search_items_fts(search_items_fts) VALUES('rebuild')")
        conn.commit()
        return count
    finally:
        conn.close()


async def sync_widget_items() -> None:
    """Async wrapper for the widget shadow-table sync (runs hourly)."""
    loop = asyncio.get_event_loop()
    try:
        n = await loop.run_in_executor(None, _sync_widget_items)
        log.info("search_index: widget sync — %d rows upserted", n)
    except Exception:
        log.exception("search_index: widget sync failed")


# ── CRM contact search sync (Phase 5) ────────────────────────────────────────

def _build_contact_body(conn: sqlite3.Connection, contact_id: int, c: sqlite3.Row) -> tuple:
    """Return (title, body) for a crm_contact search_items row.

    Body = pipe-joined: core fields + custom-field label:value pairs
    + last 10 conversation snippets (dated).
    """
    parts = []
    for field in ("email", "phone", "company", "tags", "relationship", "address"):
        val = (c[field] or "").strip()
        if val:
            parts.append(val)

    # Custom field values: "Label: value"
    cf_rows = conn.execute(
        "SELECT cf.label, cfv.value "
        "FROM crm_contact_field_values cfv "
        "JOIN crm_custom_fields cf ON cf.id = cfv.field_id "
        "WHERE cfv.contact_id = ? AND cfv.value != ''",
        (contact_id,),
    ).fetchall()
    for cf in cf_rows:
        parts.append(f"{cf['label']}: {cf['value']}")

    # Last 10 conversation entries (newest first, each dated)
    convos = conn.execute(
        "SELECT note, logged_at FROM crm_conversation_log "
        "WHERE contact_id = ? ORDER BY logged_at DESC, id DESC LIMIT 10",
        (contact_id,),
    ).fetchall()
    for convo in convos:
        note = (convo["note"] or "").strip()
        if note:
            date = (convo["logged_at"] or "")[:10]
            parts.append(f"[{date}] {note}")

    title = (c["name"] or "").strip() or "Unnamed Contact"
    body = " | ".join(parts)
    return title, body


def _last_convo_preview(conn: sqlite3.Connection, contact_id: int) -> str:
    """Return the most recent conversation note (truncated) for link_data preview."""
    row = conn.execute(
        "SELECT note FROM crm_conversation_log "
        "WHERE contact_id = ? ORDER BY logged_at DESC, id DESC LIMIT 1",
        (contact_id,),
    ).fetchone()
    return ((row["note"] or "") if row else "")[:120]


def _sync_crm_contacts() -> int:
    """Bulk-upsert all CRM contacts into search_items + rebuild FTS.

    Returns the number of contacts upserted.
    Safe to call multiple times (idempotent ON CONFLICT DO UPDATE).
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        contacts = conn.execute(
            "SELECT id, user_id, page_id, name, email, phone, company, "
            "       tags, relationship, address "
            "FROM crm_contacts"
        ).fetchall()

        if not contacts:
            return 0

        for c in contacts:
            cid = c["id"]
            title, body = _build_contact_body(conn, cid, c)
            link_data = json.dumps({
                "page_id":    c["page_id"],
                "contact_id": cid,
                "email":      (c["email"] or "").strip(),
                "phone":      (c["phone"] or "").strip(),
                "company":    (c["company"] or "").strip(),
                "tags":       (c["tags"] or "").strip(),
                "last_convo": _last_convo_preview(conn, cid),
            })
            conn.execute(
                "INSERT INTO search_items "
                "    (item_type, item_id, user_id, title, body, link_data) "
                "VALUES ('crm_contact', ?, ?, ?, ?, ?) "
                "ON CONFLICT(item_type, item_id) DO UPDATE SET "
                "    title=excluded.title, body=excluded.body, "
                "    link_data=excluded.link_data, updated_at=datetime('now')",
                (cid, c["user_id"], title, body, link_data),
            )

        conn.execute("INSERT INTO search_items_fts(search_items_fts) VALUES('rebuild')")
        conn.commit()
        return len(contacts)
    finally:
        conn.close()


def _upsert_contact_si_sync(contact_id: int) -> None:
    """Sync one CRM contact into search_items after a mutation.

    Uses the precise delete-update-reinsert FTS pattern (not a full rebuild)
    so it's cheap enough to call on every conversation or field change.
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        c = conn.execute(
            "SELECT id, user_id, page_id, name, email, phone, company, "
            "       tags, relationship, address "
            "FROM crm_contacts WHERE id = ?",
            (contact_id,),
        ).fetchone()
        if c is None:
            return  # deleted — SQL trigger already cleaned up search_items

        title, body = _build_contact_body(conn, contact_id, c)
        link_data = json.dumps({
            "page_id":    c["page_id"],
            "contact_id": contact_id,
            "email":      (c["email"] or "").strip(),
            "phone":      (c["phone"] or "").strip(),
            "company":    (c["company"] or "").strip(),
            "tags":       (c["tags"] or "").strip(),
            "last_convo": _last_convo_preview(conn, contact_id),
        })

        existing = conn.execute(
            "SELECT id, title, body FROM search_items "
            "WHERE item_type = 'crm_contact' AND item_id = ?",
            (contact_id,),
        ).fetchone()

        if existing:
            # FTS delete FIRST (while shadow table still holds old content)
            conn.execute(
                "INSERT INTO search_items_fts(search_items_fts, rowid, title, body) "
                "VALUES ('delete', ?, ?, ?)",
                (existing["id"], existing["title"], existing["body"]),
            )
            conn.execute(
                "UPDATE search_items "
                "SET title=?, body=?, link_data=?, updated_at=datetime('now') "
                "WHERE item_type='crm_contact' AND item_id=?",
                (title, body, link_data, contact_id),
            )
        else:
            conn.execute(
                "INSERT INTO search_items "
                "    (item_type, item_id, user_id, title, body, link_data) "
                "VALUES ('crm_contact', ?, ?, ?, ?, ?)",
                (contact_id, c["user_id"], title, body, link_data),
            )

        # Re-insert updated FTS row
        si = conn.execute(
            "SELECT id FROM search_items "
            "WHERE item_type='crm_contact' AND item_id=?",
            (contact_id,),
        ).fetchone()
        if si:
            conn.execute(
                "INSERT INTO search_items_fts(rowid, title, body) VALUES (?, ?, ?)",
                (si["id"], title, body),
            )
        conn.commit()
    finally:
        conn.close()


async def sync_crm_contacts() -> None:
    """Async wrapper — bulk-sync all CRM contacts into search shadow table."""
    loop = asyncio.get_event_loop()
    try:
        n = await loop.run_in_executor(None, _sync_crm_contacts)
        log.info("search_index: CRM contact sync — %d rows upserted", n)
    except Exception:
        log.exception("search_index: CRM contact sync failed")


async def upsert_contact_search_item(contact_id: int) -> None:
    """Async — sync one CRM contact after a mutation (add/edit/conversation)."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _upsert_contact_si_sync, contact_id)
    except Exception:
        log.exception("search_index: upsert_contact_search_item(%d) failed", contact_id)
