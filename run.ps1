#requires -Version 5.1

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$ProjectRoot      = "E:\Phase 1_ Quantum Foundation Project Setup Instructions"
$DockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$LogPath          = Join-Path $ProjectRoot "run.log"

$FrontendHealthCandidates = @(
    "http://127.0.0.1:3000/api/health",
    "http://127.0.0.1:3011/api/health"
)

$BackendHealthCandidates = @(
    "http://127.0.0.1:8000/api/health",
    "http://127.0.0.1:8000/openapi.json",
    "http://127.0.0.1:8000/docs",
    "http://127.0.0.1:5000/health"
)

function Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Ok {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function WarnMsg {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function FailMsg {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Test-DockerReady {
    try {
        docker version *> $null
        return ($LASTEXITCODE -eq 0)
    }
    catch {
        return $false
    }
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerReady) {
        Ok "Docker Desktop is ready."
        return
    }

    if (-not (Test-Path $DockerDesktopExe)) {
        throw "Docker Desktop was not found at: $DockerDesktopExe"
    }

    Info "Starting Docker Desktop..."
    Start-Process $DockerDesktopExe | Out-Null

    $maxAttempts = 90
    for ($i = 1; $i -le $maxAttempts; $i++) {
        Start-Sleep -Seconds 2
        if (Test-DockerReady) {
            Ok "Docker Desktop is now ready."
            return
        }
    }

    throw "Docker Desktop did not become ready in time."
}

function Test-Url {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSec = 10
    )

    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec $TimeoutSec -ErrorAction Stop
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
    }
    catch {
        try {
            $resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSec -ErrorAction Stop
            return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
        }
        catch {
            return $false
        }
    }
}

function Wait-UrlHealthy {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$MaxSeconds = 120
    )

    $attempts = [Math]::Ceiling($MaxSeconds / 2)
    for ($i = 1; $i -le $attempts; $i++) {
        if (Test-Url -Url $Url -TimeoutSec 10) {
            Ok "$Name is healthy at $Url"
            return $true
        }
        Start-Sleep -Seconds 2
    }

    WarnMsg "$Name did not become healthy within timeout: $Url"
    return $false
}

function Resolve-WorkingUrl {
    param(
        [Parameter(Mandatory = $true)][string[]]$Candidates,
        [int]$TimeoutSec = 8
    )

    foreach ($url in $Candidates) {
        if (Test-Url -Url $url -TimeoutSec $TimeoutSec) {
            return $url
        }
    }

    return $null
}

function Wait-ServiceHealthIfAvailable {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [int]$MaxSeconds = 120
    )

    $attempts = [Math]::Ceiling($MaxSeconds / 2)
    for ($i = 1; $i -le $attempts; $i++) {
        try {
            $status = docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}" $ContainerName 2>$null
            if ($status -eq "healthy")   { return $true }
            if ($status -eq "unhealthy") { return $false }
            if ($status -eq "nohealth")  { return $true }
        }
        catch {
            return $false
        }
        Start-Sleep -Seconds 2
    }

    return $false
}

