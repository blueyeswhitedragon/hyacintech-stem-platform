[CmdletBinding()]
param(
  [int]$Port = 3000,
  [string]$PolicyPath = "$env:LOCALAPPDATA\ngrok\hyacintech-policy.yml",
  [switch]$SkipBuild,
  [switch]$ReuseExistingService
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $repoRoot 'backups\tunnel-runtime'
$runtimePath = Join-Path $runtimeDir 'runtime.json'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$npmCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "找不到 Node.js：$nodePath"
}
if (-not (Test-Path -LiteralPath $npmCli)) {
  throw "找不到 npm CLI：$npmCli"
}
if (-not (Test-Path -LiteralPath $PolicyPath)) {
  throw "找不到 ngrok Traffic Policy：$PolicyPath"
}

$ngrokCommand = Get-Command ngrok -ErrorAction Stop
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

Push-Location $repoRoot
try {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  $ownsNext = $false
  $nextPid = $null

  if ($listener) {
    if (-not $ReuseExistingService) {
      throw "端口 $Port 已被 PID $($listener.OwningProcess) 占用。确认现有服务后使用 -ReuseExistingService，或先停止它。"
    }
    $nextPid = $listener.OwningProcess
  } else {
    if (-not $SkipBuild) {
      & $nodePath $npmCli run build
      if ($LASTEXITCODE -ne 0) { throw 'Next.js 生产构建失败' }
    }

    $env:NODE_ENV = 'production'
    $nextProcess = Start-Process -FilePath $nodePath `
      -ArgumentList @('node_modules\next\dist\bin\next', 'start', '-H', '127.0.0.1', '-p', "$Port") `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $runtimeDir 'next.out.log') `
      -RedirectStandardError (Join-Path $runtimeDir 'next.err.log') `
      -WindowStyle Hidden `
      -PassThru
    $nextPid = $nextProcess.Id
    $ownsNext = $true

    $ready = $false
    foreach ($attempt in 1..30) {
      Start-Sleep -Milliseconds 500
      try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
      } catch {
        if ($nextProcess.HasExited) { break }
      }
    }
    if (-not $ready) {
      throw "Next.js 未能在端口 $Port 启动。查看 $runtimeDir\next.err.log"
    }
  }

  $tunnel = $null
  try {
    $tunnel = (Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3).tunnels |
      Where-Object { $_.config.addr -match ":$Port$" } |
      Select-Object -First 1
  } catch { }

  $ownsNgrok = $false
  $ngrokPid = $null
  if (-not $tunnel) {
    $ngrokProcess = Start-Process -FilePath $ngrokCommand.Source `
      -ArgumentList @('http', "$Port", '--traffic-policy-file', $PolicyPath, '--log', 'stdout', '--log-format', 'json') `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput (Join-Path $runtimeDir 'ngrok.out.log') `
      -RedirectStandardError (Join-Path $runtimeDir 'ngrok.err.log') `
      -WindowStyle Hidden `
      -PassThru
    $ngrokPid = $ngrokProcess.Id
    $ownsNgrok = $true

    foreach ($attempt in 1..30) {
      Start-Sleep -Milliseconds 500
      try {
        $tunnel = (Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3).tunnels |
          Where-Object { $_.config.addr -match ":$Port$" } |
          Select-Object -First 1
        if ($tunnel) { break }
      } catch {
        if ($ngrokProcess.HasExited) { break }
      }
    }
    if (-not $tunnel) {
      throw "ngrok 未能建立隧道。查看 $runtimeDir\ngrok.err.log"
    }
  } else {
    $ngrokProcess = Get-Process ngrok -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ngrokProcess) { $ngrokPid = $ngrokProcess.Id }
  }

  $runtime = [ordered]@{
    startedAt = (Get-Date).ToString('o')
    port = $Port
    publicUrl = $tunnel.public_url
    nextPid = $nextPid
    ngrokPid = $ngrokPid
    ownsNext = $ownsNext
    ownsNgrok = $ownsNgrok
    policyPath = $PolicyPath
  }
  $runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding UTF8

  Write-Host ''
  Write-Host 'Hyacintech Data Lab 已上线：' -ForegroundColor Green
  Write-Host $tunnel.public_url -ForegroundColor Cyan
  Write-Host "运行状态：$runtimePath"
  Write-Host "停止命令：powershell -ExecutionPolicy Bypass -File .\scripts\stop-data-lab-tunnel.ps1"
} finally {
  Pop-Location
}
