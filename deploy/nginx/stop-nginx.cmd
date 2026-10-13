@echo off
cd /d C:\nginx
nginx.exe -s quit 2>nul || taskkill /F /IM nginx.exe >nul 2>&1
echo nginx stopped
