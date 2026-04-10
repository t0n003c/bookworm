import sys

lines = open('templates/partials/note_form.html', encoding='utf-8').readlines()
in_script = False
script_depth = 0
found = []

for i, ln in enumerate(lines, 1):
    if '<script' in ln and 'src=' not in ln:
        in_script = True
        script_depth = 0
        continue
    if '</script>' in ln:
        in_script = False
        continue

    if not in_script:
        continue

    stripped = ln.strip()

    # Track function/IIFE depth roughly by counting opens vs closes
    script_depth += ln.count('{') - ln.count('}')

    # Top-level const/let = depth close to 0 (allow small variance for template indent)
    if stripped.startswith(('const ', 'let ')):
        indent = len(ln) - len(ln.lstrip())
        found.append((i, indent, script_depth - (ln.count('{') - ln.count('}')), stripped[:80]))

print(f"Found {len(found)} const/let lines inside <script> blocks:\n")
for lineno, indent, depth, text in found:
    print(f"  L{lineno:4d}  indent={indent:2d}  depth={depth:3d}  {text}")
