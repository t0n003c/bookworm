"""BookWorm health check — tests templates, filters, and live HTTP routes."""
import sys
import urllib.request
import urllib.error

print("=== BookWorm Health Check ===\n")

# ── 1. Template + filter validation ──────────────────────────────────────────
print("[1/3] Checking Jinja2 templates with registered filters...")
sys.path.insert(0, ".")
try:
    from templates_env import templates
    env = templates.env
    to_check = [
        "base.html",
        "index.html",
        "login.html",
        "register.html",
        "partials/home_page.html",
        "partials/home_page_rss.html",
        "partials/home_page_crm.html",
        "partials/home_page_uploads.html",
"partials/home_page_grid.html",
        "partials/home_sidebar.html",
        "partials/note_form.html",
        "partials/sidebar_workspace_list.html",
    ]
    all_ok = True
    for t in to_check:
        try:
            env.get_template(t)
            print(f"  ✓  {t}")
        except Exception as e:
            print(f"  ✗  {t}: {e}")
            all_ok = False
    print("  → All templates OK!\n" if all_ok else "  → SOME TEMPLATES FAILED!\n")
except Exception as e:
    print(f"  ✗  Could not load templates_env: {e}\n")

# ── 2. Registered filter list ─────────────────────────────────────────────────
print("[2/3] Registered Jinja2 filters...")
try:
    from templates_env import templates
    custom = [k for k in templates.env.filters if k not in ("abs","attr","batch","capitalize",
        "center","count","d","default","dictsort","e","escape","filesizeformat","first","float",
        "forceescape","format","groupby","indent","int","items","join","last","length","list",
        "lower","map","max","min","pprint","random","reject","rejectattr","replace","reverse",
        "round","safe","select","selectattr","slice","sort","string","striptags","sum","title",
        "tojson","trim","truncate","unique","upper","urlencode","urlize","wordcount","wordwrap","xmlattr")]
    for f in sorted(custom):
        print(f"  • {f}")
    print()
except Exception as e:
    print(f"  ✗  {e}\n")

# ── 3. Live HTTP smoke test ───────────────────────────────────────────────────
print("[3/3] Live HTTP routes (port 8000)...")
routes = [
    ("/login",    [200]),
    ("/register", [200]),
    ("/",         [200, 302, 307]),
]
for path, expected in routes:
    url = f"http://127.0.0.1:8000{path}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:
        print(f"  ✗  {path}: {e}")
        continue
    mark = "✓" if code in expected else "✗"
    print(f"  {mark}  {path} → HTTP {code}")

print("\n=== Done ===")
