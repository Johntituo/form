@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
  echo [FORM] 首次使用，请先复制 .env.example 为 .env 并设置密码，
  echo 或在 PowerShell 中运行：powershell -ExecutionPolicy Bypass -File setup-local.ps1
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [FORM] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
call npm start
pause
