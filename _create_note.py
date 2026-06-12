"""One-shot script: create the AI Search / RAG note in a target workspace."""
import asyncio
import sys
import aiosqlite

DB = "bookworm.db"

NOTE_TITLE = "How AI Search (LLM / RAG) works in BookWorm"

NOTE_CONTENT = """## How the AI is integrated — it's RAG

BookWorm uses a pattern called **Retrieval-Augmented Generation (RAG)**. Here's exactly what happens when you press **Enter** in the search panel without a card highlighted:

```
Your question: "what did I write about pasta?"
        │
        ▼
① Hybrid Search  (runs first, milliseconds)
   ├─ FTS5 keyword search       ─── concurrent ──┐
   └─ TF-IDF cosine similarity  ─────────────────┘
        │
        ▼  top 5 ranked note IDs
        │
② Fetch full note content from SQLite
  (title + body, trimmed to 2,000 chars each)
        │
        ▼
③ Build a prompt:
   System: "Answer ONLY using these notes:
            [Note 1] Pasta Carbonara Recipe...
            [Note 2] Italian dinner planning...
            ..."
   User: "what did I write about pasta?"
        │
        ▼
④ Stream tokens from LLM → your screen
```

**The AI never touches the database directly.** It only sees the 5 notes that the hybrid search already ranked as most relevant. The AI's job is purely to synthesise a readable answer from those notes.

---

## Why this design?

| | What BookWorm does | Alternative (not used) |
|---|---|---|
| **Who searches?** | BookWorm's own FTS5 + TF-IDF | The LLM with tool calls |
| **What AI sees** | Top 5 note excerpts (≤10 k chars total) | Your entire database |
| **Speed** | Fast — search done before LLM call starts | Slower, more round trips |
| **Cost** | Cheap — small fixed context window | Grows with DB size |

The trade-off: if the hybrid search misses the right notes, the AI answer will be incomplete — it can only work with what it was handed.

---

## Model selection — planned enhancement

OpenAI-compatible servers expose `GET /models` which returns a list of all available models. BookWorm doesn't call this yet — the **Model** field in the Admin → AI Search panel is currently a plain text input (you type the model name manually).

**Planned Phase 3.5 improvement:**
- On blur of the Endpoint URL field, hit `{endpoint}/models`
- Populate a `<datalist>` dropdown with the returned model IDs
- ~30 lines of JS + one lightweight backend proxy endpoint
- Works with OpenAI, Ollama, LM Studio, Element AI, and any other OpenAI-compatible server

---

## LLM endpoint examples

| Provider | Endpoint URL | Model example | API Key |
|---|---|---|---|
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | `sk-proj-…` |
| **Ollama** (local) | `http://localhost:11434/v1` | `llama3.2` | *(blank)* |
| **LM Studio** (local) | `http://localhost:1234/v1` | *(any loaded model)* | *(blank)* |
| **Element AI** | *(see Element docs)* | *(per Element)* | *(Element token)* |

> ⚠️ Do **not** include `/chat/completions` in the endpoint URL — BookWorm appends it automatically.
"""


async def main():
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode = WAL")
        await db.execute("PRAGMA foreign_keys = ON")

        # ── list all workspaces so user can pick ──────────────────────
        cur = await db.execute(
            "SELECT w.id, w.name, w.emoji, u.username "
            "FROM workspaces w JOIN users u ON u.id = w.user_id "
            "WHERE w.deleted_at IS NULL ORDER BY u.id, w.id"
        )
        rows = await cur.fetchall()
        print("\nAvailable workspaces:")
        for r in rows:
            print(f"  [{r['id']}] {r['emoji']} {r['name']}  (user: {r['username']})")

        if not rows:
            print("No workspaces found — is the server running with data?")
            return

        # ── find "General Note" (case-insensitive) ────────────────────
        target = next(
            (r for r in rows if "general" in r["name"].lower()),
            None,
        )
        if not target:
            # fall back to first workspace of first non-demo user
            target = next(
                (r for r in rows if not r["username"].startswith("demo")),
                rows[0],
            )
        ws_id = target["id"]
        print(f"\nTarget workspace: [{ws_id}] {target['emoji']} {target['name']}"
              f"  (user: {target['username']})")

        # ── check for duplicate title ─────────────────────────────────
        cur = await db.execute(
            "SELECT id FROM notes WHERE workspace_id = ? AND title = ?",
            (ws_id, NOTE_TITLE),
        )
        existing = await cur.fetchone()
        if existing:
            print(f"Note already exists (id={existing['id']}) — skipping.")
            return

        # ── insert note ───────────────────────────────────────────────
        from datetime import date
        cur = await db.execute(
            "INSERT INTO notes (workspace_id, title, content, meeting_date) VALUES (?, ?, ?, ?)",
            (ws_id, NOTE_TITLE, NOTE_CONTENT, date.today().isoformat()),
        )
        await db.commit()
        note_id = cur.lastrowid
        print(f"✅  Note created — id={note_id}, workspace_id={ws_id}")
        print(f"    Open at: http://localhost:8000/?note={note_id}")


asyncio.run(main())
