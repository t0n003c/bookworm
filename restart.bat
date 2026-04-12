@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: BookWorm — clean restart script
:: Kills ALL previous server instances (including orphan spawn workers and
:: any rogue "python main.py" processes on port 8001), waits for port 8000
:: to drain, then starts a single stable server.
:: Usage:  double-click  OR  run in a terminal
:: ─────────────────────────────────────────────────────────────────────────────
echo [BookWorm] Stopping previous server instances...

:: 1. Kill ANYTHING holding port 8000 or 8001 (uvicorn, python main.py, etc.)
::    This is the most reliable approach — catches every startup style.
for %%P in (8000 8001) do (
  for /f "tokens=5" %%i in ('netstat -ano 2^>nul ^| findstr ":%%P "') do (
    taskkill /PID %%i /F >nul 2>nul
  )
)

:: 2. Belt-and-suspenders: kill BookWorm venv Python processes by command-line
::    NOTE: single backslash in PowerShell -like is literal (no escaping).
::    The old double-backslash pattern (*BookWorm\\.venv*) never matched — fixed.
powershell -Command ^
  "Get-CimInstance Win32_Process ^
   | Where-Object {$_.CommandLine -like '*BookWorm\.venv*'} ^
   | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>nul

:: 3. Kill orphan spawn_main workers that may have inherited the socket
powershell -Command ^
  "Get-CimInstance Win32_Process ^
   | Where-Object {$_.CommandLine -like '*spawn_main*' -and $_.CommandLine -like '*pipe_handle*'} ^
   | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>nul

:: 4. Give OS time to release the port socket
echo [BookWorm] Waiting for port 8000 to clear...
timeout /t 4 /nobreak >nul

:: 5. Start fresh — single process, no reload (no zombie accumulation)
echo [BookWorm] Starting server on http://localhost:8000 ...
cd /d "%~dp0"
start "BookWorm Server" /B .venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000

:: 6. Wait for startup and open browser
timeout /t 3 /nobreak >nul
start http://localhost:8000

echo [BookWorm] Done! Server running at http://localhost:8000
echo            Close this window to keep the server running.
echo            Run restart.bat again to restart cleanly.
pause
