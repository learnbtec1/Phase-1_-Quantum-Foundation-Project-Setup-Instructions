$ErrorActionPreference = 'Stop'
$b = @{
    text        = 'مرحباً يا صديقي هذا اختبار للمخزن'
    voice       = 'ar-SA-HamedNeural'
    language    = 'ar-SA'
    format      = 'wav'
    sample_rate = 24000
    with_timing = $true
} | ConvertTo-Json -Compress -Depth 4

Write-Host '--- Sending TTS request ---'
try {
    $r = Invoke-RestMethod -Method POST `
        -Uri 'http://127.0.0.1:8000/api/v1/tts-with-timing' `
        -ContentType 'application/json; charset=utf-8' `
        -Body $b `
        -TimeoutSec 45
    Write-Host ("TTS_OK  provider=" + $r.provider + "  format=" + $r.format + "  timing_mode=" + $r.timing_mode + "  words=" + $r.word_timings.Count + "  visemes=" + $r.viseme_events.Count)
} catch {
    Write-Host ("TTS_FAIL: " + $_.Exception.Message)
    exit 1
}

Write-Host '--- Waiting 3s for BackgroundTask to flush ---'
Start-Sleep 3
Write-Host ''

$today = (Get-Date -Format 'yyyy-MM-dd')
$base  = 'E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend'
$jsonl = Join-Path $base "data\store\$today.jsonl"
$index = Join-Path $base "data\store\$today.index.json"
$audio = Join-Path $base "data\audio\$today"

Write-Host '--- Disk check ---'
if (Test-Path $jsonl) {
    $lines = @(Get-Content $jsonl -Encoding UTF8)
    Write-Host ("JSONL   EXISTS   lines=" + $lines.Count)
    Write-Host ("JSONL_LAST: " + $lines[-1])
} else { Write-Host 'JSONL   MISSING!' }

if (Test-Path $index) {
    $sz = (Get-Item $index).Length
    Write-Host ("INDEX   EXISTS   bytes=" + $sz)
} else { Write-Host 'INDEX   MISSING!' }

if (Test-Path $audio) {
    $wavs = @(Get-ChildItem $audio -Filter '*.wav' -ErrorAction SilentlyContinue)
    Write-Host ("AUDIO   EXISTS   wav_files=" + $wavs.Count)
    if ($wavs.Count -gt 0) {
        $last = $wavs | Sort-Object LastWriteTime | Select-Object -Last 1
        Write-Host ("AUDIO_SAMPLE: " + $last.Name + "  size=" + $last.Length + "B")
    }
} else { Write-Host 'AUDIO   MISSING!' }
