"""Create the hybrid search Q&A planning note in BookWorm — Eddie one-shot script."""
import sys, os, sqlite3, datetime
sys.path.insert(0, os.path.dirname(__file__))
from database import DB_PATH

WORKSPACE_ID = 47   # 📁 BOOKWORM (uid=1 / t0n003c)
TITLE        = "🔍 Hybrid Search Q&A — Planning & Phases"
ICON         = "🔍"

CONTENT = r"""# 🔍 Hybrid Search Q&A — Planning & Phases

> **Status:** Brainstorming complete — ready to build.
> Created by Eddie 🐾 on 2026-05-25. Do not delete — active feature plan.

---

## What We're Building

A **Ctrl+K floating Q&A panel** that lets any user ask questions in plain English and get answers sourced directly from their own BookWorm notes. Think BUGS, but wired to your personal notes instead of StoreSpace slides.

**Core pipeline (mirrors BUGS exactly):**

```
User question
│
└─► _retrieve(query, user_id)
    │
    ├─► asyncio.gather()  ← concurrent, same pattern as BUGS
    │   ├─► _semantic_search()   TF-IDF cosine (run_in_executor, CPU-bound)
    │   │   └─► global matrix → filter user_ids[i] == user_id post-rank
    │   │
    │   └─► _fts5_search()       FTS5 keyword (run_in_executor, I/O-bound)
    │       └─► SQL WHERE scoped to user's workspaces from the start
    │
    ├─► merge + dedup by note_id
    ├─► _score_note()  (semantic ×5 + keyword hits + bigram bonus)
    └─► top K notes → LLM context → SSE streaming answer + source cards
```

---

## Architecture Decisions (Locked In)

### ✅ Embedded in BookWorm — NOT a separate Docker service
No second container. Notes already live in `bookworm.db`. A separate service
would need cross-container DB access, a cross-service auth handshake, and extra
ops overhead. New router `routers/search_qa.py` + `search_index.py` in main app.

### ✅ Global TF-IDF matrix, filter post-rank (NOT per-user pickles)
The "leak" concern is a phantom — users only ever see their own notes in results
because we filter `user_ids[i] == user_id` BEFORE returning anything. The only
artifact is that IDF weights are trained on everyone's vocabulary, which is
actually better (more training data = sharper term discrimination). For a Walmart
Grocery team writing about similar topics this is a feature not a bug.

```python
# Build: one nightly job, all users
all_notes = get_all_notes_for_index()      # [{id, user_id, title, content}]
note_ids  = [n['id']      for n in all_notes]
user_ids  = [n['user_id'] for n in all_notes]   # stored alongside note_ids
matrix    = vectorizer.fit_transform(corpus)

# Query: filter after ranking
def _semantic_search(query, user_id):
    sims = cosine_similarity(vectorizer.transform([query]), matrix).flatten()
    top  = sims.argsort()[::-1][:50]            # generous pool
    return [
        {"note_id": note_ids[i], "score": float(sims[i])}
        for i in top
        if user_ids[i] == user_id               # ← filter HERE
        and sims[i] > 0.01
    ][:10]
```

### ✅ FTS5 via SQLite triggers (always in sync)
TF-IDF rebuilds nightly at 6 AM — stale by up to 24h.
FTS5 stays live via three INSERT/UPDATE/DELETE triggers — zero lag.
New note saved at 6:01 AM? Searchable via keywords at 6:01 AM.
TF-IDF picks it up the next morning.

### ✅ Configurable LLM (OpenAI-compatible endpoint)
OpenAI `/v1/chat/completions` is now the de-facto standard.
Element AI, OpenAI, Ollama, Groq, Mistral all speak it.
Three new keys in `site_settings`:
- `qa_llm_endpoint`  e.g. `https://puppy-backend.walmart.com/anthropic`
- `qa_llm_api_key`   bearer token
- `qa_llm_model`     e.g. `claude-haiku-4-5`

Leave endpoint empty = disable LLM = pure retrieval mode (still useful!).

---

## Phases

### Phase 1 — FTS5 + Ctrl+K panel (no new Python deps)

**Goal:** Ship a working search panel fast. Pure retrieval, no AI yet.
Users type a question → see matching notes as cards with snippet highlights.

**New DB (migration in `database.py`):**
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
USING fts5(title, content, content='notes', content_rowid='id');

-- Keep it in sync automatically
CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes
  BEGIN INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content); END;
CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes
  BEGIN INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
       INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content); END;
CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes
  BEGIN INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content); END;
```

**New files:**
- `routers/search_qa.py` — `GET /qa/search?q=…` (JSON results)
- `static/js/bw-search-qa.js` — Ctrl+K panel, result cards, keyboard nav

**No new Python packages.** Ships fast.

---

### Phase 2 — TF-IDF re-ranker + nightly index

**Goal:** Add semantic understanding on top of Phase 1 keyword results.

**New files:**
- `search_index.py` — TF-IDF builder (mirrors `embeddings.py` from BUGS)
  - `build_tfidf_index()` — builds global matrix, stores 3 pickles
  - `_semantic_search(query, user_id)` — cosine sim + post-rank filter
  - Pickles: `bw_tfidf_vectorizer.pkl`, `bw_tfidf_matrix.pkl`, `bw_tfidf_note_ids.pkl`
    (also `bw_tfidf_user_ids.pkl` — parallel array to note_ids)

**Scheduler (APScheduler in `main.py`):**
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
scheduler = AsyncIOScheduler()
scheduler.add_job(rebuild_index_background, 'cron', hour=6, minute=0)
scheduler.start()
```

**Updated pipeline in `routers/search_qa.py`:**
```python
async def _retrieve(query, user_id):
    loop = asyncio.get_event_loop()
    tfidf_hits, fts5_hits = await asyncio.gather(
        loop.run_in_executor(None, _semantic_search, query, user_id),
        _fts5_search(query, user_id),
    )
    return _merge_and_score(tfidf_hits, fts5_hits)
```

**New Python dep:** `scikit-learn` (+ numpy, already transitive) ~50 MB in Docker image.

---

### Phase 3 — LLM streaming answer

**Goal:** Pass top K notes as context to an LLM, stream the answer via SSE.

**New files:**
- `search_llm.py` — async LLM client (OpenAI-compatible, mirrors `llm_client.py` from BUGS)
  - `stream_llm(question, context_notes)` → `AsyncGenerator[str]`
  - Reads `qa_llm_endpoint` / `qa_llm_api_key` / `qa_llm_model` from `site_settings`
  - Empty endpoint → yields nothing (pure retrieval fallback)

**New endpoint in `routers/search_qa.py`:**
```
GET /qa/stream?q=…   → text/event-stream  (SSE token chunks)
```

**UI additions in `bw-search-qa.js`:**
- Streaming answer renders above the source note cards
- Source cards are clickable — open the note in the sidebar
- "Stop" button cancels the SSE stream (`AbortController`)

**Settings UI:** New "AI Search" section in superadmin settings panel
(same pattern as the existing Collabora settings row).

---

### Phase 4 — Index beyond notes

**Goal:** True app-wide Q&A.

Index in addition to notes:
- Workspace names + descriptions
- DB card titles + note content  
- Home page widget text content (todo items, text widgets, event titles)

Each indexed item carries `{type: 'note'|'db_card'|'widget', id, user_id}`.
Source cards in the panel link to the right place based on type.

---

## New Files Summary

| File | Phase | Purpose |
|---|---|---|
| `routers/search_qa.py` | 1 | Search endpoints (`/qa/search`, `/qa/stream`) |
| `static/js/bw-search-qa.js` | 1 | Ctrl+K panel, result cards, keyboard nav |
| `search_index.py` | 2 | TF-IDF build + `_semantic_search()` |
| `search_llm.py` | 3 | OpenAI-compatible streaming LLM client |

---

## New Dependencies

| Package | Phase | Why |
|---|---|---|
| `scikit-learn` | 2 | TF-IDF vectorizer + cosine similarity |
| `apscheduler` | 2 | Nightly 6 AM index rebuild cron |
| `httpx` | 3 | Already in requirements (RSS proxy uses it) ✅ |

---

## Checklist Before Building

- [ ] Phase 1: FTS5 migration + triggers in `database.py`
- [ ] Phase 1: `GET /qa/search` returns `{results: [{note_id, title, snippet, score, workspace_name}]}`
- [ ] Phase 1: Ctrl+K panel — opens on `Ctrl+K` / `Cmd+K`, closes on `Escape`
- [ ] Phase 1: Keyboard nav (↑↓ arrows through results, Enter to open note)
- [ ] Phase 2: `search_index.py` with nightly APScheduler job
- [ ] Phase 2: First-run index build on server startup (if pickles missing)
- [ ] Phase 2: `GET /qa/rebuild` superadmin endpoint to trigger manual rebuild
- [ ] Phase 3: `GET /qa/stream` SSE endpoint
- [ ] Phase 3: Superadmin settings UI for LLM endpoint/key/model
- [ ] Phase 4: Decide what else to index (DB cards? widgets?)

---

## Open Questions

- Should the Ctrl+K panel replace the existing note search, or sit alongside it?
- Max context length for Phase 3 LLM? (BUGS uses top 5 slides, ~3000 chars each)
- Should non-superadmin users be able to set their OWN LLM API key in account settings?
  (Per-user key would let each person use their own OpenAI key if the team doesn't have Element AI)
- Index attachments? (PDFs/DOCX already have text extraction in Document Studio)
"""

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row

now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
cur = conn.execute(
    "INSERT INTO notes (workspace_id, title, content, icon, meeting_date, created_at, updated_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    (WORKSPACE_ID, TITLE, CONTENT, ICON, '', now, now),
)
conn.commit()
note_id = cur.lastrowid
print(f"✅ Note created! ID={note_id} in WS {WORKSPACE_ID}")
conn.close()
