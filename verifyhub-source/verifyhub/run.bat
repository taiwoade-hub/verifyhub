@echo off
title VerifyHub Launcher
cls
echo ======================================================
echo           Starting VerifyHub (WSL Environment)
echo ======================================================
echo.

for /f "tokens=*" %%i in ('wsl wslpath -u "%~dp0run-wsl.sh"') do set SCRIPT_PATH=%%i

echo Running: %SCRIPT_PATH%
echo Open your browser at: http://localhost:3000
echo.

wsl.exe bash "%SCRIPT_PATH%"

pause
