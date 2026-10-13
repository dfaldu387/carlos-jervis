@echo off
:: Right-click -> "Run as administrator". Replaces Windows' auto-created
:: Block rules for nginx.exe with an Allow rule on TCP 80 (private/domain networks).
netsh advfirewall firewall delete rule name=nginx
netsh advfirewall firewall add rule name="Jervis nginx 80" dir=in action=allow protocol=TCP localport=80 profile=private,domain program="C:\nginx\nginx.exe"
netsh advfirewall firewall show rule name="Jervis nginx 80"
pause
