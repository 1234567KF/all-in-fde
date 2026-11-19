# Remove the logon task. Ledger data is kept.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File "<dsh-cost目录>\scripts\uninstall-autostart.ps1"
$ErrorActionPreference = 'Stop'
$taskName = 'DSH-Cost-Watch'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "Scheduled task $taskName not found; nothing to remove." -ForegroundColor Yellow
    exit 0
}
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed scheduled task $taskName. Ledger data was not deleted." -ForegroundColor Green
