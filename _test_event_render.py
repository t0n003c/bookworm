"""
End-to-end render test: verifies the event widget's JSON blob
in home_page.html is not HTML-entity-escaped (&quot;) and parses cleanly.
"""
import asyncio, sys, re, json as _json

sys.path.insert(0, '.')


async def main():
    from database import init_db
    from routers.home_db import get_home_page, get_widgets
    from routers.notes_db import search_notes
    from templates_env import _jinja_env as jenv

    await init_db()

    page    = await get_home_page(1, 1)
    widgets = await get_widgets(1)
    notes   = await search_notes(1)

    # Use Jinja2 env directly — no HTTP scope needed
    tmpl = jenv.get_template("partials/home_page.html")
    body = tmpl.render(page=page, widgets=widgets, all_notes=notes)

    # ── 1. Presence of evt-json-33 ────────────────────────────────────────────
    idx = body.find("evt-json-33")
    if idx < 0:
        print("FAIL ❌  evt-json-33 NOT found in rendered HTML")
        sys.exit(1)

    print("Rendered snippet (first 300 chars from match):")
    print(body[idx: idx + 300])
    print()

    # ── 2. JSON content — use full body for regex ─────────────────────────────
    m = re.search(r'id="evt-json-33"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        print("FAIL ❌  Could not extract JSON content from script tag")
        sys.exit(1)

    json_text = m.group(1).strip()

    if "&quot;" in json_text:
        print("FAIL ❌  &quot; entities detected — | safe is missing!")
        sys.exit(1)
    print("PASS ✅  No &quot; entities in JSON blob")

    # ── 3. JSON parses cleanly ────────────────────────────────────────────────
    try:
        parsed = _json.loads(json_text)
        print(f"PASS ✅  JSON parses OK — {len(parsed)} item(s): {[i.get('text') for i in parsed]}")
    except Exception as e:
        print(f"FAIL ❌  JSON.parse would fail: {e}")
        sys.exit(1)

    print()
    print("All checks passed! 🎉")


asyncio.run(main())
