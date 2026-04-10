"""Quick template smoke-test — delete after use."""
import json, sys, os, traceback
sys.path.insert(0, os.path.dirname(__file__))

# Use the real templates env so all custom filters are registered
from templates_env import templates
env = templates.env

widgets = [
    {"id": 1, "widget_type": "clock",    "style": "digital",  "config_json": "{}",                     "sort_order": 0},
    {"id": 2, "widget_type": "reminder", "style": "list",     "config_json": "{\"items\":[]}",          "sort_order": 1},
    {"id": 3, "widget_type": "title",    "style": "plain",    "config_json": "{\"text\":\"Hi World\"}",  "sort_order": 2},
    {"id": 4, "widget_type": "todo",     "style": "compact",  "config_json": "{\"items\":[]}",          "sort_order": 3},
]
for w in widgets:
    try:    w["config"] = json.loads(w.get("config_json", "{}"))
    except: w["config"] = {}

page = {"id": 1, "name": "Test", "emoji": "🏠", "config": {}, "config_json": "{}", "layout": "grid", "cols": 3}

try:
    t   = env.get_template("partials/home_page.html")
    out = t.render(page=page, widgets=widgets, all_notes=[], home_pages=[])
    print(f"OK: {len(out)} chars")
except Exception:
    traceback.print_exc()

# Also render index.html (no widgets context)
try:
    t2  = env.get_template("index.html")
    print("index.html loaded OK")
except Exception:
    traceback.print_exc()
