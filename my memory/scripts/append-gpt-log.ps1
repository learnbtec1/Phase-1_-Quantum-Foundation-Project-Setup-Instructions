$root = "my memory"
$gpt = Join-Path $root "gpt\GPT-0001.md"
$now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$entry = @"

## [$now] System Memory Initialized
- Created shared memory structure (gpt/sonnet/shared/scripts/archive).
- Added hard-cap management script (10 GB) with index + archive.
- Added Sonnet execution template requiring read-before-write and append-only logs.
- Imported latest diagnostic context (FULL SYSTEM REVERSE ENGINEERING REPORT priorities #1/#2).

### Active Engineering Focus
1) Keep avatar visible stability (no black screen regressions).
2) Safe VRMA enablement path.
3) Full intensity/mood connectivity through all gesture paths.
4) Prepare speech word-boundary bridge (next phase).
"@

Add-Content -Path $gpt -Value $entry -Encoding UTF8
Write-Host "gpt log appended"

powershell -ExecutionPolicy Bypass -File "my memory/scripts/memory-manage.ps1" -MaxGB 10
