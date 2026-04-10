import sys
sys.path.insert(0, '.')
from templates_env import templates
env = templates.env
from routers.home_db import get_widgets
import asyncio

async def test():
    widgets = await get_widgets(1)
    print(f'Got {len(widgets)} widgets for page 1')
    page = {'id':1,'name':'Test','emoji':'🏠','config':{}, 'sort_order':1, 'user_id':1, 'created_at':'2026-01-01', 'config_json':'{}'}
    tmpl = env.get_template('partials/home_page.html')
    result = tmpl.render(page=page, widgets=widgets, all_notes=[])
    print(f'Render SUCCESS, length={len(result)} chars')
    # Show any error messages in the output
    if 'Error' in result or 'error' in result.lower():
        import re
        for m in re.finditer(r'.{0,50}[Ee]rror.{0,50}', result):
            print('  Found error context:', m.group())

asyncio.run(test())
