@echo off
rem Launcher for 启动服务-局域网.ps1
rem Double-click this file -> UAC prompt -> click Yes -> it prints the phone URL.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动服务-局域网.ps1"
echo.
echo ==== done (press any key to close) ====
pause >nul
