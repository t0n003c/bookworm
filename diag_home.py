"""Diagnostic: simulate the home_page_view route end-to-end.
Run with:  .venv\Scripts\python.exe diag_home.py
"""
import asyncio, sys, traceback, json
sys.path.insert(0, '.')

async def main():
    from database import init_db
    await init_db()

    from routers.home_db import get_home_pages, get_home_page, get_widgets
    from routers.workspaces_db import get_all_workspaces
    from routers.notes_db import search_notes
    from templates_env import templates

    USER_ID = 1  # adjust if your user is different

    # 1. Get pages
    pages = await get_home_pages(USER_ID)
    print(f"[1] Pages for uid={USER_ID}: {len(pages)}")
    for p in pages:
        print(f"     id={p['id']} name={p['name']!r} emoji={p.get('emoji','')!r}")

    if not pages:
        print("ERROR: no pages found — nothing to test"); return

    # 2. Try each page
    for p in pages:
        pid = p['id']
        print(f"\n[2] Testing page_id={pid} ...")

        try:
            page = await get_home_page(pid, USER_ID)
            print(f"    get_home_page OK: {page['name']!r}")
        except Exception:
            print(f"    get_home_page FAILED:\n{traceback.format_exc()}"); continue

        try:
            widgets = await get_widgets(pid)
            print(f"    get_widgets OK: {len(widgets)} widgets")
            for w in widgets:
                print(f"      wid={w['id']} type={w['widget_type']} style={w['style']}")
        except Exception:
            print(f"    get_widgets FAILED:\n{traceback.format_exc()}"); continue

        try:
            workspaces = await get_all_workspaces(USER_ID)
            ws_ids = [w['id'] for w in workspaces]
            print(f"    workspaces: {ws_ids}")
            all_notes = (await search_notes(workspace_ids=ws_ids))[:50] if ws_ids else []
            print(f"    all_notes OK: {len(all_notes)} notes")
        except Exception:
            print(f"    _user_notes FAILED:\n{traceback.format_exc()}"); continue

        try:
            tpl = templates.env.get_template('partials/home_page.html')
            html = tpl.render(page=page, widgets=widgets, all_notes=all_notes)
            print(f"    render OK: {len(html)} chars")
        except Exception:
            print(f"    render FAILED:\n{traceback.format_exc()}"); continue

        try:
            notes_json = json.dumps(all_notes, default=str)
            print(f"    tojson OK: {len(notes_json)} chars")
        except Exception:
            print(f"    tojson FAILED:\n{traceback.format_exc()}")

    print("\n[done]")

asyncio.run(main())
