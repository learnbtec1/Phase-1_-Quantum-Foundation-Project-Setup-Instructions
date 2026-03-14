param()
$env:DOCKER_API_VERSION = $null
Remove-Item Env:DOCKER_API_VERSION -ErrorAction SilentlyContinue

Write-Host "Testing docker info without version pin..."
$j = Start-Job { docker info 2>&1 }
$ok = Wait-Job $j -Timeout 8
if ($ok) {
    $out = Receive-Job $j
    Write-Host "Exit OK. Lines: $($out.Count)"
    $out | Select-Object -First 10
} else {
    Remove-Job $j -Force
    Write-Host "TIMEOUT (8s) without version pin."
}

Write-Host ""
Write-Host "Testing docker info with DOCKER_API_VERSION=1.46..."
$env:DOCKER_API_VERSION = "1.46"
$j2 = Start-Job { $env:DOCKER_API_VERSION = "1.46"; docker info 2>&1 }
$ok2 = Wait-Job $j2 -Timeout 8
if ($ok2) {
    $out2 = Receive-Job $j2
    Write-Host "Exit OK. Lines: $($out2.Count)"
    $out2 | Select-Object -First 10
} else {
    Remove-Job $j2 -Force
    Write-Host "TIMEOUT (8s) with 1.46."
}

Write-Host ""
Write-Host "Testing docker info with DOCKER_API_VERSION=1.44..."
$env:DOCKER_API_VERSION = "1.44"
$j3 = Start-Job { $env:DOCKER_API_VERSION = "1.44"; docker info 2>&1 }
$ok3 = Wait-Job $j3 -Timeout 8
if ($ok3) {
    $out3 = Receive-Job $j3
    Write-Host "Exit OK. Lines: $($out3.Count)"
    $out3 | Select-Object -First 10
} else {
    Remove-Job $j3 -Force
    Write-Host "TIMEOUT (8s) with 1.44."
}

Write-Host ""
Write-Host "Docker processes:"
Get-Process "Docker Desktop","dockerd","com.docker.backend","Docker" -ErrorAction SilentlyContinue |
    Select-Object Name,Id | Format-Table -AutoSize

Write-Host "WSL distros:"
wsl -l -v 2>&1

Write-Host "Pipe check:"
Test-Path "\\.\pipe\dockerDesktopLinuxEngine"
Test-Path "\\.\pipe\docker_engine"
