@echo off
rem ============================================================
rem  Document photo -> scan  (launcher, bypasses ExecutionPolicy)
rem  Usage:  drag a photo onto this file,  or run from cmd:
rem      scan.cmd "C:\path\photo.jpg"
rem      scan.cmd "C:\path\photo.jpg" -ReadingEdge right
rem ============================================================
setlocal
set "SCRIPT="
for %%f in ("%~dp0*.ps1") do set "SCRIPT=%%~ff"

if not defined SCRIPT (
    echo [ERROR] scan.ps1 not found next to this file.
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Usage:
    echo    drag an image onto this file, or:
    echo    %~nx0 "C:\path\photo.jpg" -ReadingEdge right
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
echo.
pause
