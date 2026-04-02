"""Render templates to catch Jinja2 errors."""
import asyncio
import traceback
from datetime import date
from jinja2 import Environment, FileSystemLoader

env = Environment(loader=FileSystemLoader('templates'))

ctx = {
    'notes': [],
    'categories': [{'id': 1, 'name': 'Team Meeting', 'color': '#0053e2', 'description': '', 'created_at': '2025-01-01'}],
    'attr_defs': [{'id': 1, 'name': 'Project', 'field_type': 'text', 'options': None}],
    'today': date.today().isoformat(),
    'request': {},
}

templates_to_test = [
    ('index.html', ctx),
    ('partials/note_list.html', {'notes': []}),
    ('partials/note_form.html', {'note': None, 'categories': ctx['categories'], 'attr_defs': ctx['attr_defs'], 'today': ctx['today']}),
    ('partials/category_list.html', {'categories': ctx['categories']}),
    ('partials/attr_def_list.html', {'attr_defs': ctx['attr_defs']}),
]

for name, context in templates_to_test:
    try:
        tmpl = env.get_template(name)
        out = tmpl.render(**context)
        print(f'[OK] {name} ({len(out)} chars)')
    except Exception:
        print(f'[FAIL] {name}')
        traceback.print_exc()
