@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: BookWorm — clean restart
:: Double-click this to restart the server at any time.
::
:: The server runs as a HIDDEN background process — no CMD window pops up.
:: Logs are written to server.log in this folder.
:: ─────────────────────────────────────────────────────────────────────────────
cd /d "%~dp0"

echo [BookWorm] Stopping any running server...

:: Kill anything on port 8000 by PID
for /f "tokens=5" %%i in ('netstat -ano 2^>nul ^| findstr ":8000 "') do (
    taskkill /PID %%i /F >nul 2>nul
)

:: Belt-and-suspenders: kill BookWorm venv python processes
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -like '*BookWorm*venv*'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

:: Give the OS a moment to release the port
timeout /t 3 /nobreak >nul

:: ── Start the server (no window, fully detached via _start_server.py) ─────────
echo [BookWorm] Starting server...
.venv\Scripts\python.exe _start_server.py
if errorlevel 1 (
    echo [BookWorm] ERROR: failed to launch. Check _start_server.py and .venv.
    pause
    exit /b 1
)

:: ── Poll /health up to 15 times (1 s apart) ──────────────────────────────────
echo [BookWorm] Waiting for server to be ready...
set /a BW_TRIES=0

:poll
set /a BW_TRIES+=1
if %BW_TRIES% gtr 15 goto poll_timeout
timeout /t 1 /nobreak >nul
.venv\Scripts\python.exe -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)" >nul 2>nul
if %errorlevel%==0 goto poll_ok
goto poll

:poll_timeout
echo [BookWorm] WARNING: health check timed out — check server.log for errors.
goto open

:poll_ok
echo [BookWorm] Server is ready!

:open
start http://localhost:8000
echo.
echo  BookWorm running at http://localhost:8000
echo  Logs: %~dp0server.log
echo.
echo  Run restart.bat again at any time to restart cleanly.
pause
