"""Live check: fetch all home pages and inspect the evt-json blob."""
import urllib.request
import json
import sys

base = "http://localhost:8000"

# First, check home pages listing to find which page IDs exist
try:
    r = urllib.request.urlopen(f"{base}/home/pages", timeout=5)
    listing = r.read().decode()
    print(f"[home/pages] HTTP {r.status} — len={len(listing)}")
    # Look for page IDs in the response
    import re
    page_ids = re.findall(r'data-page-id="(\d+)"', listing)
    print(f"Page IDs found: {page_ids or '(none — try direct page URLs)'}")
except Exception as e:
    print(f"[home/pages] FAIL: {e}")
    page_ids = []

if not page_ids:
    page_ids = [str(i) for i in range(1, 6)]

print()
for pid in page_ids:
    try:
        r = urllib.request.urlopen(f"{base}/home/pages/{pid}", timeout=5)
        body = r.read().decode()
        has_evt = "evt-json" in body
        has_entities = "&quot;" in body
        if not has_evt:
            print(f"Page {pid}: HTTP {r.status} — no event widget")
            continue
        # Extract the JSON blob
        m = re.search(r'id="evt-json-(\d+)"[^>]*>([^<]*)<', body)
        if m:
            wid = m.group(1)
            raw = m.group(2).strip()
            print(f"Page {pid}: HTTP {r.status} — evt-json-{wid}: {raw[:200] or '(empty)'}")
            if "&quot;" in raw:
                print(f"  ❌ PROBLEM: HTML entities found! JSON.parse() will return []")
            else:
                print(f"  ✅ JSON is clean (no &quot; entities)")
                try:
                    parsed = json.loads(raw)
                    print(f"  ✅ Parsed OK — {len(parsed)} event(s): {parsed}")
                except Exception as je:
                    print(f"  ❌ JSON.parse would fail: {je}")
        else:
            print(f"Page {pid}: HTTP {r.status} — has evt-json tag but regex missed it")
    except Exception as e:
        print(f"Page {pid}: FAIL — {e}")
