"""Verify FTS5 migration — Eddie one-shot."""
import sqlite3, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from database import DB_PATH

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row

tables = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'"
).fetchall()]
print("notes_fts table:", tables)

trigs = [r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'notes_fts%'"
).fetchall()]
print("FTS triggers:", trigs)

cnt = conn.execute("SELECT count(*) FROM notes_fts").fetchone()[0]
print("Indexed notes:", cnt)

rows = conn.execute("""
    SELECT n.title,
           snippet(notes_fts, 1, char(2), char(3), '...', 20) AS snip,
           bm25(notes_fts) AS score
    FROM notes_fts
    JOIN notes n ON n.id = notes_fts.rowid
    WHERE notes_fts MATCH 'search*'
    ORDER BY bm25(notes_fts) LIMIT 5
""").fetchall()
print(f'Search "search*": {len(rows)} hits')
for r in rows:
    snip = r["snip"].replace(chr(2), ">>").replace(chr(3), "<<")
    print(f'  [{r["score"]:.2f}] {r["title"][:40]} | {snip[:60]}')

conn.close()
print("Done.")
