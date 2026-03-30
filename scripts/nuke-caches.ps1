# Nuclear cache clean — run from repo root in elevated PowerShell when Docker + Next caches must be obliterated.
$ErrorActionPreference = "Continue"
$frontend = Join-Path $PSScriptRoot "..\frontend" | Resolve-Path

Write-Host "== Local frontend artifacts ==" -ForegroundColor Cyan
@(".next", "node_modules\.cache", ".turbo") | ForEach-Object {
  $p = Join-Path $frontend $_
  if (Test-Path $p) { Remove-Item -Recurse -Force $p; Write-Host "Removed $p" } else { Write-Host "Skip: $p" }
}

Write-Host "`n== Docker (run manually if needed) ==" -ForegroundColor Yellow
Write-Host @'
docker compose down --volumes --remove-orphans
docker system prune -a -f --volumes
docker volume prune -f
docker builder prune -a -f
docker compose build --no-cache frontend
docker compose up -d --force-recreate
'@

Write-Host "`nDone local deletes. Test in a fresh Chrome profile:" -ForegroundColor Green
Write-Host '  chrome --user-data-dir=C:\temp\fresh-chrome  http://localhost:3000/avatar-agent'
