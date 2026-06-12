# BookWorm restart script (PowerShell version — mirrors restart.bat exactly).
# Run from the BookWorm directory:
#   powershell -ExecutionPolicy Bypass -File restart.ps1

$ErrorActionPreference = "SilentlyContinue"

Write-Host "[BookWorm] Stopping previous server instances..." -ForegroundColor Yellow

# 1. Kill ANYTHING holding port 8000 or 8001 (uvicorn, python main.py, etc.)
foreach ($port in @(8000, 8001)) {
    $pids = (netstat -ano | Select-String (":$port ")) |
            ForEach-Object { ($_ -split "\s+")[-1] } |
            Sort-Object -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
}

# 2. Belt-and-suspenders: kill BookWorm venv Python processes by command-line
Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*BookWorm\.venv*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 3. Kill orphan spawn_main workers
Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*spawn_main*" -and $_.CommandLine -like "*pipe_handle*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 4. Wait for socket to drain
Write-Host "[BookWorm] Waiting for port 8000 to clear..." -ForegroundColor Yellow
Start-Sleep -Seconds 4

# 5. Start fresh via uvicorn (NOT python main.py — that starts on port 8001 with old code)
Write-Host "[BookWorm] Starting server on http://localhost:8000 ..." -ForegroundColor Cyan
$uvicorn = Join-Path $PSScriptRoot ".venv\Scripts\uvicorn.exe"
Start-Process -FilePath $uvicorn `
              -ArgumentList "main:app --host 127.0.0.1 --port 8000" `
              -WorkingDirectory $PSScriptRoot `
              -WindowStyle Hidden

# 6. Poll /health for up to 30 s (OneDrive path can add significant I/O latency)
Write-Host "[BookWorm] Waiting for server to respond..." -ForegroundColor Yellow
$status = 0
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $status = (Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2 -EA Stop).StatusCode
        break
    } catch { $status = 0 }
}

if ($status -eq 200) {
    Write-Host "[BookWorm] UP at http://localhost:8000" -ForegroundColor Green
    Start-Process "http://localhost:8000"
} else {
    Write-Host "[BookWorm] Server may not have started (HTTP $status). Check manually." -ForegroundColor Red
}
