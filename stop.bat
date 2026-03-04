@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   =============================================
echo     devstash — shutting down
echo   =============================================
echo.

set FOUND=0

REM === Kill by PID file ===
if exist ".devstash.pid" (
    set /p PID=<.devstash.pid
    echo   Stopping server [PID !PID!]...
    taskkill /PID !PID! /T /F >nul 2>&1
    set FOUND=1
)

REM === Kill any orphan devstash-server windows ===
for /f "tokens=2" %%a in ('tasklist /fi "WINDOWTITLE eq devstash-server" /fo list 2^>nul ^| findstr "PID"') do (
    echo   Killing orphan process [PID %%a]...
    taskkill /PID %%a /T /F >nul 2>&1
    set FOUND=1
)

REM === Show port that was used ===
if exist ".devstash.port" (
    set /p PORT=<.devstash.port
    echo   Was running on port !PORT!
)

REM === Clean PID and port files ===
del ".devstash.pid" >nul 2>&1
del ".devstash.port" >nul 2>&1

if !FOUND! equ 0 (
    echo   No running devstash instance found.
)

REM === Clean temp artifacts in vault ===
echo.
echo   Cleaning temp files...

set CLEANED=0

REM Incomplete zip temp files
if exist "vault\*.tmp" (
    del /q "vault\*.tmp"
    echo     Removed incomplete zip temp files
    set CLEANED=1
)

REM Restore temp directories
for /d %%d in ("vault\_restore-tmp-*") do (
    rd /s /q "%%d" >nul 2>&1
    echo     Removed restore temp: %%~nxd
    set CLEANED=1
)

REM System temp devstash verify directories
for /d %%d in ("%TEMP%\devstash-verify-*") do (
    rd /s /q "%%d" >nul 2>&1
    echo     Removed verify temp: %%~nxd
    set CLEANED=1
)

if !CLEANED! equ 0 (
    echo     No temp files found.
)

echo.
echo   =============================================
echo     devstash stopped. All clean.
echo   =============================================
echo.
timeout /t 3 /nobreak >nul
