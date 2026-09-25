param(
  [string]$PackageName = ("MR1-Control-Portable-{0}" -f (Get-Date -Format "yyyy-MM-dd")),
  [string]$NodeExecutable = $env:MR1_PORTABLE_NODE
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  $Stream = [System.IO.File]::OpenRead($Path)
  try {
    $Sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $HashBytes = $Sha256.ComputeHash($Stream)
      return [System.BitConverter]::ToString($HashBytes).Replace("-", "")
    }
    finally {
      $Sha256.Dispose()
    }
  }
  finally {
    $Stream.Dispose()
  }
}

$AppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$WorkspaceRoot = [IO.Path]::GetFullPath((Join-Path $AppRoot ".."))
$ReleaseRoot = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot "release"))
$WiringDocsRoot = [IO.Path]::GetFullPath((Join-Path $WorkspaceRoot "grblHAL-STM32F4\mr1"))
$ControllerFirmwareRoot = [IO.Path]::GetFullPath((Join-Path $AppRoot "public\firmware\octopus-pro-v1.1-f429-mr1"))
$StageRoot = [IO.Path]::GetFullPath((Join-Path $ReleaseRoot $PackageName))
$ZipPath = [IO.Path]::GetFullPath((Join-Path $ReleaseRoot "$PackageName.zip"))
$ChecksumPath = [IO.Path]::GetFullPath((Join-Path $ReleaseRoot "$PackageName.sha256.txt"))
$ReleasePrefix = $ReleaseRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $StageRoot.StartsWith($ReleasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Portable stage path must stay inside the workspace release directory."
}
if (-not $ZipPath.StartsWith($ReleasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Portable ZIP path must stay inside the workspace release directory."
}
if (-not $ChecksumPath.StartsWith($ReleasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Portable checksum path must stay inside the workspace release directory."
}

if (-not $NodeExecutable) {
  $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
}
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) {
  throw "Node runtime was not found at $NodeExecutable"
}

$ControllerFirmwareManifestPath = Join-Path $ControllerFirmwareRoot "firmware-manifest.json"
$ControllerFirmwareImagePath = Join-Path $ControllerFirmwareRoot "firmware.bin"
if (-not (Test-Path -LiteralPath $ControllerFirmwareManifestPath -PathType Leaf)) {
  throw "Controller firmware manifest was not found at $ControllerFirmwareManifestPath"
}
if (-not (Test-Path -LiteralPath $ControllerFirmwareImagePath -PathType Leaf)) {
  throw "Controller firmware image was not found at $ControllerFirmwareImagePath"
}
$ControllerFirmwareManifest = Get-Content -LiteralPath $ControllerFirmwareManifestPath -Raw | ConvertFrom-Json
$ControllerFirmwareImage = Get-Item -LiteralPath $ControllerFirmwareImagePath
$ControllerFirmwareHash = Get-Sha256Hex -Path $ControllerFirmwareImagePath
if ($ControllerFirmwareImage.Length -ne $ControllerFirmwareManifest.artifact.bytes) {
  throw "Controller firmware byte count does not match firmware-manifest.json."
}
if ($ControllerFirmwareHash -ne $ControllerFirmwareManifest.artifact.sha256) {
  throw "Controller firmware SHA-256 does not match firmware-manifest.json."
}
if ($ControllerFirmwareManifest.validation.physicalMotionPermitted -ne $false) {
  throw "Controller candidate manifest must never grant physical motion permission."
}

Push-Location $AppRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $ReleaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
if (Test-Path -LiteralPath $ChecksumPath) {
  Remove-Item -LiteralPath $ChecksumPath -Force
}

$Directories = @(
  $StageRoot,
  (Join-Path $StageRoot "app"),
  (Join-Path $StageRoot "runtime"),
  (Join-Path $StageRoot "service"),
  (Join-Path $StageRoot "post-processors"),
  (Join-Path $StageRoot "controller-firmware"),
  (Join-Path $StageRoot "tools"),
  (Join-Path $StageRoot "wiring-docs"),
  (Join-Path $StageRoot "src"),
  (Join-Path $StageRoot "src\vendor"),
  (Join-Path $StageRoot "src\telemetry")
)
foreach ($Directory in $Directories) {
  New-Item -ItemType Directory -Path $Directory -Force | Out-Null
}

Copy-Item -Path (Join-Path $AppRoot "dist\*") -Destination (Join-Path $StageRoot "app") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "portable\portable-server.mjs") -Destination $StageRoot -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "portable\START-MR1-CONTROL.cmd") -Destination $StageRoot -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "portable\START-MR1-CONTROL-PHONE-TEST.cmd") -Destination $StageRoot -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "portable\README.txt") -Destination $StageRoot -Force
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $StageRoot "runtime\node.exe") -Force
Copy-Item -Path (Join-Path $AppRoot "post-processors\*") -Destination (Join-Path $StageRoot "post-processors") -Recurse -Force
Copy-Item -Path (Join-Path $ControllerFirmwareRoot "*") -Destination (Join-Path $StageRoot "controller-firmware") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "tools\validate-post-output.mjs") -Destination (Join-Path $StageRoot "tools") -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "src\nc-safety-validator.js") -Destination (Join-Path $StageRoot "src") -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "src\vendor\gcode-parser-browser.js") -Destination (Join-Path $StageRoot "src\vendor") -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "service\mr1-telemetry-service.mjs") -Destination (Join-Path $StageRoot "service") -Force
Copy-Item -LiteralPath (Join-Path $AppRoot "service\fission-processor.mjs") -Destination (Join-Path $StageRoot "service") -Force
$ServiceSources = @(
  "controller-preflight.mjs",
  "event-journal.mjs",
  "machine-transaction-coordinator.mjs",
  "virtual-mr1-controller.mjs"
)
foreach ($Source in $ServiceSources) {
  Copy-Item -LiteralPath (Join-Path $AppRoot "service\$Source") -Destination (Join-Path $StageRoot "service") -Force
}

