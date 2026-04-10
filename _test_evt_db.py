"""Direct DB check: find event widgets and inspect their config_json."""
import sqlite3
import json
import pathlib

db_path = pathlib.Path("bookworm.db")
if not db_path.exists():
    print("bookworm.db not found in CWD")
    raise SystemExit(1)

conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("=== Event widgets in DB ===\n")
rows = cur.execute(
    "SELECT id, page_id, widget_type, style, config_json FROM home_widgets WHERE widget_type='event' ORDER BY id"
).fetchall()

if not rows:
    print("No event widgets found in DB!")
else:
    for row in rows:
        print(f"Widget {row['id']} | page {row['page_id']} | style={row['style']}")
        raw = row['config_json'] or '{}'
        print(f"  Raw config_json: {raw[:400]}")
        try:
            cfg = json.loads(raw)
            items = cfg.get('items', [])
            print(f"  Parsed OK — {len(items)} item(s):")
            for it in items:
                print(f"    • {it}")
        except json.JSONDecodeError as e:
            print(f"  ❌ JSON parse error: {e}")
        print()

conn.close()
