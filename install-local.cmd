@echo off
setlocal
cd /d "%~dp0"

echo Installing Repo-Sensei dependencies...
npm.cmd install --cache .npm-cache
if %errorlevel% neq 0 (
  echo.
  echo npm install failed.
  exit /b 1
)

echo Running local setup...
node scripts\setup-local.js
if %errorlevel% neq 0 (
  echo.
  echo setup failed.
  exit /b 1
)

echo.
echo Installation complete.
echo Start with: node server.js
echo Or: npm.cmd run dev
