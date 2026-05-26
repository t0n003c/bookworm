"""
download_vendors.py — vendor the 5 CDN scripts into static/vendor/

Uses the Windows system proxy (WPAD / registry) automatically via urllib.
Run once; idempotent (skips already-downloaded files).
"""
import urllib.request
import os
import sys

VENDOR_DIR = os.path.join(os.path.dirname(__file__), "static", "vendor")

FILES = [
    ("htmx.min.js",            "https://unpkg.com/htmx.org@1.9.12/dist/htmx.min.js"),
    ("marked.min.js",          "https://cdn.jsdelivr.net/npm/marked/marked.min.js"),
    ("purify.min.js",          "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"),
    ("turndown.js",            "https://unpkg.com/turndown/dist/turndown.js"),
    ("turndown-plugin-gfm.js", "https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js"),
]

def main():
    # On Windows, urllib.request.getproxies() reads from the registry / env vars.
    # This picks up the same proxy the browser uses automatically.
    proxies = urllib.request.getproxies()
    print("Proxy settings:", proxies, flush=True)

    handlers = []
    if proxies:
        handlers.append(urllib.request.ProxyHandler(proxies))
    else:
        # Fallback: try the known Walmart proxy explicitly
        handlers.append(urllib.request.ProxyHandler({
            "http":  "http://proxy.wal-mart.com:8080",
            "https": "http://proxy.wal-mart.com:8080",
        }))

    opener = urllib.request.build_opener(*handlers)

    for name, url in FILES:
        out = os.path.join(VENDOR_DIR, name)
        if os.path.exists(out) and os.path.getsize(out) > 1000:
            print(f"SKIP (exists): {name}", flush=True)
            continue
        print(f"Downloading {name} ...", flush=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with opener.open(req, timeout=30) as r:
                data = r.read()
            with open(out, "wb") as f:
                f.write(data)
            print(f"  OK  {name} — {len(data):,} bytes", flush=True)
        except Exception as ex:
            print(f"  FAIL {name}: {ex}", flush=True)

    print("Done.", flush=True)

if __name__ == "__main__":
    main()