function Show-Status {
    Info "Docker Compose status:"
    docker compose ps

    Write-Host ""
    Info "Container ports:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

try {
    if (-not (Test-Path $ProjectRoot)) {
        throw "Project root was not found: $ProjectRoot"
    }

    Set-Location $ProjectRoot

    try { Stop-Transcript | Out-Null } catch {}
    Start-Transcript -Path $LogPath -Append | Out-Null

    Info "run.ps1 started"
    Info "Project root: $ProjectRoot"

    Start-DockerDesktopIfNeeded

    Info "Switching Docker context to default"
    docker context use default | Out-Null

    Info "Running docker compose up -d"
    docker compose up -d
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up -d failed."
    }

    Start-Sleep -Seconds 5
    Show-Status

    $services = @()
    try {
        $services = docker compose ps --format json | ConvertFrom-Json
    }
    catch {
        $services = @()
    }

    $dbContainer = ($services | Where-Object { $_.Service -match 'db|postgres' } | Select-Object -First 1).Name
    $beContainer = ($services | Where-Object { $_.Service -match 'back' } | Select-Object -First 1).Name
    $feContainer = ($services | Where-Object { $_.Service -match 'front' } | Select-Object -First 1).Name

    if ($dbContainer) {
        Info "Waiting for DB container health: $dbContainer"
        if (Wait-ServiceHealthIfAvailable -ContainerName $dbContainer -MaxSeconds 120) {
            Ok "DB container ready: $dbContainer"
        } else {
            WarnMsg "DB container did not report healthy: $dbContainer"
        }
    }

    if ($beContainer) {
        Info "Waiting for Backend container health: $beContainer"
        if (Wait-ServiceHealthIfAvailable -ContainerName $beContainer -MaxSeconds 120) {
            Ok "Backend container ready: $beContainer"
        } else {
            WarnMsg "Backend container did not report healthy: $beContainer"
        }
    }

    if ($feContainer) {
        Info "Waiting for Frontend container health: $feContainer"
        if (Wait-ServiceHealthIfAvailable -ContainerName $feContainer -MaxSeconds 180) {
            Ok "Frontend container ready: $feContainer"
        } else {
            WarnMsg "Frontend container did not report healthy: $feContainer"
        }
    } else {
        WarnMsg "Frontend container was not found in docker compose."
    }

    Info "Resolving backend health URL..."
    $BackendHealthUrl = Resolve-WorkingUrl -Candidates $BackendHealthCandidates -TimeoutSec 10

    Info "Resolving frontend health URL..."
    $FrontendHealthUrl = Resolve-WorkingUrl -Candidates $FrontendHealthCandidates -TimeoutSec 10

    if (-not $BackendHealthUrl) {
        WarnMsg "Backend health URL was not detected automatically."
    }

    if (-not $FrontendHealthUrl) {
        WarnMsg "Frontend health URL was not detected automatically."
    }

    $backendOk  = $false
    $frontendOk = $false

    if ($BackendHealthUrl) {
        Info "Checking backend health..."
        $backendOk = Wait-UrlHealthy -Url $BackendHealthUrl -Name "Backend" -MaxSeconds 120
    }

    if ($FrontendHealthUrl) {
        Info "Checking frontend health..."
        $frontendOk = Wait-UrlHealthy -Url $FrontendHealthUrl -Name "Frontend" -MaxSeconds 180
    }

    $backendRoot  = $null
    $frontendRoot = $null

    if ($BackendHealthUrl) {
        $backendRoot = ([System.Uri]$BackendHealthUrl).GetLeftPart([System.UriPartial]::Authority)
    }

    if ($FrontendHealthUrl) {
        $frontendRoot = ([System.Uri]$FrontendHealthUrl).GetLeftPart([System.UriPartial]::Authority)
    }

    Write-Host ""

    if ($backendOk -and $backendRoot) {
        Ok "Backend root: $backendRoot"
    } else {
        FailMsg "Backend health failed."
    }

    if ($frontendOk -and $frontendRoot) {
        Ok "Frontend root: $frontendRoot"
    } else {
        FailMsg "Frontend health failed."
    }

    Write-Host ""
    Info "Open URLs:"
    if ($frontendRoot) { Write-Host "Frontend: $frontendRoot" -ForegroundColor White }
    if ($backendRoot)  { Write-Host "Backend : $backendRoot"  -ForegroundColor White }

    Write-Host ""
    Info "Useful logs:"
    Write-Host "docker compose logs -f backend" -ForegroundColor DarkGray
    Write-Host "docker compose logs -f frontend" -ForegroundColor DarkGray
    Write-Host "docker compose logs -f db" -ForegroundColor DarkGray
}
catch {
    FailMsg $_.Exception.Message
    exit 1
}
finally {
    try { Stop-Transcript | Out-Null } catch {}
}