[CmdletBinding()]
param(
  [ValidateSet('menu', 'setup', 'local', 'public', 'status', 'backup', 'stop')]
  [string]$Action = 'menu',
  [int]$Port = 3000,
  [switch]$ForceBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $repoRoot 'backups\launcher-runtime'
$runtimePath = Join-Path $runtimeDir 'runtime.json'
$logOut = Join-Path $runtimeDir 'next.out.log'
$logErr = Join-Path $runtimeDir 'next.err.log'

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "找不到 $Name。请先安装后重试。" }
  return $command.Source
}

function Invoke-Npm([string[]]$Arguments) {
  $npm = Require-Command 'npm'
  & $npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') 执行失败" }
}

function New-SessionSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function ConvertFrom-Secure([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Initialize-Platform {
  Write-Title '首次初始化'
  Require-Command 'node' | Out-Null
  Require-Command 'npm' | Out-Null
  Push-Location $repoRoot
  try {
    $envPath = Join-Path $repoRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
      Write-Host '未找到 .env，开始创建。输入内容只写入本机 .env。' -ForegroundColor Yellow
      $provider = Read-Host 'LLM 服务商（openai/deepseek，默认 deepseek）'
      if (-not $provider) { $provider = 'deepseek' }
      if ($provider -notin @('openai', 'deepseek')) { throw '服务商只能是 openai 或 deepseek' }
      $apiKey = ConvertFrom-Secure (Read-Host 'API Key' -AsSecureString)
      if ($apiKey.Length -lt 10) { throw 'API Key 长度不正确' }
      $adminUsername = Read-Host '管理员用户名（默认 data-admin）'
      if (-not $adminUsername) { $adminUsername = 'data-admin' }
      $adminDisplayName = Read-Host '管理员显示名称（默认 数据平台主管）'
      if (-not $adminDisplayName) { $adminDisplayName = '数据平台主管' }
      $adminPassword = ConvertFrom-Secure (Read-Host '管理员密码（至少 8 位）' -AsSecureString)
      if ($adminPassword.Length -lt 8) { throw '管理员密码至少 8 位' }
      $keyName = if ($provider -eq 'openai') { 'OPENAI_API_KEY' } else { 'DEEPSEEK_API_KEY' }
      @(
        'DATABASE_URL="file:./dev.db"'
        "SESSION_SECRET=`"$(New-SessionSecret)`""
        "LLM_PROVIDER=$provider"
        "$keyName=$apiKey"
        "ADMIN_USERNAME=`"$adminUsername`""
        "ADMIN_PASSWORD=`"$adminPassword`""
        "ADMIN_DISPLAY_NAME=`"$adminDisplayName`""
      ) | Set-Content -LiteralPath $envPath -Encoding UTF8
      Write-Host '.env 已创建。' -ForegroundColor Green
    } else {
      Write-Host '检测到现有 .env，保持不变。' -ForegroundColor Green
    }

    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) {
      Invoke-Npm @('ci')
    } else {
      Write-Host '依赖已安装。'
    }

    $databasePath = Join-Path $repoRoot 'prisma\dev.db'
    if (-not (Test-Path -LiteralPath $databasePath)) {
      Invoke-Npm @('run', 'db:migrate')
      Invoke-Npm @('run', 'data-lab:init')
      Invoke-Npm @('run', 'data-lab:pilot')
    } else {
      Write-Host '检测到现有数据库，未自动迁移或重置。请先备份后再手动执行数据库维护。' -ForegroundColor Yellow
    }
    Write-Host '初始化检查完成。' -ForegroundColor Green
  } finally { Pop-Location }
}

function Test-BuildRequired {
  if ($ForceBuild) { return $true }
  $buildId = Join-Path $repoRoot '.next\BUILD_ID'
  if (-not (Test-Path -LiteralPath $buildId)) { return $true }
  $builtAt = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
  $paths = @('app', 'prisma', 'scripts', 'package.json', 'package-lock.json', 'next.config.ts', 'next.config.js')
  foreach ($relative in $paths) {
    $target = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $item = Get-Item -LiteralPath $target
    if (-not $item.PSIsContainer -and $item.LastWriteTimeUtc -gt $builtAt) { return $true }
    if ($item.PSIsContainer) {
      $newer = Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
      if ($newer) { return $true }
    }
  }
  return $false
}

