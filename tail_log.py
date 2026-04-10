import os, glob
cwd = os.getcwd()
logs = glob.glob('*.log')
print('CWD:', cwd)
print('Logs found:', logs)
for f in logs:
    sz = os.path.getsize(f)
    print(f'  {f}: {sz} bytes')
    if sz > 0:
        lines = open(f, encoding='utf-8', errors='replace').readlines()
        print('  Last 30 lines:')
        for l in lines[-30:]:
            print('   ', l.rstrip())
