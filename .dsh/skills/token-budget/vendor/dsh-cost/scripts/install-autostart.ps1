# Register a per-user logon task that starts the local DSH cost watcher.
# Usage (normal PowerShell, no admin required):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\all-in-fde\tools\dsh-cost\scripts\install-autostart.ps1"
$ErrorActionPreference = 'Stop'
$taskName = 'DSH-Cost-Watch'
$root = Split-Path -Parent $PSScriptRoot
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script = Join-Path $PSScriptRoot 'watch-hidden.ps1'
$actionArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$action = New-ScheduledTaskAction -Execute $ps -Argument $actionArgs -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'DSH local cost watcher: incremental sync of ~/.dsh/sessions at logon. No model calls, no tokens.' -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started scheduled task: $taskName" -ForegroundColor Green
Write-Host "Status file: $root\data\watch-status.json"
Write-Host "Check status: node `"$root\bin\dsh-cost.mjs`" status"
Write-Host ""
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-Table -AutoSize
