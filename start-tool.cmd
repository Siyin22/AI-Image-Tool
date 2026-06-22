@echo off
setlocal
cd /d "%~dp0"
set "PORT=17860"
set "URL=http://127.0.0.1:%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required.
  echo Install Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Method POST -Uri '%URL%/api/load-state' -ContentType 'application/json' -Body '{}'; if ($r.StatusCode -eq 200) { exit 0 } exit 1 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  echo AI Image Tool is already running.
  echo Opened %URL%
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } exit 1" >nul 2>nul
if not errorlevel 1 (
  echo Port %PORT% is being used by another local program.
  echo Please close that program, or change PORT in this file.
  echo.
  pause
  exit /b 1
)

start "" "%URL%"
echo AI Image Tool: %URL%
echo Keep this window open. Press Ctrl+C to stop.
echo.

node "%~dp0server.js"

echo.
echo Server stopped.
echo.
pause
