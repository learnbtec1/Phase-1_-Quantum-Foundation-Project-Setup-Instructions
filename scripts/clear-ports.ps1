# clear-ports.ps1 — IGNIS v15.5
# Kill all processes holding the dev ports (3000, 3011, 8000)
# Usage: powershell -ExecutionPolicy Bypass -File scripts\clear-ports.ps1

$ports = @(3000, 3011, 8000)

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections.OwningProcess | Sort-Object -Unique
        foreach ($pid in $pids) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Killing PID $pid ($($proc.ProcessName)) on port $port" -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
    } else {
        Write-Host "Port $port is free." -ForegroundColor Green
    }
}

Write-Host "`nAll ports cleared. You can now start the dev servers:" -ForegroundColor Cyan
Write-Host "  Backend : cd backend; .\venv311\Scripts\activate; python -m uvicorn app.main:app --reload --port 8000"
Write-Host "  Frontend: cd frontend; npm run dev -- -p 3011"
Write-Host "  E2E     : cd frontend; npx playwright test"
