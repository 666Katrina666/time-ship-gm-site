@echo off
rem Game Master site: a menu to open, restart or stop the local server.
rem Without the menu: start.bat open ^| restart ^| stop ^| status [--port N]
chcp 65001 >nul
cd /d "%~dp0"
python tools\site_control.py %*
if errorlevel 1 pause
