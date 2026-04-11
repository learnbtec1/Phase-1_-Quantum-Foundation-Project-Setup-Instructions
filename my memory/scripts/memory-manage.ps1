param(
  [string]$MemoryRoot = "my memory",
  [int]$MaxGB = 10,
  [switch]$ReindexOnly
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $MemoryRoot)) {
  Write-Error "Memory root not found: $MemoryRoot"
  exit 1
}

$maxBytes = [int64]$MaxGB * 1GB
$allFiles = Get-ChildItem -Path $MemoryRoot -Recurse -File -ErrorAction SilentlyContinue
$totalBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }

$indexPath = Join-Path $MemoryRoot "shared\index.md"
$now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$lines = @()
$lines += "# Memory Index"
$lines += ""
$lines += "Generated: $now"
$lines += "Total size: $([Math]::Round($totalBytes / 1MB, 2)) MB"
$lines += "Cap: $MaxGB GB"
$lines += ""
$lines += "## Files"

foreach ($f in $allFiles | Sort-Object LastWriteTime -Descending) {
  $rel = $f.FullName.Substring((Resolve-Path $MemoryRoot).Path.Length).TrimStart('\\')
  $lines += "- $rel | $([Math]::Round($f.Length / 1KB,2)) KB | $($f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))"
}

$lines | Set-Content -Path $indexPath -Encoding UTF8
Write-Host "[memory] index written: $indexPath"

if ($ReindexOnly) {
  Write-Host "[memory] reindex only; no archive action"
  exit 0
}

if ($totalBytes -le $maxBytes) {
  Write-Host "[memory] size within cap: $([Math]::Round($totalBytes / 1MB,2)) MB"
  exit 0
}

$archiveDir = Join-Path $MemoryRoot "archive"
if (!(Test-Path $archiveDir)) { New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $archiveDir "memory-archive-$stamp.zip"

$targets = @(
  (Join-Path $MemoryRoot "gpt"),
  (Join-Path $MemoryRoot "sonnet"),
  (Join-Path $MemoryRoot "shared")
) | Where-Object { Test-Path $_ }

Compress-Archive -Path $targets -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Host "[memory] archived to: $zipPath"

# Keep only latest 5 archives
$archives = Get-ChildItem -Path $archiveDir -File -Filter "memory-archive-*.zip" | Sort-Object LastWriteTime -Descending
if ($archives.Count -gt 5) {
  $archives | Select-Object -Skip 5 | Remove-Item -Force
  Write-Host "[memory] old archives pruned"
}

# Optional trim: remove oldest log files if still above cap after archive
$allFiles = Get-ChildItem -Path $MemoryRoot -Recurse -File -ErrorAction SilentlyContinue
$totalBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
if (-not $totalBytes) { $totalBytes = 0 }

if ($totalBytes -gt $maxBytes) {
  $candidate = $allFiles |
    Where-Object { $_.FullName -notlike "*\\archive\\*" } |
    Sort-Object LastWriteTime

  foreach ($file in $candidate) {
    Remove-Item -Path $file.FullName -Force -ErrorAction SilentlyContinue
    $allFiles = Get-ChildItem -Path $MemoryRoot -Recurse -File -ErrorAction SilentlyContinue
    $totalBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
    if (-not $totalBytes) { $totalBytes = 0 }
    if ($totalBytes -le $maxBytes) { break }
  }

  Write-Host "[memory] size after trim: $([Math]::Round($totalBytes / 1MB,2)) MB"
}
