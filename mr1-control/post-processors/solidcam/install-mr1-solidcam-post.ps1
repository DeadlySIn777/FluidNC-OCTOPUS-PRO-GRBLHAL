[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$BaseVmid,
  [string]$SolidCamRoot,
  [string]$OutputDirectory,
  [switch]$ListCandidates,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$PostName = "MR1_grblHAL"
$ScriptRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$SourceGpp = Join-Path $ScriptRoot "$PostName.gpp"
$MaxVmidBytes = 10MB

function Get-NormalizedPath([string]$Path) {
  return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path)
}

function Get-SolidCamRoots {
  $Roots = [Collections.Generic.List[string]]::new()
  if ($SolidCamRoot) {
    $Roots.Add((Get-NormalizedPath $SolidCamRoot))
  }

  $SearchParents = @(
    (Join-Path $env:PUBLIC "Documents\SolidCAM"),
    (Join-Path $env:ProgramData "SolidCAM")
  ) | Select-Object -Unique

  foreach ($Parent in $SearchParents) {
    if (-not (Test-Path -LiteralPath $Parent -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $Parent -Directory -Filter "SolidCAM20*" -ErrorAction SilentlyContinue |
      ForEach-Object {
        $GppTool = Join-Path $_.FullName "Gpptool"
        if (Test-Path -LiteralPath $GppTool -PathType Container) {
          $Roots.Add([IO.Path]::GetFullPath($GppTool))
        }
      }
  }

  return $Roots | Select-Object -Unique
}

function Read-SafeVmid([string]$Path) {
  $Item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($Item.Length -gt $MaxVmidBytes) {
    throw "VMID exceeds the 10 MB safety limit: $($Item.FullName)"
  }

  $Settings = [Xml.XmlReaderSettings]::new()
  $Settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $Settings.XmlResolver = $null
  $Settings.MaxCharactersInDocument = $MaxVmidBytes
  $Settings.IgnoreWhitespace = $false

  $Reader = [Xml.XmlReader]::Create($Item.FullName, $Settings)
  try {
    $Document = [Xml.XmlDocument]::new()
    $Document.XmlResolver = $null
    $Document.PreserveWhitespace = $true
    $Document.Load($Reader)
    return $Document
  } finally {
    $Reader.Dispose()
  }
}

function Get-VmidAssessment([string]$Path) {
  try {
    $Document = Read-SafeVmid $Path
    $Machine = $Document.SelectSingleNode("/Machine")
    if ($null -eq $Machine) {
      return [PSCustomObject]@{ Path = $Path; Suitable = $false; Reason = "Missing /Machine root"; Document = $null }
    }

    $Axes = @($Document.SelectNodes("//Axes//Axis"))
    $AxisNames = @($Axes | ForEach-Object { $_.GetAttribute("Name").ToUpperInvariant() })
    $LinearAxes = @($Axes | Where-Object { $_.GetAttribute("Type") -eq "0" })
    $NamesMatch = ($AxisNames.Count -eq 3) -and
      (($AxisNames | Sort-Object) -join "," -eq "X,Y,Z")
    $AllLinear = $LinearAxes.Count -eq 3

    if (-not $NamesMatch -or -not $AllLinear) {
      $ShownNames = if ($AxisNames.Count) { $AxisNames -join "," } else { "none" }
      return [PSCustomObject]@{
        Path = $Path
        Suitable = $false
        Reason = "Requires exactly three linear X/Y/Z axes; found $ShownNames"
        Document = $null
      }
    }

    return [PSCustomObject]@{ Path = $Path; Suitable = $true; Reason = "3-axis linear X/Y/Z"; Document = $Document }
  } catch {
    return [PSCustomObject]@{ Path = $Path; Suitable = $false; Reason = $_.Exception.Message; Document = $null }
  }
}

function Set-AttributeValue([Xml.XmlElement]$Element, [string]$Name, [string]$Value) {
  if (-not $Element.HasAttribute($Name)) {
    throw "The selected VMID schema does not define '$Name' on <$($Element.Name)>."
  }
  $Element.SetAttribute($Name, $Value)
}

function Get-Sha256([string]$Path) {
  $Stream = [IO.File]::OpenRead($Path)
  try {
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try {
      return [BitConverter]::ToString($Hasher.ComputeHash($Stream)).Replace("-", "")
    } finally {
      $Hasher.Dispose()
    }
  } finally {
    $Stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $SourceGpp -PathType Leaf)) {
  throw "SolidCAM GPP source is missing: $SourceGpp"
}

$Roots = @(Get-SolidCamRoots)
$CandidatePaths = [Collections.Generic.List[string]]::new()

if ($BaseVmid) {
  $CandidatePaths.Add((Get-NormalizedPath $BaseVmid))
} else {
  foreach ($Root in $Roots) {
    Get-ChildItem -LiteralPath $Root -Filter "*.vmid" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.BaseName -ne $PostName } |
      ForEach-Object { $CandidatePaths.Add($_.FullName) }
  }
}

$Assessments = @($CandidatePaths | Select-Object -Unique | ForEach-Object { Get-VmidAssessment $_ })
if ($ListCandidates) {
  $Assessments | Select-Object Path, Suitable, Reason | Format-Table -AutoSize
  return
}

$Suitable = @($Assessments | Where-Object Suitable)
if ($Suitable.Count -eq 0) {
  if ($Roots.Count -eq 0 -and -not $BaseVmid) {
    throw "No SolidCAM Gpptool folder was found. Install SolidCAM, or pass -SolidCamRoot and -BaseVmid explicitly."
  }
  $Reasons = ($Assessments | ForEach-Object { "$($_.Path): $($_.Reason)" }) -join [Environment]::NewLine
  throw "No version-native 3-axis X/Y/Z VMID is available. Review candidates with -ListCandidates.$([Environment]::NewLine)$Reasons"
}
if ($Suitable.Count -gt 1 -and -not $BaseVmid) {
  $Paths = ($Suitable | ForEach-Object Path) -join [Environment]::NewLine
  throw "More than one suitable VMID was found. Re-run with -BaseVmid and choose one:$([Environment]::NewLine)$Paths"
}

$Selected = $Suitable[0]
$Document = $Selected.Document
$Machine = [Xml.XmlElement]$Document.SelectSingleNode("/Machine")
$Axes = @($Document.SelectNodes("//Axes//Axis"))

$Machine.SetAttribute("Name", $PostName)
$Machine.SetAttribute("Company", "MR-1 Control")
$Machine.SetAttribute("Model", "Langmuir MR-1")
$Machine.SetAttribute("ControllerName", "grblHAL")
if ($Machine.HasAttribute("MaxSpin")) { $Machine.SetAttribute("MaxSpin", "8000") }

$SpindleNodes = @($Document.SelectNodes("//SubDevice[@Type='2']"))
if ($SpindleNodes.Count -eq 0) {
  throw "The selected VMID does not contain a spindle SubDevice (Type=2)."
}
foreach ($Spindle in $SpindleNodes) {
  Set-AttributeValue ([Xml.XmlElement]$Spindle) "MaxSpin" "8000"
}

$AxisContract = @{
  X = @{ MinLim = "-564.42"; MaxLim = "-2"; HomeRef = "-2"; Rapid = "2540"; MaxSpeed = "2540"; Acceleration = "250"; Deceleration = "250" }
  Y = @{ MinLim = "-544.10"; MaxLim = "-2"; HomeRef = "-2"; Rapid = "2540"; MaxSpeed = "2540"; Acceleration = "250"; Deceleration = "250" }
  Z = @{ MinLim = "-152.94"; MaxLim = "-2"; HomeRef = "-2"; Rapid = "1016"; MaxSpeed = "1016"; Acceleration = "150"; Deceleration = "150" }
}

foreach ($Axis in $Axes) {
  $Name = $Axis.GetAttribute("Name").ToUpperInvariant()
  foreach ($Property in $AxisContract[$Name].GetEnumerator()) {
    Set-AttributeValue ([Xml.XmlElement]$Axis) $Property.Key $Property.Value
  }
}

if (-not $OutputDirectory) {
  $OutputDirectory = Split-Path -Parent $Selected.Path
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)

$DestinationVmid = Join-Path $OutputDirectory "$PostName.vmid"
$DestinationGpp = Join-Path $OutputDirectory "$PostName.gpp"
$ManifestPath = Join-Path $OutputDirectory "$PostName.install.json"
$Existing = @($DestinationVmid, $DestinationGpp, $ManifestPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($Existing.Count -gt 0 -and -not $Force) {
  throw "MR-1 post files already exist. Re-run with -Force after reviewing them: $($Existing -join ', ')"
}

if ($PSCmdlet.ShouldProcess($OutputDirectory, "Install version-native MR-1 SolidCAM post")) {
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  $Utf8NoBom = [Text.UTF8Encoding]::new($false)
  $WriterSettings = [Xml.XmlWriterSettings]::new()
  $WriterSettings.Encoding = $Utf8NoBom
  $WriterSettings.Indent = $true
  $WriterSettings.NewLineChars = [Environment]::NewLine
  $WriterSettings.NewLineHandling = [Xml.NewLineHandling]::Replace

  $Writer = [Xml.XmlWriter]::Create($DestinationVmid, $WriterSettings)
  try {
    $Document.Save($Writer)
  } finally {
    $Writer.Dispose()
  }
  Copy-Item -LiteralPath $SourceGpp -Destination $DestinationGpp -Force

  $Manifest = [ordered]@{
    post = $PostName
    contractVersion = "1.0.0"
    installedAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceVmid = $Selected.Path
    sourceVmidSha256 = Get-Sha256 $Selected.Path
    outputVmid = $DestinationVmid
    outputVmidSha256 = Get-Sha256 $DestinationVmid
    outputGppSha256 = Get-Sha256 $DestinationGpp
    spindleMaxRpm = 8000
    safeMachineZMm = -2
    axes = $AxisContract
    validation = "Open MR1_grblHAL in SolidCAM, post the acceptance jobs, then run the bundled NC validator before machine use."
  }
  [IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 6), $Utf8NoBom)
}

[PSCustomObject]@{
  BaseVmid = $Selected.Path
  Vmid = $DestinationVmid
  Gpp = $DestinationGpp
  Manifest = $ManifestPath
  Contract = "MR-1 grblHAL 1.0.0"
}
