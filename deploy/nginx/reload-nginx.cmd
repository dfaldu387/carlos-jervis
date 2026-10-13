@echo off
cd /d C:\nginx
copy /Y "%~dp0jervis.conf" conf\conf.d\jervis.conf >nul
nginx.exe -t && nginx.exe -s reload && echo nginx reloaded
