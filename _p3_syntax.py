import ast, pathlib, sys
files = [
    'routers/auth_db.py',
    'routers/account.py',
    'routers/search_qa.py',
    'search_llm.py',
]
ok = True
for f in files:
    try:
        ast.parse(pathlib.Path(f).read_text(encoding='utf-8'))
        print('OK:', f)
    except SyntaxError as e:
        print('FAIL:', f, e)
        ok = False
sys.exit(0 if ok else 1)
