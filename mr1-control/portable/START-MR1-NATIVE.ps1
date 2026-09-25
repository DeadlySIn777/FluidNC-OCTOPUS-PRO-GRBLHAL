$ErrorActionPreference = 'Stop'
$NativeRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$NativeRuntime = Join-Path $NativeRoot 'runtime\node.exe'
$NativeServer = Join-Path $NativeRoot 'service\native-server.mjs'
$NativeUrl = 'http://127.0.0.1:5174/?native=1'
$NativeStateUrl = 'http://127.0.0.1:5174/api/state'
$NativeLogs = Join-Path $env:LOCALAPPDATA 'MR1-Control\logs'
if (!(Test-Path -LiteralPath $NativeRuntime -PathType Leaf) -or !(Test-Path -LiteralPath $NativeServer -PathType Leaf)) {
  throw 'Extract the complete MR1 Native package before launching it.'
}
try { $NativeState = Invoke-RestMethod -Uri $NativeStateUrl -TimeoutSec 2 } catch { $NativeState = $null }
if ($NativeState -and $NativeState.protocol -ne 'mr1-native-control-v1') {
  throw 'Port 5174 is occupied by another service. Close that service before launching MR1.'
}
if ($NativeState -and $NativeState.installationRoot -ne $NativeRoot) {
  throw 'A different MR1 build is already running on port 5174. Stop that build before launching this package.'
}
if (!$NativeState) {
  New-Item -ItemType Directory -Path $NativeLogs -Force | Out-Null
  $NativeProcess = Start-Process -FilePath $NativeRuntime -ArgumentList ('"{0}"' -f $NativeServer) -WorkingDirectory $NativeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $NativeLogs 'native.stdout.log') -RedirectStandardError (Join-Path $NativeLogs 'native.stderr.log')
  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
    Start-Sleep -Milliseconds 250
    try { $NativeState = Invoke-RestMethod -Uri $NativeStateUrl -TimeoutSec 1 } catch { $NativeState = $null }
    if ($NativeState.protocol -eq 'mr1-native-control-v1') { break }
    if ($NativeProcess.HasExited) { throw ('MR1 service stopped. See ' + (Join-Path $NativeLogs 'native.stderr.log')) }
  }
  if ($NativeState.protocol -ne 'mr1-native-control-v1') { throw 'MR1 did not start. Inspect the logs in LocalAppData\MR1-Control\logs.' }
}
Start-Process $NativeUrl
Write-Host 'MR1 Native is running locally. No USB controller connects automatically.'
