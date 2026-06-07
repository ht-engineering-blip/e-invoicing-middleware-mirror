# Start DB script for Windows/PowerShell
# Starts Docker Desktop if not running, launches Local MongoDB & Redis containers, and sets up .env

$dockerDesktopPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$maxRetries = 20
$retryDelaySec = 3

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   Setting up and Starting Local MongoDB & Redis   " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Check if Docker daemon is running
Write-Host "Checking if Docker daemon is running..." -ForegroundColor Gray
$dockerCheck = docker ps 2>&1

if ($dockerCheck -match "error" -or $dockerCheck -match "failed to connect") {
    Write-Host "Docker daemon is not running. Launching Docker Desktop..." -ForegroundColor Yellow
    if (Test-Path $dockerDesktopPath) {
        Start-Process $dockerDesktopPath
        Write-Host "Waiting for Docker daemon to become responsive..." -ForegroundColor Gray
        
        $connected = $false
        for ($i = 1; $i -le $maxRetries; $i++) {
            Start-Sleep -Seconds $retryDelaySec
            $dockerCheck = docker ps 2>&1
            if ($dockerCheck -notmatch "error" -and $dockerCheck -notmatch "failed to connect") {
                $connected = $true
                break
            }
            Write-Host "Waiting for Docker daemon... (Attempt $i/$maxRetries)" -ForegroundColor DarkGray
        }
        
        if (-not $connected) {
            Write-Error "Docker Desktop failed to start or become responsive in time. Please start it manually and try again."
            exit 1
        }
    } else {
        Write-Error "Docker Desktop is not installed at the default path: $dockerDesktopPath. Please install/start Docker manually."
        exit 1
    }
}

Write-Host "Docker daemon is running and active!" -ForegroundColor Green

# 2. Launch MongoDB and Redis via docker-compose
Write-Host "Starting MongoDB and Redis containers..." -ForegroundColor Gray
docker-compose up -d mongodb redis

# 3. Update the MONGODB_URI in the local .env file
$envFilePath = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFilePath) {
    Write-Host "Updating MONGODB_URI in .env file to use local database..." -ForegroundColor Gray
    
    $localUri = "mongodb://admin:admin123@127.0.0.1:27017/e-invoicing-middleware?authSource=admin"
    $envContent = Get-Content $envFilePath
    $updatedContent = @()
    $uriUpdated = $false
    
    foreach ($line in $envContent) {
        if ($line -like "MONGODB_URI=*") {
            $updatedContent += "MONGODB_URI=$localUri"
            $uriUpdated = $true
        } else {
            $updatedContent += $line
        }
    }
    
    # If MONGODB_URI was not found, add it
    if (-not $uriUpdated) {
         $updatedContent += "MONGODB_URI=$localUri"
    }
    
    Set-Content -Path $envFilePath -Value $updatedContent
    Write-Host "Successfully updated MONGODB_URI in .env!" -ForegroundColor Green
} else {
    Write-Host ".env file not found. Skipping auto-updating MONGODB_URI." -ForegroundColor Yellow
}

Write-Host "`nLocal database & cache started successfully!" -ForegroundColor Green
Write-Host "MongoDB URI: mongodb://admin:admin123@127.0.0.1:27017/e-invoicing-middleware?authSource=admin" -ForegroundColor Cyan
Write-Host "Redis URL: redis://localhost:6379" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
