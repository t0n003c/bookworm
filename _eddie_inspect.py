"""Quick DB inspector — Eddie uses this, delete after."""
import sys, os, sqlite3
sys.path.insert(0, os.path.dirname(__file__))
from database import DB_PATH

print(f"DB_PATH: {DB_PATH}")
print(f"exists:  {os.path.exists(str(DB_PATH))}")
if not os.path.exists(str(DB_PATH)):
    sys.exit("DB not found!")

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row

users = conn.execute("SELECT id, username FROM users").fetchall()
for u in users:
    print(f"USER {u['id']}: {u['username']}")

ws = conn.execute(
    "SELECT id, user_id, name, emoji, parent_id FROM workspaces "
    "WHERE deleted_at IS NULL ORDER BY user_id, sort_order"
).fetchall()
for w in ws:
    print(f"  WS {w['id']} uid={w['user_id']} parent={w['parent_id']}: {w['emoji']} {w['name']}")

conn.close()
