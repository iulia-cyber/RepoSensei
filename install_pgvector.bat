@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%
set "PGROOT=C:\Program Files\PostgreSQL\15\"
cd /d "%~dp0"
if not exist .build mkdir .build
if exist .build\pgvector rd /s /q .build\pgvector
"C:\Program Files\Git\cmd\git.exe" clone --branch v0.8.1 https://github.com/pgvector/pgvector.git .build\pgvector
if errorlevel 1 exit /b %errorlevel%
cd /d ".build\pgvector"
nmake /F Makefile.win
if errorlevel 1 exit /b %errorlevel%
nmake /F Makefile.win install
if errorlevel 1 exit /b %errorlevel%
exit /b 0
