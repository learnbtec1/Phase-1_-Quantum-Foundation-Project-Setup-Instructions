$file = 'e:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend\src\components\avatar\VRMAvatar.tsx'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$content = [System.IO.File]::ReadAllText($file, $utf8NoBom)

# Block 1: Delete eulerToQuatArray + ARM_BONE_NAMES + all SKELETON patterns (VRM_BONE_LABELS_AR is kept)
$b1s = $content.IndexOf('function eulerToQuatArray')
$b1e = $content.IndexOf('const VRM_BONE_LABELS_AR')
if ($b1s -ge 0 -and $b1e -gt $b1s) {
    $content = $content.Substring(0, $b1s) + $content.Substring($b1e)
    Write-Host "Block 1 deleted (chars $b1s to $b1e)"
} else {
    Write-Host "ERROR: Block 1 anchors not found. b1s=$b1s b1e=$b1e"
    exit 1
}

# Block 2: Delete ExtendedGestureType + GestureState + apply* functions + IDLE_ANIM_EMOTIONS + useArmPose
$b2s = $content.IndexOf('export type ExtendedGestureType')
$b2e = $content.IndexOf('function useProceduralBlink')
if ($b2s -ge 0 -and $b2e -gt $b2s) {
    $content = $content.Substring(0, $b2s) + $content.Substring($b2e)
    Write-Host "Block 2 deleted (chars $b2s to $b2e)"
} else {
    Write-Host "ERROR: Block 2 anchors not found. b2s=$b2s b2e=$b2e"
    exit 1
}

[System.IO.File]::WriteAllText($file, $content, $utf8NoBom)
Write-Host "File written successfully. New length: $($content.Length) chars"
