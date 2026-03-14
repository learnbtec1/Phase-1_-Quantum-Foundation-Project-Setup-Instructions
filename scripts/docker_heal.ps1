param()
Set-StrictMode -Off
$ErrorActionPreference = 'SilentlyContinue'

Write-Host ""
Write-Host "==== PHASE A: Soft Engine Rehab ===="
Write-Host ("Time: {0:s}" -f (Get-Date))

[Environment]::SetEnvironmentVariable('DOCKER_API_VERSION', $null, 'Process')
[Environment]::SetEnvironmentVariable('DOCKER_API_VERSION', $null, 'User')
[Environment]::SetEnvironmentVariable('DOCKER_API_VERSION', $null, 'Machine')
Remove-Item Env:DOCKER_API_VERSION -ErrorAction SilentlyContinue
Write-Host "DOCKER_API_VERSION cleared."

Write-Host "Shutting down WSL..."
wsl --shutdown 2>&1 | Out-Null
Start-Sleep -Seconds 3

Write-Host "Stopping Docker Desktop processes..."
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4

$dockerExe = "C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
}
Write-Host "Starting Docker Desktop: $dockerExe"
Start-Process $dockerExe
Write-Host "Waiting 40s for engine..."
Start-Sleep -Seconds 40

docker context use desktop-linux 2>&1 | Out-Null
Write-Host "Context: $(docker context show 2>&1)"

$engineOk = $false
$tries = 0
while ($tries -lt 25) {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $engineOk = $true; break }
    Write-Host ("  attempt {0} - not ready, waiting 3s..." -f $tries)
    Start-Sleep -Seconds 3
    $tries++
}

if (-not $engineOk) {
    Write-Host "Trying with DOCKER_API_VERSION=1.46..."
    $env:DOCKER_API_VERSION = "1.46"
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $engineOk = $true
        Write-Host "Engine OK with DOCKER_API_VERSION=1.46"
    }
}

if (-not $engineOk) {
    Write-Host ""
    Write-Host "==== PHASE B: Deep Reset ===="
    $env:DOCKER_API_VERSION = $null
    wsl --shutdown 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "WSL distros:"
    wsl -l -v 2>&1
    wsl --unregister docker-desktop      2>&1 | Out-Null
    wsl --unregister docker-desktop-data 2>&1 | Out-Null
    Write-Host "Unregistered docker-desktop WSL distros. Starting Docker Desktop..."
    Start-Process $dockerExe
    Write-Host "Waiting 50s..."
    Start-Sleep -Seconds 50
    docker context use desktop-linux 2>&1 | Out-Null
    $tries = 0
    while ($tries -lt 20) {
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $engineOk = $true; break }
        Write-Host ("  attempt {0} - waiting 3s..." -f $tries)
        Start-Sleep -Seconds 3
        $tries++
    }
}

if (-not $engineOk) {
    Write-Host "FAIL: Engine still not responding after soft and deep reset." -ForegroundColor Red
    Write-Host "Open Docker Desktop UI and check for error dialogs."
    exit 1
}

Write-Host "Engine OK" -ForegroundColor Green
docker version

Write-Host ""
Write-Host "==== PHASE C: Resolve Conflicts and Start Stack ===="

docker rm -f nexus_db       2>&1 | Out-Null
docker rm -f nexus_backend  2>&1 | Out-Null
docker rm -f nexus_frontend 2>&1 | Out-Null
Write-Host "Existing nexus_* containers removed."

$projectRoot = "E:\Phase 1_ Quantum Foundation Project Setup Instructions"
Set-Location -LiteralPath $projectRoot

Write-Host "Running compose down..."
docker compose -f ".\docker-compose.yml" down --remove-orphans 2>&1

Write-Host "Running compose up --build..."
docker compose -f ".\docker-compose.yml" up -d --build 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: docker compose up failed." -ForegroundColor Red
    docker compose -f ".\docker-compose.yml" logs --tail=60 2>&1
    exit 1
}

Write-Host "Stack started. Waiting 12s..."
Start-Sleep -Seconds 12
docker compose -f ".\docker-compose.yml" ps

