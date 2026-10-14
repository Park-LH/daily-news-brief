@echo off
rem One-click launcher: starts local server and opens browser
rem It calls start-server.ps1 in the same folder
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
pause
