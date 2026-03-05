$ErrorActionPreference = 'Stop'

$pythonBaseUrl = 'http://127.0.0.1:8000'
$gradeUrl = "$pythonBaseUrl/api/v1/assessment/grade"
$nextProjectPath = 'e:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend'
$retrySeconds = 5

function Test-Port8000 {
    $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listener
}

function Wait-ForPythonServer {
    Write-Host 'Checking Python server on port 8000...'
    while (-not (Test-Port8000)) {
        Write-Host "Python server not listening on :8000. Retrying in $retrySeconds seconds..."
        Start-Sleep -Seconds $retrySeconds
    }
    Write-Host 'Python server is listening on port 8000.'
}

function Test-PythonBridge {
    $payload = @{
        student_content = 'Bridge validation sample for unit 14 with P1 and M1 evidence.'
        assignment_text = 'ASSIGNMENT BRIEF: Evaluate P1 and M1 criteria for business analysis.'
        unit_id = '14'
    } | ConvertTo-Json

    Write-Host 'Sending test request with student_content...'
    while ($true) {
        try {
            $response = Invoke-WebRequest -Uri $gradeUrl -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 90
            if ($response.StatusCode -eq 200) {
                Write-Host 'Python bridge returned 200 OK.'
                return $true
            }
            Write-Host "Bridge returned status $($response.StatusCode). Retrying in $retrySeconds seconds..."
        }
        catch {
            Write-Host "Bridge test failed: $($_.Exception.Message)"
            Write-Host "Retrying in $retrySeconds seconds..."
        }
        Start-Sleep -Seconds $retrySeconds
    }
}

function Restart-NextDevServer {
    Write-Host 'Restarting Next.js dev server...'

    $nextProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -like '*next dev*' -or $_.CommandLine -like '*npm*run*dev*' }

    foreach ($proc in $nextProcesses) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
            Write-Host "Stopped process $($proc.ProcessId)"
        }
        catch {
            Write-Host "Could not stop process $($proc.ProcessId): $($_.Exception.Message)"
        }
    }

    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' -WorkingDirectory $nextProjectPath
    Write-Host 'Next.js dev server restart command issued.'
}

Wait-ForPythonServer
if (Test-PythonBridge) {
    Restart-NextDevServer
}
