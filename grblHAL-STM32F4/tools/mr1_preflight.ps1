[CmdletBinding()]
param(
    [string]$Port,
    [ValidateRange(1200, 3000000)]
    [int]$BaudRate = 115200,
    [string]$OutputDirectory,
    [string]$ReplayTranscript,
    [switch]$ListPorts,
    [switch]$SelfTest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$expectedPath = Join-Path $root "mr1\expected-settings.json"
$expected = Get-Content -LiteralPath $expectedPath -Raw | ConvertFrom-Json

function Get-SerialResponse {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Ports.SerialPort]$Serial,
        [int]$QuietMilliseconds = 350,
        [int]$TotalMilliseconds = 5000
    )

    $text = New-Object System.Text.StringBuilder
    $total = [System.Diagnostics.Stopwatch]::StartNew()
    $quiet = [System.Diagnostics.Stopwatch]::StartNew()
    $received = $false

    while ($total.ElapsedMilliseconds -lt $TotalMilliseconds) {
        if ($Serial.BytesToRead -gt 0) {
            [void]$text.Append($Serial.ReadExisting())
            $received = $true
            $quiet.Restart()
        }
        elseif ($received -and $quiet.ElapsedMilliseconds -ge $QuietMilliseconds) {
            break
        }
        Start-Sleep -Milliseconds 20
    }

    return $text.ToString()
}

function ConvertTo-InvariantDouble {
    param([Parameter(Mandatory = $true)][string]$Text)

    $number = 0.0
    $style = [System.Globalization.NumberStyles]::Float
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    if (-not [double]::TryParse($Text, $style, $culture, [ref]$number)) {
        throw "Unable to parse numeric value '$Text'."
    }
    return $number
}

