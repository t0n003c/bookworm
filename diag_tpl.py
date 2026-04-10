"""Quick Jinja2 render test for home templates."""
import sys, traceback
from templates_env import templates

# templates._env is the real jinja2.Environment with all filters registered
env = templates.env

page = {'id': 1, 'name': 'My Page', 'emoji': '🏠', 'config': {'col_count': 3}}
widgets = []
all_notes = []

# ── home_page.html ────────────────────────────────────────────────────
print("Testing home_page.html ...", flush=True)
try:
    tmpl = env.get_template('partials/home_page.html')
    out = tmpl.render(page=page, widgets=widgets, all_notes=all_notes)
    print(f"  OK — {len(out)} chars", flush=True)
except Exception as e:
    print(f"  FAIL: {e}", flush=True)
    traceback.print_exc()

# ── index.html ────────────────────────────────────────────────────────
print("Testing index.html ...", flush=True)
try:
    tmpl2 = env.get_template('index.html')
    ctx = {
        'request': type('R', (), {'session': {}})(),
        'home_pages': [],
        'categories': [],
        'workspaces': [],
        'notes': [],
        'static_v': '999',
        'user': {'id': 1, 'username': 'tinh'},
    }
    out2 = tmpl2.render(**ctx)
    print(f"  OK — {len(out2)} chars", flush=True)
except Exception as e:
    print(f"  FAIL: {e}", flush=True)
    traceback.print_exc()

print("Done.", flush=True)
