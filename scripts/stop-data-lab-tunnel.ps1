[CmdletBinding()]
param(
  [switch]$KeepApp
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimePath = Join-Path $repoRoot 'backups\tunnel-runtime\runtime.json'

if (-not (Test-Path -LiteralPath $runtimePath)) {
  throw "找不到运行状态文件：$runtimePath"
}

$runtime = Get-Content -Raw -LiteralPath $runtimePath | ConvertFrom-Json

if ($runtime.ownsNgrok -and $runtime.ngrokPid) {
  $process = Get-Process -Id $runtime.ngrokPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'ngrok') {
    Stop-Process -Id $runtime.ngrokPid
    Write-Host "已停止 ngrok PID $($runtime.ngrokPid)"
  }
}

if (-not $KeepApp -and $runtime.ownsNext -and $runtime.nextPid) {
  $process = Get-Process -Id $runtime.nextPid -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'node') {
    Stop-Process -Id $runtime.nextPid
    Write-Host "已停止 Next.js PID $($runtime.nextPid)"
  }
}

$runtime | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
$runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimePath -Encoding UTF8
Write-Host '隧道停止流程完成。'
