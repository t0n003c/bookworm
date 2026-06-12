"""Read note #265 content — Eddie one-shot, delete after."""
import sqlite3, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from database import DB_PATH

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
row = conn.execute(
    "SELECT id, title, content FROM notes WHERE id = 265"
).fetchone()
if row:
    print(f"=== Note {row['id']}: {row['title']} ===\n")
    print(row["content"])
else:
    print("Note 265 not found.")
conn.close()
