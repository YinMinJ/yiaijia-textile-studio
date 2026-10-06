$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$pidPath = Join-Path $appRoot 'data/server-process.json'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Host 'No running app recorded.'; exit 0 }
$record = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
$appProcess = Get-Process -Id ([int]$record.processId) -ErrorAction SilentlyContinue
if ($appProcess -and $appProcess.ProcessName -eq 'node' -and $appProcess.Path -eq $record.nodePath -and $appProcess.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.startedAt).ToUniversalTime().Ticks) {
  Stop-Process -Id $appProcess.Id
  Write-Host 'Zhijing stopped. Saved works remain in data.'
} elseif ($appProcess) { throw 'Process identity changed; no process was stopped.' }
Remove-Item -LiteralPath $pidPath -Force
