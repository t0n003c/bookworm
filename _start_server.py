"""BookWorm silent server launcher.

- Kills any existing process on port 8000
- Starts uvicorn with NO console window and completely detached from
  whatever called this script (no shared process group)
- Returns immediately; uvicorn keeps running in the background

Run via:
    .venv\\Scripts\\pythonw.exe _start_server.py   ← silent (no window)
    .venv\\Scripts\\python.exe  _start_server.py   ← shows output in terminal

Windows flags:
    DETACHED_PROCESS       (0x00000008) — not attached to caller's console
    CREATE_NO_WINDOW       (0x08000000) — no console window is created
    CREATE_NEW_PROCESS_GROUP (0x00000200) — new group, immune to parent Ctrl+C / close
"""
import subprocess, os, sys, time

HERE    = os.path.dirname(os.path.abspath(__file__))
UVICORN = os.path.join(HERE, ".venv", "Scripts", "uvicorn.exe")
LOG     = os.path.join(HERE, "server.log")

DETACHED_PROCESS         = 0x00000008
CREATE_NO_WINDOW         = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200

def _log(msg):
    """Safe print — pythonw.exe has no stdout; swallow quietly."""
    try:
        print(msg, flush=True)
    except Exception:
        pass

# ── 1. Kill anything currently on port 8000 ───────────────────────────────
_log("[BookWorm] Stopping any running server...")
try:
    result = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, timeout=5
    )
    for line in result.stdout.splitlines():
        if ":8000 " in line and "LISTEN" in line:
            pid = line.strip().split()[-1]
            subprocess.run(
                ["taskkill", "/PID", pid, "/F"],
                capture_output=True, timeout=3
            )
            _log(f"[BookWorm] Killed PID {pid}")
except Exception:
    pass  # best-effort; port may already be free

time.sleep(2)  # let the OS fully release the port

# ── 2. Sanity-check ────────────────────────────────────────────────────────
if not os.path.exists(UVICORN):
    _log(f"[BookWorm] ERROR: uvicorn not found at {UVICORN}")
    _log("[BookWorm] Make sure the .venv is set up correctly.")
    sys.exit(1)

# ── 3. Launch uvicorn — no window, fully detached, new process group ──────
_log("[BookWorm] Starting server...")
with open(LOG, "w") as log_fh:
    proc = subprocess.Popen(
        [UVICORN, "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=HERE,
        stdout=log_fh,
        stderr=log_fh,
        creationflags=(
            DETACHED_PROCESS
            | CREATE_NO_WINDOW
            | CREATE_NEW_PROCESS_GROUP
        ),
    )

_log(f"[BookWorm] Server started — PID {proc.pid}")
_log(f"[BookWorm] Logs  → {LOG}")
_log(f"[BookWorm] URL   → http://localhost:8000")
