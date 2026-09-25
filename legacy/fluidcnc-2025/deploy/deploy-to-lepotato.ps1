# FluidCNC Deploy to Le Potato
# Run from Windows PowerShell
# Usage: .\deploy-to-lepotato.ps1 192.168.1.50

param(
    [Parameter(Mandatory=$true)]
    [string]$LePotatoIP,
    
    [string]$User = "lepotato",
    [string]$RemotePath = "/home/lepotato/fluidcnc"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "FluidCNC Deploy to Le Potato" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: $User@$LePotatoIP`:$RemotePath"
Write-Host ""

# Get script directory (where fluidcnc files are)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FluidCNCDir = Split-Path -Parent $ScriptDir

Write-Host "Source: $FluidCNCDir"
Write-Host ""

# Files to deploy
$Files = @(
    "index.html",
    "app.js",
    "styles.css",
    "dual-serial.js",
    "grblhal.js",
    "grblhal-settings.js",
    "visualizer.js",
    "visualizer-3d.js",
    "gcode-parser.js",
    "gcode-simulator.js",
    "chatter-detection.js",
    "feeds-speeds.js",
    "macros.js",
    "sw.js",
    "manifest.json"
)

# Create remote directory
Write-Host "[1/3] Creating remote directory..." -ForegroundColor Yellow
ssh "$User@$LePotatoIP" "mkdir -p $RemotePath"

# Deploy files
Write-Host "[2/3] Deploying files..." -ForegroundColor Yellow
foreach ($File in $Files) {
    $SourceFile = Join-Path $FluidCNCDir $File
    if (Test-Path $SourceFile) {
        Write-Host "  Copying $File..."
        scp "$SourceFile" "$User@$LePotatoIP`:$RemotePath/"
    } else {
        Write-Host "  Skipping $File (not found)" -ForegroundColor DarkGray
    }
}

# Deploy subdirectories
$Dirs = @("icons", "lib", "docs")
foreach ($Dir in $Dirs) {
    $SourceDir = Join-Path $FluidCNCDir $Dir
    if (Test-Path $SourceDir) {
        Write-Host "  Copying $Dir/..."
        scp -r "$SourceDir" "$User@$LePotatoIP`:$RemotePath/"
    }
}

# Restart service
Write-Host "[3/3] Restarting FluidCNC service..." -ForegroundColor Yellow
ssh "$User@$LePotatoIP" "sudo systemctl restart fluidcnc"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Deploy Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Access UI at: http://$LePotatoIP`:8080"
Write-Host "SSH access:   ssh $User@$LePotatoIP"
Write-Host ""
