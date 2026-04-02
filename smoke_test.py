"""Quick smoke test to catch startup errors."""
import asyncio
import traceback

async def run():
    try:
        from database import init_db
        await init_db()
        print("[OK] DB init")

        from routers.categories_db import get_all_categories
        cats = await get_all_categories()
        print(f"[OK] Categories: {len(cats)}")

        from routers.notes_db import search_notes
        notes = await search_notes()
        print(f"[OK] Notes: {len(notes)}")

        print("All checks passed!")
    except Exception:
        traceback.print_exc()

asyncio.run(run())
