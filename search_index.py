"""TF-IDF semantic search index — Phase 2, Hybrid Search Q&A.

Nightly rebuild at 6 AM via APScheduler (wired in main.py lifespan).
A synchronous build runs in an executor so it never blocks the event loop.
Module-level state is swapped atomically under a threading.Lock so
concurrent queries always see a consistent snapshot.

User isolation: the global matrix covers all users.
semantic_search() filters results to user_ids[i] == user_id BEFORE
returning anything — no note content from other users is ever exposed.

Pickles are stored in BW_DATA_DIR alongside bookworm.db.
They survive server restarts; a fresh boot loads them in ~200 ms.
"""
import asyncio
import logging
import pickle
import sqlite3
import threading

from database import DB_PATH, _DATA_DIR

log = logging.getLogger(__name__)

# ── Pickle file paths (under BW_DATA_DIR) ────────────────────────────────
_PKL_VECTORIZER = _DATA_DIR / "bw_tfidf_vectorizer.pkl"
_PKL_MATRIX     = _DATA_DIR / "bw_tfidf_matrix.pkl"
_PKL_NOTE_IDS   = _DATA_DIR / "bw_tfidf_note_ids.pkl"
_PKL_USER_IDS   = _DATA_DIR / "bw_tfidf_user_ids.pkl"

# ── Module-level state — replaced atomically on each rebuild ─────────────
_vectorizer  = None   # sklearn TfidfVectorizer (fitted)
_matrix      = None   # scipy sparse matrix [n_notes × n_features]
_note_ids: list = []  # parallel: note primary keys
_user_ids: list = []  # parallel: owning user's id
_lock = threading.Lock()


def is_ready() -> bool:
    """True if an index is in memory and ready to serve queries."""
    return _matrix is not None


def load_from_disk() -> bool:
    """Load the four pickles from disk. Returns True on success."""
    global _vectorizer, _matrix, _note_ids, _user_ids
    try:
        v = pickle.loads(_PKL_VECTORIZER.read_bytes())
        m = pickle.loads(_PKL_MATRIX.read_bytes())
        n = pickle.loads(_PKL_NOTE_IDS.read_bytes())
        u = pickle.loads(_PKL_USER_IDS.read_bytes())
        with _lock:
            _vectorizer, _matrix, _note_ids, _user_ids = v, m, n, u
        log.info("search_index: loaded from disk — %d notes", len(n))
        return True
    except Exception as exc:
        log.debug("search_index: disk load skipped — %s", exc)
        return False


def _sync_rebuild() -> None:
    """Blocking CPU-bound rebuild. Call via loop.run_in_executor(None, ...)."""
    global _vectorizer, _matrix, _note_ids, _user_ids
    from sklearn.feature_extraction.text import TfidfVectorizer

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT n.id AS note_id, n.title, n.content, w.user_id
            FROM   notes      n
            JOIN   workspaces w ON w.id = n.workspace_id
            WHERE  w.deleted_at IS NULL
        """).fetchall()
    finally:
        conn.close()

    if not rows:
        log.warning("search_index: no notes found — index not built")
        return

    note_ids = [r["note_id"] for r in rows]
    user_ids = [r["user_id"] for r in rows]
    corpus   = [
        (r["title"] or "") + " " + (r["content"] or "")
        for r in rows
    ]

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
    _PKL_NOTE_IDS.write_bytes(pickle.dumps(note_ids))
    _PKL_USER_IDS.write_bytes(pickle.dumps(user_ids))

    with _lock:
        _vectorizer, _matrix, _note_ids, _user_ids = vectorizer, matrix, note_ids, user_ids

    log.info("search_index: rebuilt — %d notes indexed", len(note_ids))


async def rebuild_index() -> None:
    """Async wrapper. Runs the sync rebuild in a thread-pool executor."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, _sync_rebuild)
    except Exception:
        log.exception("search_index: rebuild failed")


def semantic_search(query: str, user_id: int, top_k: int = 50) -> list:
    """Cosine similarity over the global matrix, filtered to user_id.

    Returns [{note_id, score}] sorted by score descending.
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
            results.append({"note_id": int(_note_ids[i]), "score": score})
            if len(results) >= top_k:
                break
        return results
    except Exception:
        log.exception("search_index: semantic_search failed")
        return []
