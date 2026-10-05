param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$appUrl = 'http://127.0.0.1:3000'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$dataPath = Join-Path $appRoot 'data'
New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
function Test-App {
  try { return (Invoke-RestMethod "$appUrl/api/health" -TimeoutSec 2).app -eq 'yiaijia-web' }
  catch { return $false }
}
if (-not (Test-App)) {
  if (-not (Test-Path (Join-Path $appRoot 'node_modules/next'))) {
    throw 'Dependencies missing. Run pnpm install in this folder first.'
  }
  if (-not (Test-Path (Join-Path $appRoot '.next/BUILD_ID'))) {
    throw 'Build missing. Run pnpm build in this folder first.'
  }
  $serverScript = Join-Path $PSScriptRoot 'start-server.mjs'
  $env:APP_LOCAL_MODE = '1'
  $env:APP_URL = $appUrl
  $env:PORT = '3000'
  $env:DATA_DIR = $dataPath
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $appProcess = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverScript + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log') -PassThru
  @{ processId = $appProcess.Id; startedAt = $appProcess.StartTime.ToUniversalTime().ToString('o'); nodePath = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataPath 'server-process.json') -Encoding utf8
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-App) { $ready = $true; break }
    if ($appProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Startup failed. See $dataPath\server-error.log" }
}
Write-Host "Yiaijia is running at $appUrl"
if (-not $NoBrowser) { Start-Process $appUrl }
