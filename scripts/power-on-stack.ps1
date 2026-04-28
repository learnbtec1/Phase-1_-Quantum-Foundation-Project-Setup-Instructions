# PHASE 14 — Prune dead containers, rebuild backend (edge-tts image), start full stack detached.
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\scripts\power-on-stack.ps1
# One-liner (clears console):  powershell -NoProfile -Command "Clear-Host; docker container prune -f; docker compose build --no-cache backend avatar_brain; docker compose up -d --build"
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
Clear-Host
Write-Host "PHASE 14: container prune + rebuild backend/avatar_brain + up -d --build" -ForegroundColor Cyan
Write-Host "Working directory: $Root"
docker container prune -f
if ($LASTEXITCODE -ne 0) { Write-Warning "container prune reported non-zero exit (continuing)." }
docker compose build --no-cache backend avatar_brain
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: docker compose build" -ForegroundColor Red
    exit $LASTEXITCODE
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: docker compose up" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host ""
Write-Host "Post-start TTS check (run inside backend):" -ForegroundColor Green
Write-Host '  docker exec eduverse_backend python -c "import edge_tts; print(''Audio Engine: READY'')"' -ForegroundColor Gray