function Test-Mr1Transcript {
    param(
        [Parameter(Mandatory = $true)][string]$Transcript,
        [Parameter(Mandatory = $true)]$Expected
    )

    $settingValues = @{}
    $settingPattern = '(?m)^\$(\d+)=([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)'
    foreach ($match in [regex]::Matches($Transcript, $settingPattern)) {
        $settingValues[$match.Groups[1].Value] = ConvertTo-InvariantDouble $match.Groups[2].Value
    }

    $comparisons = @()
    foreach ($setting in $Expected.settings) {
        $key = [string]$setting.id
        $actual = $null
        $status = "MISSING"
        if ($settingValues.ContainsKey($key)) {
            $actual = [double]$settingValues[$key]
            $difference = [math]::Abs($actual - [double]$setting.expected)
            if ($difference -le [double]$setting.tolerance) {
                $status = "PASS"
            }
            else {
                $status = "MISMATCH"
            }
        }
        $comparisons += [pscustomobject]@{
            id = [int]$setting.id
            name = [string]$setting.name
            expected = [double]$setting.expected
            actual = $actual
            severity = [string]$setting.severity
            status = $status
        }
    }

    $issues = @()
    $identityPresent = $Transcript.Contains([string]$Expected.boardIdentityContains)
    if (-not $identityPresent) {
        $issues += [pscustomobject]@{
            severity = "blocker"
            code = "BOARD_IDENTITY"
            message = "The controller did not report the MR-1 Octopus Pro board identity."
        }
    }

    $statusMatches = [regex]::Matches($Transcript, '(?m)<([^>\r\n]+)>')
    $machineStatus = $null
    $machineState = $null
    $activePins = $null
    if ($statusMatches.Count -gt 0) {
        $machineStatus = $statusMatches[$statusMatches.Count - 1].Groups[1].Value
        $machineState = ($machineStatus -split '\|', 2)[0]
        if ($machineStatus -match '(?:^|\|)Pn:([^|>]*)') {
            $activePins = $Matches[1]
        }
        if ($machineState -notmatch '^(Idle|Alarm)(?::.*)?$') {
            $issues += [pscustomobject]@{
                severity = "blocker"
                code = "MACHINE_STATE"
                message = "Controller state '$machineState' is not an idle preflight state."
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($activePins)) {
            $issues += [pscustomobject]@{
                severity = "blocker"
                code = "ACTIVE_INPUTS"
                message = "Active controller inputs reported by Pn: $activePins"
            }
        }
    }
    else {
        $issues += [pscustomobject]@{
            severity = "blocker"
            code = "NO_STATUS"
            message = "No realtime status report was captured."
        }
    }

    foreach ($comparison in $comparisons) {
        if ($comparison.status -ne "PASS") {
            $issues += [pscustomobject]@{
                severity = $comparison.severity
                code = "SETTING_$($comparison.id)"
                message = "`$$($comparison.id) $($comparison.name): $($comparison.status); expected $($comparison.expected), actual $($comparison.actual)"
            }
        }
    }

    $blockerCount = @($issues | Where-Object { $_.severity -eq "blocker" }).Count
    $warningCount = @($issues | Where-Object { $_.severity -eq "warning" }).Count
    $passCount = @($comparisons | Where-Object { $_.status -eq "PASS" }).Count

    return [pscustomobject]@{
        status = $(if ($blockerCount -eq 0) { "PASS" } else { "BLOCKED" })
        profile = [string]$Expected.profile
        boardIdentityPresent = $identityPresent
        machineState = $machineState
        activePins = $activePins
        counts = [pscustomobject]@{
            settingsPassed = $passCount
            settingsExpected = @($comparisons).Count
            blockers = $blockerCount
            warnings = $warningCount
        }
        issues = @($issues)
        settings = @($comparisons)
    }
}

if ($ListPorts) {
    $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
    if ($ports.Count -eq 0) {
        Write-Host "No COM ports found."
    }
    else {
        $ports | ForEach-Object { Write-Host $_ }
    }
    exit 0
}

$selectedModes = @(@($SelfTest.IsPresent, -not [string]::IsNullOrWhiteSpace($ReplayTranscript), -not [string]::IsNullOrWhiteSpace($Port)) | Where-Object { $_ })
if ($selectedModes.Count -ne 1) {
    throw "Choose exactly one mode: -Port COMx, -ReplayTranscript path, -SelfTest, or -ListPorts."
}

$capturedAt = [DateTimeOffset]::Now
$source = $null
$transcript = $null
$responses = New-Object System.Collections.Generic.List[object]

if ($SelfTest) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("[VER:mr1-self-test]")
    $lines.Add("[BOARD:$($expected.boardIdentityContains)]")
    foreach ($setting in $expected.settings) {
        $value = ([double]$setting.expected).ToString("G17", [System.Globalization.CultureInfo]::InvariantCulture)
        $lines.Add("`$$($setting.id)=$value")
    }
    $lines.Add("<Alarm|MPos:0.000,0.000,0.000|FS:0,0>")
    $transcript = $lines -join "`r`n"
    $source = "self-test"
}
elseif (-not [string]::IsNullOrWhiteSpace($ReplayTranscript)) {
    $resolvedReplay = (Resolve-Path -LiteralPath $ReplayTranscript).Path
    $transcript = Get-Content -LiteralPath $resolvedReplay -Raw
    $source = "replay:$resolvedReplay"
}
else {
    if ($Port -notmatch '^COM\d+$') {
        throw "Port must look like COM3 or COM12."
    }

    $serial = $null
    try {
        $serial = New-Object System.IO.Ports.SerialPort $Port, $BaudRate, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
        $serial.Handshake = [System.IO.Ports.Handshake]::None
        $serial.DtrEnable = $false
        $serial.RtsEnable = $false
        $serial.NewLine = "`n"
        $serial.ReadTimeout = 500
        $serial.WriteTimeout = 500
        $serial.Open()

        Start-Sleep -Milliseconds 500
        $startup = Get-SerialResponse -Serial $serial -QuietMilliseconds 250 -TotalMilliseconds 1000
        if (-not [string]::IsNullOrEmpty($startup)) {
            $responses.Add([pscustomobject]@{ command = "<startup>"; response = $startup })
        }

        foreach ($command in $expected.readOnlyQueries) {
            if ($command -eq "?") {
                $serial.Write("?")
            }
            else {
                $serial.WriteLine([string]$command)
            }
            $response = Get-SerialResponse -Serial $serial
            $responses.Add([pscustomobject]@{ command = [string]$command; response = $response })
        }
    }
    finally {
        if ($null -ne $serial -and $serial.IsOpen) {
            $serial.Close()
        }
        if ($null -ne $serial) {
            $serial.Dispose()
        }
    }

    $sections = foreach ($response in $responses) {
        "===== $($response.command) =====`r`n$($response.response)"
    }
    $transcript = $sections -join "`r`n"
    $source = "serial:$Port@$BaudRate"
}

$result = Test-Mr1Transcript -Transcript $transcript -Expected $expected
$result | Add-Member -NotePropertyName capturedAt -NotePropertyValue $capturedAt.ToString("o")
$result | Add-Member -NotePropertyName source -NotePropertyValue $source

Write-Host "MR-1 preflight: $($result.status)"
Write-Host "Source: $source"
Write-Host "State: $($result.machineState)"
Write-Host "Settings: $($result.counts.settingsPassed)/$($result.counts.settingsExpected) matched"
Write-Host "Blockers: $($result.counts.blockers); warnings: $($result.counts.warnings)"
foreach ($issue in $result.issues) {
    Write-Host "[$($issue.severity.ToUpperInvariant())] $($issue.message)"
}

if (-not $SelfTest) {
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $OutputDirectory = Join-Path $root "mr1\captures"
    }
    $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
    $stamp = $capturedAt.ToString("yyyyMMdd-HHmmss")
    $transcriptPath = Join-Path $OutputDirectory "mr1-preflight-$stamp.txt"
    $summaryPath = Join-Path $OutputDirectory "mr1-preflight-$stamp.json"
    Set-Content -LiteralPath $transcriptPath -Value $transcript -Encoding UTF8
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Host "Transcript: $transcriptPath"
    Write-Host "Summary: $summaryPath"
}

if ($result.status -eq "PASS") {
    exit 0
}
exit 2
