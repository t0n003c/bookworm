@echo off
:: BookWorm — terminal restart (use restart.vbs for a silent double-click)
:: This opens a temporary CMD window that closes itself when done.
cd /d "%~dp0"

echo [BookWorm] Restarting...
.venv\Scripts\python.exe _start_server.py

:: Poll /health up to 30 s (OneDrive path can add significant I/O latency)
set /a BW_TRIES=0
:poll
set /a BW_TRIES+=1
if %BW_TRIES% gtr 30 goto poll_timeout
timeout /t 1 /nobreak >nul
.venv\Scripts\python.exe -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2)" >nul 2>nul
if %errorlevel%==0 goto poll_ok
goto poll

:poll_timeout
echo [BookWorm] WARNING: server did not respond within 30 s. Check server.log for errors.
goto done

:poll_ok
echo [BookWorm] Ready at http://localhost:8000
start http://localhost:8000

:done
:: Window closes automatically — no pause needed
