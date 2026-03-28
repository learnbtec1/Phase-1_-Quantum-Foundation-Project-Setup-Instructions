param()
Set-StrictMode -Off
$ErrorActionPreference = 'Continue'
# Docker يكتب التقدم إلى stderr؛ في PowerShell 7+ يُعرَض ذلك كأخطاء وهمية
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $false
}

Write-Host "==== NEXUS Stack Launcher ===="
Write-Host ("Time: {0:s}" -f (Get-Date))

# Use API version that works with this engine
$env:DOCKER_API_VERSION = "1.44"
Write-Host "DOCKER_API_VERSION set to 1.44"

# Verify engine responds (quick check)
$j = Start-Job { $env:DOCKER_API_VERSION = "1.44"; docker ps 2>&1 }
$ok = Wait-Job $j -Timeout 15
if (-not $ok) {
    Remove-Job $j -Force
    Write-Host "FAIL: docker ps timed out. Engine not responding." -ForegroundColor Red
    exit 1
}
$psOut = Receive-Job $j
Write-Host "docker ps OK. Running containers:"
Write-Host ($psOut | Out-String)

# Remove conflicting containers
Write-Host "Removing existing nexus containers..."
$env:DOCKER_API_VERSION = "1.44"
docker rm -f nexus_db        2>&1 | Out-Null
docker rm -f nexus_backend   2>&1 | Out-Null
docker rm -f nexus_frontend  2>&1 | Out-Null
Write-Host "Done."

# Navigate to project root
$root = "E:\Phase 1_ Quantum Foundation Project Setup Instructions"
Set-Location -LiteralPath $root
Write-Host "Working dir: $PWD"

# Compose down first
Write-Host "Running compose down..."
$env:DOCKER_API_VERSION = "1.44"
docker compose -f ".\docker-compose.yml" down --remove-orphans

# Compose up
Write-Host "Running compose up -d --build..."
$env:DOCKER_API_VERSION = "1.44"
docker compose -f ".\docker-compose.yml" up -d --build
$cExit = $LASTEXITCODE
Write-Host "Compose exit code: $cExit"

if ($cExit -ne 0) {
    Write-Host "FAIL: compose up failed." -ForegroundColor Red
    docker compose -f ".\docker-compose.yml" logs --tail=50
    exit 1
}

Write-Host "Waiting 15s for services to be ready..."
Start-Sleep -Seconds 15

Write-Host "Container status:"
$env:DOCKER_API_VERSION = "1.44"
docker compose -f ".\docker-compose.yml" ps

Write-Host ""
Write-Host "==== API Checks ===="
$BASE = "http://127.0.0.1:8000"

# Health check
$h = $null
try {
    $h = Invoke-RestMethod -Method GET -Uri "$BASE/api/health" -TimeoutSec 20
    Write-Host ("Health: ok={0} env={1} reach={2} audio={3}" -f $h.ok, $h.env, $h.reach, $h.audio)
} catch {
    Write-Host "Health error: $_"
}

# OpenAPI
$o = $null
try {
    $o = Invoke-RestMethod -Method GET -Uri "$BASE/openapi.json" -TimeoutSec 10
    $paths = ($o.paths.psobject.Properties | Measure-Object).Count
    Write-Host "OpenAPI: $paths paths"
} catch {
    Write-Host "OpenAPI error: $_"
}

# TTS (Arabic via Unicode escapes)
$ttsBody = '{"text":"\u0645\u0631\u062d\u0628\u0627! \u0647\u0630\u0627 \u0627\u062e\u062a\u0628\u0627\u0631.","voice":"ar-SA-HamedNeural","language":"ar-SA","format":"wav","sample_rate":24000,"with_timing":true}'
$ttsR = $null
try {
    $ttsR = Invoke-RestMethod -Method POST -Uri "$BASE/api/v1/tts-with-timing" `
        -ContentType "application/json; charset=utf-8" `
        -Body $ttsBody -TimeoutSec 30
    Write-Host ("TTS: format={0} sr={1} visemes={2} words={3}" -f `
        $ttsR.format, $ttsR.sample_rate,
        $(if ($ttsR.viseme_events) { $ttsR.viseme_events.Count } else { 0 }),
        $(if ($ttsR.word_timings)  { $ttsR.word_timings.Count }  else { 0 }))
} catch {
    Write-Host "TTS error: $_"
}

Write-Host ""
Write-Host "==== RESULT ===="
$healthOk = ($h.ok -eq $true)
$envOk    = ($h.env -eq $true)
$ttsOk    = ($null -ne $ttsR)

if ($healthOk -and $envOk -and $ttsOk) {
    Write-Host "PASS: Engine stable, health OK, TTS OK." -ForegroundColor Green
} else {
    Write-Host "PARTIAL or FAIL:" -ForegroundColor Yellow
    Write-Host ("  health.ok={0} health.env={1} tts={2}" -f $healthOk, $envOk, $ttsOk)
    if (-not $envOk) {
        Write-Host "  Hint: check backend/.env has OPENAI_API_KEY, AZURE_SPEECH_KEY, etc."
    }
    if (-not $ttsOk) {
        Write-Host "  Hint: check docker compose logs -f backend for TTS startup errors."
    }
    docker compose -f ".\docker-compose.yml" logs --tail=30
}
