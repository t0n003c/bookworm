"""Quick smoke-test for the _evt_prepare_items filter."""
import json, sys, importlib.util

# Load the filter without importing the whole app
spec = importlib.util.spec_from_file_location("templates_env", "templates_env.py")
mod  = importlib.util.load_from_spec = None

# Just exec the relevant function directly
exec(open("templates_env.py").read().split("def _fmt_reminder_date")[0]
     .replace("from datetime import date as _date", "")
     .replace("from pathlib import Path", "")
     .replace("import jinja2", "")
     .replace("from fastapi.templating import Jinja2Templates", "")
     .replace("import json", ""))

# Test items from DB
items = [
    {"id": 1775491411534, "text": "sdfs", "target_date": "2026-04-07",
     "color": "#7c3aed", "repeat_unit": "week", "repeat_interval": 1, "lead_days": [3]}
]

result = _evt_prepare_items(items)
print("=== evt_prepare_items result ===")
for r in result:
    print(f"  _idx={r['_idx']}  _next_iso={r['_next_iso']}")
    print(f"  _badge={r['_badge']}")
    print(f"  _repeat={r['_repeat']!r}")
    print(f"  _date_str={r['_date_str']!r}")
print("\n✅ Filter works!")