$SharedSources = @("controller-settings.js", "machine-command.js", "machine-config.js", "probing-profile.js")
foreach ($Source in $SharedSources) {
  Copy-Item -LiteralPath (Join-Path $AppRoot "src\$Source") -Destination (Join-Path $StageRoot "src") -Force
}

$TelemetrySources = @("chatter-status.js", "grbl-status.js", "spindle-status.js")
foreach ($Source in $TelemetrySources) {
  Copy-Item -LiteralPath (Join-Path $AppRoot "src\telemetry\$Source") -Destination (Join-Path $StageRoot "src\telemetry") -Force
}

$WiringDocs = @(
  "PIGTAIL_SCHEDULE.md",
  "WIRING.md",
  "DM860T_QUICK_WIRING.md",
  "COMMISSIONING.md",
  "INTERFACE_BOARD.md",
  "BOM.md",
  "cable-schedule.csv",
  "expected-settings.json"
)
foreach ($Source in $WiringDocs) {
  $SourcePath = Join-Path $WiringDocsRoot $Source
  if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw "Required wiring document was not found at $SourcePath"
  }
  Copy-Item -LiteralPath $SourcePath -Destination (Join-Path $StageRoot "wiring-docs") -Force
}

$StagedFirmwarePath = Join-Path $StageRoot "controller-firmware\firmware.bin"
$StagedFirmwareHash = Get-Sha256Hex -Path $StagedFirmwarePath
if ($StagedFirmwareHash -ne $ControllerFirmwareHash) {
  throw "Staged controller firmware failed its post-copy SHA-256 check."
}

Push-Location $StageRoot
try {
  & (Join-Path $StageRoot "runtime\node.exe") --input-type=module --eval "await import('./service/mr1-telemetry-service.mjs'); await import('./service/machine-transaction-coordinator.mjs'); await import('./service/virtual-mr1-controller.mjs');"
  if ($LASTEXITCODE -ne 0) { throw "Portable service dependency check failed." }
  & (Join-Path $StageRoot "runtime\node.exe") tools\validate-post-output.mjs `
    post-processors\examples\fusion-face.nc `
    post-processors\examples\fusion-toolchange.nc `
    post-processors\examples\fusion-deep-drilling.nc `
    post-processors\examples\fusion-thread-mill.nc
  if ($LASTEXITCODE -ne 0) { throw "Portable NC validator self-check failed." }
} finally {
  Pop-Location
}

Compress-Archive -LiteralPath $StageRoot -DestinationPath $ZipPath -CompressionLevel Optimal

$Zip = Get-Item -LiteralPath $ZipPath
$Hash = Get-Sha256Hex -Path $ZipPath
$ChecksumLine = "$Hash *$($Zip.Name)"
[IO.File]::WriteAllText($ChecksumPath, "$ChecksumLine`r`n", [Text.Encoding]::ASCII)
[PSCustomObject]@{
  Folder = $StageRoot
  Zip = $Zip.FullName
  Checksum = $ChecksumPath
  SizeMB = [Math]::Round($Zip.Length / 1MB, 2)
  SHA256 = $Hash
}