function Get-Listener {
  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Start-LocalPlatform {
  Write-Title '本机运行'
  $listener = Get-Listener
  if ($listener) {
    Write-Host "服务已在 http://127.0.0.1:$Port 运行（PID $($listener.OwningProcess)）。" -ForegroundColor Green
    return
  }
  Require-Command 'node' | Out-Null
  Push-Location $repoRoot
  try {
    if (Test-BuildRequired) { Invoke-Npm @('run', 'build') }
    else { Write-Host '生产构建仍然有效，跳过 build。' }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $node = (Get-Command node).Source
    $process = Start-Process -FilePath $node -ArgumentList @('node_modules\next\dist\bin\next', 'start', '-H', '127.0.0.1', '-p', "$Port") -WorkingDirectory $repoRoot -RedirectStandardOutput $logOut -RedirectStandardError $logErr -WindowStyle Hidden -PassThru
    $ready = $false
    foreach ($attempt in 1..30) {
      Start-Sleep -Milliseconds 500
      try { if ((Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ready = $true; break } } catch { if ($process.HasExited) { break } }
    }
    if (-not $ready) { throw "服务启动失败，请查看 $logErr" }
    @{ startedAt = (Get-Date).ToString('o'); port = $Port; nextPid = $process.Id; ownsNext = $true } | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding UTF8
    Write-Host "服务已启动：http://127.0.0.1:$Port" -ForegroundColor Green
    try {
      $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 10
      if ($health.StatusCode -ne 200) { Write-Host '服务已启动，但 AI 健康检查未通过。请检查 .env 中的 API Key。' -ForegroundColor Yellow }
    } catch { Write-Host '服务已启动，但 AI 健康检查未通过。请检查 .env 中的 API Key。' -ForegroundColor Yellow }
  } finally { Pop-Location }
}

function Start-PublicPlatform {
  Write-Title '公网审核模式'
  Start-LocalPlatform
  $script = Join-Path $repoRoot 'scripts\start-data-lab-tunnel.ps1'
  & $script -Port $Port -ReuseExistingService -SkipBuild
}

function Show-PlatformStatus {
  Write-Title '运行状态'
  $listener = Get-Listener
  if ($listener) { Write-Host "本机服务：http://127.0.0.1:$Port（PID $($listener.OwningProcess)）" -ForegroundColor Green }
  else { Write-Host '本机服务未运行。' -ForegroundColor Yellow }
  try {
    $tunnel = (Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3).tunnels | Where-Object { $_.config.addr -match ":$Port$" } | Select-Object -First 1
    if ($tunnel) { Write-Host "公网地址：$($tunnel.public_url)" -ForegroundColor Cyan }
    else { Write-Host 'ngrok 未建立当前端口的隧道。' }
  } catch { Write-Host 'ngrok 未运行。' }
  Write-Host "日志目录：$runtimeDir"
}

function Backup-PlatformDatabase {
  Write-Title '备份数据库'
  Push-Location $repoRoot
  try {
    $npx = Require-Command 'npx'
    & $npx --no-install tsx scripts/backup-database.ts
    if ($LASTEXITCODE -ne 0) { throw '数据库备份失败' }
  } finally { Pop-Location }
}

function Stop-Platform {
  Write-Title '停止服务'
  $tunnelRuntime = Join-Path $repoRoot 'backups\tunnel-runtime\runtime.json'
  if (Test-Path -LiteralPath $tunnelRuntime) {
    try { & (Join-Path $repoRoot 'scripts\stop-data-lab-tunnel.ps1') -KeepApp } catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
  }
  if (Test-Path -LiteralPath $runtimePath) {
    $runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
    if ($runtime.ownsNext -and $runtime.nextPid) {
      $process = Get-Process -Id $runtime.nextPid -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $runtime.nextPid; Write-Host "已停止 Next.js PID $($runtime.nextPid)" }
    }
  }
  Write-Host '停止流程完成。' -ForegroundColor Green
}

function Show-Menu {
  while ($true) {
    Write-Title 'Hyacintech 一键启动器'
    Write-Host '1. 首次初始化'
    Write-Host '2. 本机运行'
    Write-Host '3. 公网审核（ngrok）'
    Write-Host '4. 查看状态'
    Write-Host '5. 备份数据库'
    Write-Host '6. 停止服务'
    Write-Host '0. 退出'
    switch (Read-Host '请选择') {
      '1' { Initialize-Platform }
      '2' { Start-LocalPlatform }
      '3' { Start-PublicPlatform }
      '4' { Show-PlatformStatus }
      '5' { Backup-PlatformDatabase }
      '6' { Stop-Platform }
      '0' { return }
      default { Write-Host '请输入 0-6。' -ForegroundColor Yellow }
    }
  }
}

switch ($Action) {
  'setup' { Initialize-Platform }
  'local' { Start-LocalPlatform }
  'public' { Start-PublicPlatform }
  'status' { Show-PlatformStatus }
  'backup' { Backup-PlatformDatabase }
  'stop' { Stop-Platform }
  default { Show-Menu }
}
