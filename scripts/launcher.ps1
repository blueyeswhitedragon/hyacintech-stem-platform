[CmdletBinding()]
param(
  [ValidateSet('menu', 'setup', 'local', 'public', 'status', 'doctor', 'backup', 'stop')]
  [string]$Action = 'menu',
  [int]$Port = 3000,
  [string]$BindHost = '127.0.0.1',
  [string]$NgrokApiBase = '',
  [switch]$ForceBuild,
  [switch]$SkipDemoSeed,
  [switch]$AllowDegraded
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = Join-Path $repoRoot 'backups\launcher-runtime'
$runtimePath = Join-Path $runtimeDir 'runtime.json'
$lockHashPath = Join-Path $runtimeDir 'package-lock.sha256'
$logOut = Join-Path $runtimeDir 'next.out.log'
$logErr = Join-Path $runtimeDir 'next.err.log'
$envPath = Join-Path $repoRoot '.env'
if (-not $NgrokApiBase) {
  $NgrokApiBase = if ($env:NGROK_API_BASE) { $env:NGROK_API_BASE } else { 'http://127.0.0.1:4040' }
}
$NgrokApiBase = $NgrokApiBase.TrimEnd('/')
$serviceBase = "http://${BindHost}:$Port"

function Write-Title([string]$Text) {
  Write-Host ''
  Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Resolve-Command([string]$Name) {
  $preferred = if ($Name -in @('npm', 'npx')) { "$Name.cmd" } else { $Name }
  $command = Get-Command $preferred -ErrorAction SilentlyContinue
  if (-not $command) { $command = Get-Command $Name -ErrorAction SilentlyContinue }
  if (-not $command) { throw "找不到 $Name。请先安装后重试。" }
  return $command.Source
}

function Invoke-Npm([string[]]$Arguments) {
  $npm = Resolve-Command 'npm'
  & $npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') 执行失败" }
}

function New-RandomSecret {
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

function Quote-DotEnv([string]$Value) {
  if ($Value.Contains("`r") -or $Value.Contains("`n")) { throw '.env 值不能包含换行符' }
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
  return "`"$escaped`""
}

function Read-DotEnv {
  $values = @{}
  if (-not (Test-Path -LiteralPath $envPath)) { return $values }
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2).Replace('\"', '"').Replace('\\', '\')
    } elseif ($value.Length -ge 2 -and $value.StartsWith("'") -and $value.EndsWith("'")) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
  }
  return $values
}

function Import-DotEnv {
  $values = Read-DotEnv
  foreach ($name in $values.Keys) {
    if ([Environment]::GetEnvironmentVariable($name, 'Process') -eq $null) {
      [Environment]::SetEnvironmentVariable($name, [string]$values[$name], 'Process')
    }
  }
  return $values
}

function Get-Setting([string]$Name, [hashtable]$Values) {
  $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($processValue -ne $null) { return $processValue }
  if ($Values.ContainsKey($Name)) { return [string]$Values[$Name] }
  return ''
}

function Test-PlaceholderKey([string]$Value) {
  return -not $Value -or $Value.Length -lt 10 -or $Value -match '(?i)sk-your|your-api-key|placeholder|change-me|put-your'
}

function Assert-PlatformConfig {
  $values = Import-DotEnv
  $databaseUrl = Get-Setting 'DATABASE_URL' $values
  if (-not $databaseUrl) { throw 'DATABASE_URL 未配置' }
  $sessionSecret = Get-Setting 'SESSION_SECRET' $values
  if ($sessionSecret.Length -lt 32 -or $sessionSecret -match '(?i)please-change|change-me|placeholder') {
    throw 'SESSION_SECRET 必须是至少 32 字符的非占位随机值'
  }

  $openAiKey = Get-Setting 'OPENAI_API_KEY' $values
  $deepSeekKey = Get-Setting 'DEEPSEEK_API_KEY' $values
  $hasOpenAi = -not (Test-PlaceholderKey $openAiKey)
  $hasDeepSeek = -not (Test-PlaceholderKey $deepSeekKey)
  $provider = (Get-Setting 'LLM_PROVIDER' $values).Trim().ToLowerInvariant()
  if ($provider -and $provider -notin @('openai', 'deepseek')) {
    throw 'LLM_PROVIDER 只支持 openai 或 deepseek'
  }
  if (-not $provider) {
    if ($hasOpenAi -and $hasDeepSeek) { throw '检测到两家真实密钥，请显式设置 LLM_PROVIDER' }
    if ($hasOpenAi) { $provider = 'openai' }
    elseif ($hasDeepSeek) { $provider = 'deepseek' }
    else { throw '未检测到有效的 OPENAI_API_KEY 或 DEEPSEEK_API_KEY' }
  }
  if ($provider -eq 'openai' -and -not $hasOpenAi) { throw 'LLM_PROVIDER=openai，但 OPENAI_API_KEY 无效' }
  if ($provider -eq 'deepseek' -and -not $hasDeepSeek) { throw 'LLM_PROVIDER=deepseek，但 DEEPSEEK_API_KEY 无效' }

  $model = (Get-Setting 'LLM_MODEL' $values).Trim()
  if (-not $model) {
    $model = if ($provider -eq 'deepseek') { 'deepseek-v4-pro' } else { 'gpt-4o' }
    Write-Host "未显式设置 LLM_MODEL，将使用兼容默认值 $model。" -ForegroundColor Yellow
  }
  $timeoutValue = Get-Setting 'LLM_TIMEOUT_MS' $values
  $timeoutMs = if ($timeoutValue) { $parsed = 0; if ([int]::TryParse($timeoutValue, [ref]$parsed)) { $parsed } else { 0 } } else { 180000 }
  if ($timeoutMs -lt 180000) { throw 'LLM_TIMEOUT_MS 的有效值必须至少为 180000' }

  $adminValues = @(
    Get-Setting 'ADMIN_USERNAME' $values
    Get-Setting 'ADMIN_PASSWORD' $values
    Get-Setting 'ADMIN_DISPLAY_NAME' $values
  )
  $adminConfigured = ($adminValues | Where-Object { $_ }).Count
  if ($adminConfigured -notin @(0, 3)) { throw 'ADMIN_USERNAME、ADMIN_PASSWORD、ADMIN_DISPLAY_NAME 必须同时配置或同时省略' }

  return [pscustomobject]@{
    DatabaseUrl = $databaseUrl
    Provider = $provider
    Model = $model
    TimeoutMs = $timeoutMs
    AdminConfigured = $adminConfigured -eq 3
  }
}

function Initialize-EnvironmentFile {
  if (Test-Path -LiteralPath $envPath) {
    Write-Host '检测到现有 .env，将校验但不覆盖。' -ForegroundColor Green
    return
  }

  Write-Host '未找到 .env，开始创建。输入内容只写入本机 .env。' -ForegroundColor Yellow
  $provider = Read-Host 'LLM 服务商（openai/deepseek，默认 deepseek）'
  if (-not $provider) { $provider = 'deepseek' }
  $provider = $provider.Trim().ToLowerInvariant()
  if ($provider -notin @('openai', 'deepseek')) { throw '服务商只能是 openai 或 deepseek' }
  $defaultModel = if ($provider -eq 'deepseek') { 'deepseek-v4-pro' } else { 'gpt-4o' }
  $model = Read-Host "远程 model ID（默认 $defaultModel）"
  if (-not $model) { $model = $defaultModel }
  $apiBase = Read-Host '自定义 API Base URL（官方地址可留空）'
  $apiKey = ConvertFrom-Secure (Read-Host 'API Key' -AsSecureString)
  if (Test-PlaceholderKey $apiKey) { throw 'API Key 长度不正确或仍是占位值' }
  $adminUsername = Read-Host '管理员用户名（默认 data-admin）'
  if (-not $adminUsername) { $adminUsername = 'data-admin' }
  $adminDisplayName = Read-Host '管理员显示名称（默认 数据平台主管）'
  if (-not $adminDisplayName) { $adminDisplayName = '数据平台主管' }
  $adminPassword = ConvertFrom-Secure (Read-Host '管理员密码（至少 8 位）' -AsSecureString)
  if ($adminPassword.Length -lt 8) { throw '管理员密码至少 8 位' }
  $keyName = if ($provider -eq 'openai') { 'OPENAI_API_KEY' } else { 'DEEPSEEK_API_KEY' }
  $baseName = if ($provider -eq 'openai') { 'OPENAI_API_BASE' } else { 'DEEPSEEK_API_BASE' }
  $lines = @(
    "DATABASE_URL=$(Quote-DotEnv 'file:./dev.db')"
    "SESSION_SECRET=$(Quote-DotEnv (New-RandomSecret))"
    "LLM_PROVIDER=$(Quote-DotEnv $provider)"
    "LLM_MODEL=$(Quote-DotEnv $model)"
    "LLM_MODEL_TAG=$(Quote-DotEnv "${provider}:$model")"
    "LLM_TIMEOUT_MS=$(Quote-DotEnv '180000')"
    "$keyName=$(Quote-DotEnv $apiKey)"
  )
  if ($apiBase) { $lines += "$baseName=$(Quote-DotEnv $apiBase.Trim())" }
  $lines += @(
    "ADMIN_USERNAME=$(Quote-DotEnv $adminUsername)"
    "ADMIN_PASSWORD=$(Quote-DotEnv $adminPassword)"
    "ADMIN_DISPLAY_NAME=$(Quote-DotEnv $adminDisplayName)"
    "DATA_LAB_CREDENTIAL_MASTER_KEY=$(Quote-DotEnv (New-RandomSecret))"
  )
  $lines | Set-Content -LiteralPath $envPath -Encoding UTF8
  Write-Host '.env 已创建，并显式固定 provider、model 与稳定标签。' -ForegroundColor Green
}

function Get-LockHash {
  $lockPath = Join-Path $repoRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $lockPath)) { return '' }
  return (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash
}

function Initialize-Dependencies {
  $currentHash = Get-LockHash
  $recordedHash = if (Test-Path -LiteralPath $lockHashPath) { (Get-Content -Raw -LiteralPath $lockHashPath).Trim() } else { '' }
  $needsInstall = -not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules')) -or $currentHash -ne $recordedHash
  if (-not $needsInstall) {
    Write-Host '依赖与 package-lock.json 一致。'
    return
  }
  Invoke-Npm @('ci')
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $currentHash | Set-Content -LiteralPath $lockHashPath -Encoding ASCII
}

function Get-ConfiguredDatabasePath([string]$DatabaseUrl) {
  if (-not $DatabaseUrl.StartsWith('file:')) { return $null }
  $configured = $DatabaseUrl.Substring(5).Split('?')[0]
  if ([IO.Path]::IsPathRooted($configured)) { return [IO.Path]::GetFullPath($configured) }
  return [IO.Path]::GetFullPath((Join-Path (Join-Path $repoRoot 'prisma') $configured))
}

function Backup-SqliteBeforeDeploy([string]$DatabaseUrl) {
  $databasePath = Get-ConfiguredDatabasePath $DatabaseUrl
  if (-not $databasePath -or -not (Test-Path -LiteralPath $databasePath)) { return }
  $backupDir = Join-Path $repoRoot ("backups\pre-deploy\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($source in @($databasePath, "$databasePath-wal", "$databasePath-shm")) {
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir ([IO.Path]::GetFileName($source)))
    }
  }
  Write-Host "迁移前 SQLite 备份：$backupDir" -ForegroundColor Green
}

function Invoke-DatabaseSetup([pscustomobject]$Config) {
  Backup-SqliteBeforeDeploy $Config.DatabaseUrl
  Invoke-Npm @('run', 'db:deploy')
  if (-not $SkipDemoSeed) { Invoke-Npm @('run', 'db:seed') }
  if ($Config.AdminConfigured) { Invoke-Npm @('run', 'data-lab:init') }
  else { Write-Host '未配置 Data Lab 管理员，跳过 data-lab:init。' -ForegroundColor Yellow }
  Invoke-Npm @('run', 'model:bootstrap')
}

function Test-TcpListener {
  try {
    return [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port
  } catch {
    throw "无法检查端口 $Port：$($_.Exception.Message)"
  }
}

function Get-PlatformHealth([switch]$ReadinessOnly) {
  $suffix = if ($ReadinessOnly) { '?mode=readiness' } else { '' }
  $response = Invoke-WebRequest `
    -Uri "$serviceBase/api/health$suffix" `
    -UseBasicParsing `
    -TimeoutSec $(if ($ReadinessOnly) { 5 } else { 35 })
  $bytes = $response.RawContentStream.ToArray()
  return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
}

function Assert-NodeVersion {
  $node = Resolve-Command 'node'
  $raw = (& $node --version).Trim().TrimStart('v')
  $version = [version]$raw
  if ($version -lt [version]'20.9.0') { throw "Node.js 版本过低：$version；需要 20.9.0 或更高版本" }
  return $node
}

function Show-Doctor {
  Write-Title '部署预检'
  Push-Location $repoRoot
  try {
    $node = Assert-NodeVersion
    $npm = Resolve-Command 'npm'
    if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env；请先执行首次初始化' }
    $config = Assert-PlatformConfig
    $databasePath = Get-ConfiguredDatabasePath $config.DatabaseUrl
    Write-Host "Node.js：$(& $node --version)" -ForegroundColor Green
    Write-Host "npm：$(& $npm --version)" -ForegroundColor Green
    Write-Host "模型：$($config.Provider) / $($config.Model)" -ForegroundColor Green
    Write-Host "有效超时：$($config.TimeoutMs) ms" -ForegroundColor Green
    if ($databasePath) {
      Write-Host "SQLite：$databasePath（$(if (Test-Path -LiteralPath $databasePath) { '已存在' } else { '尚未创建' })）"
    }
    Write-Host '敏感值未显示。部署前置配置通过。' -ForegroundColor Green
  } finally { Pop-Location }
}

function Initialize-Platform {
  Write-Title '首次初始化 / 安全升级'
  Assert-NodeVersion | Out-Null
  Resolve-Command 'npm' | Out-Null
  Push-Location $repoRoot
  try {
    Initialize-EnvironmentFile
    Initialize-Dependencies
    $config = Assert-PlatformConfig
    Invoke-DatabaseSetup $config
    Write-Host '初始化与安全升级完成。未自动创建旧 Pilot 数据。' -ForegroundColor Green
  } finally { Pop-Location }
}

function Test-BuildRequired {
  if ($ForceBuild) { return $true }
  $requiredArtifacts = @(
    (Join-Path $repoRoot '.next\BUILD_ID'),
    (Join-Path $repoRoot '.next\prerender-manifest.json'),
    (Join-Path $repoRoot '.next\routes-manifest.json'),
    (Join-Path $repoRoot '.next\required-server-files.json')
  )
  foreach ($artifact in $requiredArtifacts) {
    if (-not (Test-Path -LiteralPath $artifact)) { return $true }
  }
  $buildId = $requiredArtifacts[0]
  $builtAt = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
  $paths = @(
    'app', 'prisma', 'public', 'package.json', 'package-lock.json',
    'tsconfig.json', 'postcss.config.mjs', 'next.config.ts', 'next.config.js', '.env'
  )
  foreach ($relative in $paths) {
    $target = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $item = Get-Item -LiteralPath $target
    if (-not $item.PSIsContainer -and $item.LastWriteTimeUtc -gt $builtAt) { return $true }
    if ($item.PSIsContainer) {
      $newer = Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $builtAt } |
        Select-Object -First 1
      if ($newer) { return $true }
    }
  }
  return $false
}

function Remove-RuntimeRecord {
  if (Test-Path -LiteralPath $runtimePath) { Remove-Item -LiteralPath $runtimePath -Force }
}

function Stop-OwnedNext([object]$Runtime) {
  if (-not $Runtime.ownsNext -or -not $Runtime.nextPid) { return $false }
  $process = Get-Process -Id $Runtime.nextPid -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  if ($process.ProcessName -ne 'node') { throw "PID $($Runtime.nextPid) 已不是 node，拒绝停止" }
  if ($Runtime.nextProcessStartedAt) {
    $expected = [datetime]::Parse($Runtime.nextProcessStartedAt).ToUniversalTime()
    $actual = $process.StartTime.ToUniversalTime()
    if ([Math]::Abs(($actual - $expected).TotalSeconds) -gt 2) {
      throw "PID $($Runtime.nextPid) 的启动时间不匹配，拒绝停止可能被复用的进程"
    }
  }
  Stop-Process -Id $Runtime.nextPid
  Write-Host "已停止 Next.js PID $($Runtime.nextPid)"
  return $true
}

function Start-LocalPlatform {
  Write-Title '本机运行'
  $node = Assert-NodeVersion
  Resolve-Command 'npm' | Out-Null
  Push-Location $repoRoot
  $ownedProcess = $null
  try {
    if (-not (Test-Path -LiteralPath $envPath)) { throw '缺少 .env；请先执行首次初始化' }
    Initialize-Dependencies
    Assert-PlatformConfig | Out-Null
    if (Test-TcpListener) {
      try {
        $existing = Get-PlatformHealth -ReadinessOnly
        if ($existing.service -eq 'hyacintech-stem-platform') {
          Write-Host "平台已在 $serviceBase 运行。" -ForegroundColor Green
          return
        }
      } catch { }
      throw "端口 $Port 已被其他服务占用"
    }

    Invoke-Npm @('run', 'model:bootstrap')
    if (Test-BuildRequired) { Invoke-Npm @('run', 'build') }
    else { Write-Host '生产构建仍然有效，跳过 build。' }

    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $ownedProcess = Start-Process -FilePath $node `
      -ArgumentList @('node_modules\next\dist\bin\next', 'start', '-H', $BindHost, '-p', "$Port") `
      -WorkingDirectory $repoRoot `
      -RedirectStandardOutput $logOut `
      -RedirectStandardError $logErr `
      -WindowStyle Hidden `
      -PassThru

    $ready = $false
    foreach ($attempt in 1..60) {
      Start-Sleep -Milliseconds 500
      try {
        $health = Get-PlatformHealth -ReadinessOnly
        if ($health.service -eq 'hyacintech-stem-platform') { $ready = $true; break }
      } catch {
        if ($ownedProcess.HasExited) { break }
      }
    }
    if (-not $ready) { throw "服务启动失败，请查看 $logErr" }

    $runtime = [ordered]@{
      startedAt = (Get-Date).ToString('o')
      port = $Port
      bindHost = $BindHost
      nextPid = $ownedProcess.Id
      nextProcessStartedAt = $ownedProcess.StartTime.ToUniversalTime().ToString('o')
      nodePath = $node
      ownsNext = $true
    }
    $runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding UTF8

    $fullHealth = Get-PlatformHealth
    if ($fullHealth.service -ne 'hyacintech-stem-platform') { throw '健康检查返回了非 Hyacintech 服务' }
    if ($fullHealth.status -ne 'healthy') {
      $detail = @($fullHealth.checks.config.detail, $fullHealth.checks.connectivity.detail, $fullHealth.checks.auth.detail) |
        Where-Object { $_ } |
        Select-Object -Unique
      Write-Host "平台已启动，但模型健康状态为 $($fullHealth.status)：$($detail -join '；')" -ForegroundColor Yellow
      if (-not $AllowDegraded) {
        Stop-OwnedNext $runtime | Out-Null
        Remove-RuntimeRecord
        $ownedProcess = $null
        throw '模型健康检查未通过；如只需进入管理页排障，可使用 -AllowDegraded'
      }
    }
    Write-Host "服务已启动：$serviceBase" -ForegroundColor Green
    $ownedProcess = $null
  } catch {
    if ($ownedProcess -and -not $ownedProcess.HasExited) {
      Stop-Process -Id $ownedProcess.Id -ErrorAction SilentlyContinue
    }
    throw
  } finally { Pop-Location }
}

function Start-PublicPlatform {
  Write-Title '公网审核模式'
  Resolve-Command 'ngrok' | Out-Null
  $policyPath = Join-Path $env:LOCALAPPDATA 'ngrok\hyacintech-policy.yml'
  if (-not (Test-Path -LiteralPath $policyPath)) { throw "找不到 ngrok Traffic Policy：$policyPath" }
  Start-LocalPlatform
  $script = Join-Path $repoRoot 'scripts\start-data-lab-tunnel.ps1'
  & $script -Port $Port -BindHost $BindHost -NgrokApiBase $NgrokApiBase -ReuseExistingService -SkipBuild
}

function Show-PlatformStatus {
  Write-Title '运行状态'
  if (-not (Test-TcpListener)) {
    Write-Host '本机服务未运行。' -ForegroundColor Yellow
  } else {
    try {
      $health = Get-PlatformHealth -ReadinessOnly
      if ($health.service -eq 'hyacintech-stem-platform') {
        Write-Host "本机平台：$serviceBase（配置状态 $($health.status)）" -ForegroundColor Green
      } else {
        Write-Host "端口 $Port 被非 Hyacintech 服务占用。" -ForegroundColor Yellow
      }
    } catch {
      Write-Host "端口 $Port 有监听，但无法确认服务身份。" -ForegroundColor Yellow
    }
  }
  try {
    $tunnel = (Invoke-RestMethod -Uri "$NgrokApiBase/api/tunnels" -TimeoutSec 3).tunnels |
      Where-Object { $_.config.addr -match ":$Port$" } |
      Select-Object -First 1
    if ($tunnel) { Write-Host "公网地址：$($tunnel.public_url)" -ForegroundColor Cyan }
    else { Write-Host 'ngrok 未建立当前端口的隧道。' }
  } catch { Write-Host 'ngrok 未运行。' }
  Write-Host "日志目录：$runtimeDir"
}

function Backup-PlatformDatabase {
  Write-Title '备份数据库'
  Push-Location $repoRoot
  try {
    $npx = Resolve-Command 'npx'
    & $npx --no-install tsx scripts/backup-database.ts
    if ($LASTEXITCODE -ne 0) { throw '数据库备份失败' }
  } finally { Pop-Location }
}

function Stop-Platform {
  Write-Title '停止服务'
  $tunnelRuntime = Join-Path $repoRoot 'backups\tunnel-runtime\runtime.json'
  if (Test-Path -LiteralPath $tunnelRuntime) {
    try { & (Join-Path $repoRoot 'scripts\stop-data-lab-tunnel.ps1') -KeepApp }
    catch { Write-Host $_.Exception.Message -ForegroundColor Yellow }
  }
  if (Test-Path -LiteralPath $runtimePath) {
    $runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json
    Stop-OwnedNext $runtime | Out-Null
    Remove-RuntimeRecord
  } else {
    Write-Host '没有找到本启动器拥有的 Next.js 进程记录。'
  }
  Write-Host '停止流程完成。' -ForegroundColor Green
}

function Show-Menu {
  while ($true) {
    Write-Title 'Hyacintech 一键启动器'
    Write-Host '1. 首次初始化 / 安全升级'
    Write-Host '2. 本机运行'
    Write-Host '3. 公网审核（ngrok）'
    Write-Host '4. 查看状态'
    Write-Host '5. 备份数据库'
    Write-Host '6. 停止服务'
    Write-Host '7. 部署预检'
    Write-Host '0. 退出'
    switch (Read-Host '请选择') {
      '1' { Initialize-Platform }
      '2' { Start-LocalPlatform }
      '3' { Start-PublicPlatform }
      '4' { Show-PlatformStatus }
      '5' { Backup-PlatformDatabase }
      '6' { Stop-Platform }
      '7' { Show-Doctor }
      '0' { return }
      default { Write-Host '请输入 0-7。' -ForegroundColor Yellow }
    }
  }
}

switch ($Action) {
  'setup' { Initialize-Platform }
  'local' { Start-LocalPlatform }
  'public' { Start-PublicPlatform }
  'status' { Show-PlatformStatus }
  'doctor' { Show-Doctor }
  'backup' { Backup-PlatformDatabase }
  'stop' { Stop-Platform }
  default { Show-Menu }
}
