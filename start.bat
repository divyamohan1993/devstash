@echo off
setlocal enabledelayedexpansion
title devstash
cd /d "%~dp0"

echo.
echo   =============================================
echo     devstash — starting up
echo   =============================================
echo.

REM === Kill existing instance if running ===
if exist ".devstash.pid" (
    set /p OLD_PID=<.devstash.pid
    echo   Stopping previous instance [PID !OLD_PID!]...
    taskkill /PID !OLD_PID! /T /F >nul 2>&1
    del ".devstash.pid" >nul 2>&1
    del ".devstash.port" >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM === Also kill any orphan devstash processes ===
for /f "tokens=2" %%a in ('tasklist /fi "WINDOWTITLE eq devstash-server" /fo list 2^>nul ^| findstr "PID"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)
for /f "tokens=2" %%a in ('tasklist /fi "WINDOWTITLE eq devstash-watcher" /fo list 2^>nul ^| findstr "PID"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)

REM === Check Node.js ===
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js not found. Install from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo   Node.js: %%v

REM === Check pnpm ===
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo   [INFO] pnpm not found, installing...
    npm install -g pnpm
    if !errorlevel! neq 0 (
        echo   [ERROR] Failed to install pnpm.
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('pnpm -v') do echo   pnpm:    %%v

REM === Install dependencies ===
if not exist "node_modules" (
    echo.
    echo   Installing dependencies...
    pnpm install
    if !errorlevel! neq 0 (
        echo   [ERROR] pnpm install failed.
        pause
        exit /b 1
    )
) else (
    echo.
    echo   Updating dependencies...
    pnpm install --prefer-offline >nul 2>&1
)

REM === Build ===
echo.
echo   Building...
pnpm build
if %errorlevel% neq 0 (
    echo   [ERROR] Build failed.
    pause
    exit /b 1
)

REM === Find available port (IANA private range 49152-65535) ===
set PORT=51877
set MAX_PORT=51927

:find_port
node -e "const s=require('net').createServer();s.listen(%PORT%,()=>{s.close();process.exit(0)});s.on('error',()=>process.exit(1))"
if %errorlevel% equ 0 goto port_found

echo   Port %PORT% in use, trying next...
set /a PORT+=1
if %PORT% gtr %MAX_PORT% (
    echo   [ERROR] No available port found in range 51877-51927.
    pause
    exit /b 1
)
goto find_port

:port_found
echo   Port:    %PORT%

REM === Ensure vault directory exists ===
if not exist "vault" mkdir vault

REM === Clean up temp artifacts before starting ===
if exist "vault\*.tmp" del /q "vault\*.tmp" >nul 2>&1
for /d %%d in ("vault\_restore-tmp-*") do rd /s /q "%%d" >nul 2>&1

REM === Start tsup watcher (auto-rebuilds on src/ changes) ===
start "devstash-watcher" /min pnpm dev

REM === Start server with auto-restart on dist/ changes ===
echo.
echo   Starting devstash GUI (live reload enabled)...
echo.
start "devstash-server" /b node --watch-path=dist dist/cli.js gui --port %PORT%

REM === Wait for server to be ready ===
set RETRIES=0
:wait_ready
timeout /t 1 /nobreak >nul
node -e "fetch('http://localhost:%PORT%/api/shells').then(r=>{if(r.ok)process.exit(0);process.exit(1)}).catch(()=>process.exit(1))"
if %errorlevel% equ 0 goto server_ready
set /a RETRIES+=1
if %RETRIES% geq 10 (
    echo   [ERROR] Server failed to start within 10 seconds.
    pause
    exit /b 1
)
goto wait_ready

:server_ready

REM === Save PID and port ===
for /f "tokens=2" %%a in ('tasklist /fi "WINDOWTITLE eq devstash-server" /fo list 2^>nul ^| findstr "PID"') do (
    echo %%a>".devstash.pid"
)
echo %PORT%>".devstash.port"

REM === Open browser ===
echo   =============================================
echo     devstash is running!  (live reload on)
echo     http://localhost:%PORT%
echo   =============================================
echo.
echo   GUI changes:    edit public/index.html, refresh browser
echo   Server changes: edit src/*.ts, auto-rebuilds + auto-restarts
echo.
echo   Close this window or run stop.bat to shut down.
echo.
start "" "http://localhost:%PORT%"

REM === Keep alive — wait for server process to exit ===
:keepalive
timeout /t 5 /nobreak >nul
if exist ".devstash.pid" (
    set /p CHECK_PID=<.devstash.pid
    tasklist /fi "PID eq !CHECK_PID!" 2>nul | findstr /i "node" >nul
    if !errorlevel! equ 0 goto keepalive
)

REM === Server exited ===
echo.
echo   Server stopped.
del ".devstash.pid" >nul 2>&1
del ".devstash.port" >nul 2>&1
pause
