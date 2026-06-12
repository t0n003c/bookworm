"""Quick syntax audit — run from the BookWorm directory."""
import ast, os

errors = []
py_files = []
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in ("__pycache__", ".venv", "node_modules")]
    for f in files:
        if f.endswith(".py"):
            py_files.append(os.path.join(root, f))

for path in sorted(py_files):
    try:
        ast.parse(open(path, encoding="utf-8").read())
    except SyntaxError as e:
        errors.append(f"SYNTAX  {path}:{e.lineno}: {e.msg}")
    except Exception as e:
        errors.append(f"READ    {path}: {e}")

if errors:
    print(f"FAIL — {len(errors)} error(s)")
    for e in errors:
        print(" ", e)
else:
    print(f"OK — {len(py_files)} .py files, zero syntax errors")
