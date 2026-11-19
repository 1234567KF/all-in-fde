# Background watcher started by the scheduled task in a hidden window.
# Logs: data\watch-console.log; status: data\watch-status.json.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data') | Out-Null
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    foreach ($candidate in @(
        "$env:USERPROFILE\.local\node\node.exe",
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )) {
        if (Test-Path -LiteralPath $candidate) { $node = $candidate; break }
    }
}
if (-not $node) {
    "$(Get-Date -Format o) node.exe not found" | Out-File -Append -Encoding utf8 (Join-Path $root 'data\watch-console.log')
    exit 1
}
& $node (Join-Path $root 'bin\dsh-cost.mjs') watch --interval 60 *>> (Join-Path $root 'data\watch-console.log')
