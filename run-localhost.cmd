@echo off
cd /d "%~dp0"
echo Starting Repo-Sensei...
echo Open:
echo   http://localhost:4173
echo   http://127.0.0.1:4173
node server.js
if %errorlevel% neq 0 (
  echo.
  echo Server failed to start. Check the error above.
  pause
)
