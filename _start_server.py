"""Launch uvicorn as a fully detached, windowless background process.

Usage:
    .venv\\Scripts\\python.exe _start_server.py

Returns immediately. Uvicorn keeps running silently — no CMD window
appears, no terminal stays open, Code Puppy sessions never block.
Logs go to server.log in this directory.

Windows flags used:
    DETACHED_PROCESS (0x08)  — process is not attached to parent's console
    CREATE_NO_WINDOW (0x08000000) — no console window is created at all
"""
import subprocess, os, sys

HERE    = os.path.dirname(os.path.abspath(__file__))
UVICORN = os.path.join(HERE, ".venv", "Scripts", "uvicorn.exe")
LOG     = os.path.join(HERE, "server.log")

DETACHED_PROCESS = 0x00000008
CREATE_NO_WINDOW = 0x08000000

if not os.path.exists(UVICORN):
    print(f"ERROR: uvicorn not found at {UVICORN}", file=sys.stderr)
    sys.exit(1)

with open(LOG, "w") as log_fh:
    proc = subprocess.Popen(
        [UVICORN, "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=HERE,
        stdout=log_fh,
        stderr=log_fh,
        creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW,
    )

print(f"[BookWorm] Server started — PID {proc.pid}")
print(f"[BookWorm] Logs  → {LOG}")
print(f"[BookWorm] URL   → http://localhost:8000")
