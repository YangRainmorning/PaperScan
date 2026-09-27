@echo off
rem ===========================================================================
rem  PaperScan launcher for Windows.
rem
rem  Drag one or more photos onto this file, or run it from cmd:
rem
rem      paperscan.cmd "C:\photos\certificate.jpg"
rem      paperscan.cmd "C:\photos\*.jpg" --reading-edge right
rem
rem  It uses a published build from .\dist if one exists, otherwise the last
rem  build output, otherwise it builds a self-contained binary first.
rem ===========================================================================
setlocal EnableDelayedExpansion
set "HERE=%~dp0"
set "ROOT=%HERE%.."

if "%~1"=="" (
    echo PaperScan - turn photos of documents into scans.
    echo.
    echo Drag one or more photos onto this file, or run:
    echo     %~nx0 "C:\photos\certificate.jpg" [options]
    echo.
    echo Run "paperscan --help" for the full option list.
    echo.
    pause
    exit /b 1
)

set "EXE="
for %%c in ("%ROOT%\dist\paperscan.exe" "%ROOT%\src\PaperScan.Cli\bin\Release\net8.0\paperscan.exe" "%ROOT%\src\PaperScan.Cli\bin\Debug\net8.0\paperscan.exe") do (
    if not defined EXE if exist "%%~c" set "EXE=%%~c"
)

if not defined EXE (
    echo No build found - building one now ^(this happens only once^)...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%build.ps1" -Publish -SelfContained
    if exist "%ROOT%\dist\paperscan.exe" set "EXE=%ROOT%\dist\paperscan.exe"
)

if not defined EXE (
    echo.
    echo [ERROR] Build did not produce paperscan.exe. See the output above.
    pause
    exit /b 1
)

"%EXE%" %*
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%
