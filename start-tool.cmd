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

node -e "fetch('%URL%/api/load-state',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(350)}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  echo AI Image Tool is already running.
  echo Opened %URL%
  exit /b 0
)

node -e "const net=require('net'); const s=net.createServer(); s.once('error',()=>process.exit(0)); s.once('listening',()=>s.close(()=>process.exit(1))); s.listen(%PORT%,'127.0.0.1');" >nul 2>nul
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
