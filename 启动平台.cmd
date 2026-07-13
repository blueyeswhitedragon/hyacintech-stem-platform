@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\launcher.ps1"
if errorlevel 1 (
  echo.
  echo 启动器执行失败，请查看上方错误信息。
  pause
)
