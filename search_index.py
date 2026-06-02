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

    # Persist — write then atomically swap so queries keep old index until done
    _PKL_VECTORIZER.write_bytes(pickle.dumps(vectorizer))
    _PKL_MATRIX.write_bytes(pickle.dumps(matrix))
    _PKL_ITEM_IDS.write_bytes(pickle.dumps(item_ids))
    _PKL_ITEM_TYPES.write_bytes(pickle.dumps(item_types))
    _PKL_USER_IDS.write_bytes(pickle.dumps(user_ids))

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
