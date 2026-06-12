"""BookWorm silent server launcher.

Kills anything on port 8000, then starts uvicorn with NO console
window and its own process group (closing any parent window cannot
kill it).

Usage:
    .venv\\Scripts\\pythonw.exe _start_server.py   ← silent (no window)
    .venv\\Scripts\\python.exe  _start_server.py   ← shows output in terminal

Key Windows detail
------------------
CREATE_NO_WINDOW is silently *ignored* when combined with
DETACHED_PROCESS (per MS docs). The reliable fix is STARTUPINFO with
STARTF_USESHOWWINDOW + SW_HIDE — this forces the child's window hidden
at the Win32 layer, before the process can show anything.
"""
import subprocess, os, sys, time

HERE    = os.path.dirname(os.path.abspath(__file__))
UVICORN = os.path.join(HERE, ".venv", "Scripts", "uvicorn.exe")
LOG     = os.path.join(HERE, "server.log")

CREATE_NEW_PROCESS_GROUP = 0x00000200


def _log(msg):
    """Safe print — pythonw.exe has no stdout; swallow quietly."""
    try:
        print(msg, flush=True)
    except Exception:
        pass


# ── 1. Kill anything on port 8000 ─────────────────────────────────────────
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

time.sleep(2)

# ── 2. Sanity-check ────────────────────────────────────────────────────────
if not os.path.exists(UVICORN):
    _log(f"[BookWorm] ERROR: uvicorn not found at {UVICORN}")
    sys.exit(1)

# ── 3. Build STARTUPINFO — hides the console window at the Win32 layer ────
si = subprocess.STARTUPINFO()
si.dwFlags  = subprocess.STARTF_USESHOWWINDOW
si.wShowWindow = 0  # SW_HIDE

# ── 4. Launch uvicorn — hidden window, own process group ──────────────────
_log("[BookWorm] Starting server...")
with open(LOG, "w") as log_fh:
    proc = subprocess.Popen(
        [UVICORN, "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=HERE,
        stdout=log_fh,
        stderr=log_fh,
        stdin=subprocess.DEVNULL,
        startupinfo=si,
        creationflags=CREATE_NEW_PROCESS_GROUP,
    )

_log(f"[BookWorm] Server started — PID {proc.pid}")
_log(f"[BookWorm] Logs  → {LOG}")
_log(f"[BookWorm] URL   → http://localhost:8000")
