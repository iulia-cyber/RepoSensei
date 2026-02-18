@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Repo-Sensei diagnostics
echo =======================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [FAIL] Node.js is not on PATH.
  echo Install Node.js 20+ and reopen terminal.
  pause
  exit /b 1
)

echo [OK] Node detected:
node -v
echo.

echo Starting server in background...
start "Repo-Sensei-Server" /min cmd /c "cd /d %~dp0 && node server.js > .server.log 2>&1"

echo Waiting for server...
timeout /t 3 /nobreak >nul

echo.
echo Health check:
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/api/health -TimeoutSec 3; Write-Output ('[OK] /api/health status: ' + $r.StatusCode) } catch { Write-Output ('[FAIL] ' + $_.Exception.Message) }"

echo.
echo Port check:
netstat -ano | findstr :4173
if %errorlevel% neq 0 (
  echo [FAIL] Nothing is listening on port 4173.
) else (
  echo [OK] Port 4173 has activity above.
)

echo.
echo If health check failed, open .server.log for startup error details.
echo If health check passed, open:
echo   http://127.0.0.1:4173
echo   http://localhost:4173
echo.
pause
