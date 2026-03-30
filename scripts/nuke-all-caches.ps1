# Run from repo root in elevated PowerShell. Destroys Docker caches + local Next artifacts.
$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "=== NUKING ALL CACHES ===" -ForegroundColor Red
docker compose down --volumes --remove-orphans
docker system prune -a -f --volumes
docker builder prune -a -f
docker volume prune -f

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "frontend\.next"
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "frontend\node_modules\.cache"

Write-Host "=== Please close all browser windows and run: chrome --user-data-dir=C:\temp\clean-profile ===" -ForegroundColor Yellow
Write-Host "=== Then open http://localhost:3000/avatar-agent and check [OFFICE] GLB load result in console ===" -ForegroundColor Green
