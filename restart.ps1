# BookWorm restart script — kills any stale server processes, then starts fresh.
# Run from the BookWorm directory: powershell -ExecutionPolicy Bypass -File restart.ps1

$venvPython = ".\.venv\Scripts\python.exe"
$port = 8001

Write-Host "Stopping any existing BookWorm processes on port $port..." -ForegroundColor Yellow

# Find and kill any python process running main.py from THIS directory
$cwd = (Get-Location).Path
Get-Process python* -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = $_
    $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
    if ($cmdLine -and $cmdLine -match "main\.py" -and $cmdLine -match [regex]::Escape($venvPython -replace '\.\\', '')) {
        Write-Host "  Killing PID $($proc.Id): $($proc.ProcessName)" -ForegroundColor Red
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

# Also kill any lingering multiprocessing children whose parent was a BookWorm server
Get-Process python* -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = $_
    $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).CommandLine
    # Identify uvicorn worker children by the multiprocessing.spawn pattern
    if ($cmdLine -and $cmdLine -match "multiprocessing.spawn") {
        # Check if this child's parent is a BookWorm-venv process
        $parentId = (Get-WmiObject Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction SilentlyContinue).ParentProcessId
        $parentCmd = (Get-WmiObject Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue).CommandLine
        if ($parentCmd -and $parentCmd -match "main\.py") {
            Write-Host "  Killing worker PID $($proc.Id)" -ForegroundColor Red
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        # Also kill orphaned workers (parent dead but worker still listening)
        elseif (-not $parentCmd) {
            $listeningPids = netstat -ano | Select-String ":$port" | ForEach-Object { ($_ -split '\s+')[-1] }
            if ($listeningPids -contains "$($proc.Id)") {
                Write-Host "  Killing orphaned worker PID $($proc.Id)" -ForegroundColor Red
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Start-Sleep -Seconds 1

# Verify port is clear
$still = netstat -ano | Select-String ":$port\s"
if ($still) {
    Write-Host "WARNING: Port $port still in use! Check manually." -ForegroundColor Magenta
    $still | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "Port $port is clear." -ForegroundColor Green
}

# Start fresh
Write-Host "`nStarting BookWorm on port $port..." -ForegroundColor Cyan
Start-Process `
    -FilePath $venvPython `
    -ArgumentList "main.py" `
    -WorkingDirectory (Get-Location).Path `
    -WindowStyle Hidden `
    -RedirectStandardOutput "bookworm_server.log" `
    -RedirectStandardError  "bookworm_server_err.log"

Start-Sleep -Seconds 4

$status = (Invoke-WebRequest -Uri "http://localhost:$port/" -UseBasicParsing -MaximumRedirection 5 -ErrorAction SilentlyContinue).StatusCode
if ($status -eq 200) {
    Write-Host "BookWorm is UP at http://localhost:$port/" -ForegroundColor Green
    Start-Process "http://localhost:$port/"
} else {
    Write-Host "BookWorm may not have started (HTTP $status). Check bookworm_server_err.log." -ForegroundColor Red
}