Write-Host ""
Write-Host "==== PHASE D: Link Verification ===="

$BASE    = "http://127.0.0.1:8000"
$HEALTH  = "$BASE/api/health"
$OPENAPI = "$BASE/openapi.json"
$TTS_URL = "$BASE/api/v1/tts-with-timing"

$h = $null
try {
    $h = Invoke-RestMethod -Method GET -Uri $HEALTH -TimeoutSec 15
    Write-Host ("Health: ok={0} env={1} reach={2} audio={3}" -f $h.ok, $h.env, $h.reach, $h.audio)
} catch {
    Write-Host "Health request error: $_" -ForegroundColor Yellow
}

$o = $null
try {
    $o = Invoke-RestMethod -Method GET -Uri $OPENAPI -TimeoutSec 15
    Write-Host "OpenAPI: schema received"
} catch {
    Write-Host "OpenAPI request error: $_" -ForegroundColor Yellow
}

$ttsJson = '{"text":"\u0645\u0631\u062d\u0628\u0627! \u0647\u0630\u0627 \u0627\u062e\u062a\u0628\u0627\u0631.","voice":"ar-SA-HamedNeural","language":"ar-SA","format":"wav","sample_rate":24000,"with_timing":true}'
$ttsResp = $null
try {
    $ttsResp = Invoke-RestMethod -Method POST -Uri $TTS_URL `
        -ContentType "application/json; charset=utf-8" `
        -Body $ttsJson -TimeoutSec 30
    Write-Host ("TTS: format={0} sample_rate={1}" -f $ttsResp.format, $ttsResp.sample_rate)
} catch {
    Write-Host "TTS request error: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==== PHASE E: PASS/FAIL Report ===="
Write-Host ("Time      : {0:s}" -f (Get-Date))
Write-Host ("Context   : $(docker context show 2>&1)")

$health_ok  = ($h.ok    -eq $true)
$env_ok     = ($h.env   -eq $true)
$reach_ok   = ($h.reach -eq $true)
$audio_flag = ($h.audio -eq $true)
$tts_ok     = ($null -ne $ttsResp) -and ($ttsResp.audio_wav_base64 -or $ttsResp.audio_mp3_base64)
$fmt        = if ($ttsResp -and $ttsResp.format)        { "$($ttsResp.format)" }       else { "N/A" }
$sr         = if ($ttsResp -and $ttsResp.sample_rate)   { "$($ttsResp.sample_rate)" }  else { "N/A" }
$visemes    = if ($ttsResp -and $ttsResp.viseme_events) { $ttsResp.viseme_events.Count } else { 0 }
$words      = if ($ttsResp -and $ttsResp.word_timings)  { $ttsResp.word_timings.Count }  else { 0 }
$apiPaths   = if ($o -and $o.paths) { ($o.paths.psobject.Properties | Measure-Object).Count } else { 0 }

Write-Host ("Health    : ok={0}  env={1}  reach={2}  audio={3}" -f $health_ok, $env_ok, $reach_ok, $audio_flag)
Write-Host ("OpenAPI   : {0} paths" -f $apiPaths)
Write-Host ("TTS       : ok={0}  format={1}  sample_rate={2}  visemes={3}  words={4}" -f $tts_ok, $fmt, $sr, $visemes, $words)

if ($health_ok -and $env_ok -and $reach_ok -and $tts_ok) {
    Write-Host "RESULT    : PASS - Engine stable and all APIs reachable." -ForegroundColor Green
} else {
    Write-Host "RESULT    : FAIL - Needs attention." -ForegroundColor Red
    if (-not $health_ok) { Write-Host "Hint: /api/health not OK - run: docker compose logs -f backend" -ForegroundColor Yellow }
    if (-not $env_ok)    { Write-Host "Hint: env missing - ensure backend/.env exists with all required keys" -ForegroundColor Yellow }
    if (-not $reach_ok)  { Write-Host "Hint: no outbound reach - verify API keys and internet access" -ForegroundColor Yellow }
    if (-not $tts_ok)    { Write-Host "Hint: TTS failed - check voice=ar-SA-HamedNeural, format=wav 24k, backend logs" -ForegroundColor Yellow }
}
