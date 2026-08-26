@echo off
chcp 65001 >nul
title Tocify Launcher

REM ============================================================
REM Tocify Web Launcher (for distributed zip / release)
REM
REM Double-click this script:
REM   - Checks Node.js environment (installs dependencies on first run)
REM   - Starts the dev server in a separate window
REM   - Opens http://localhost:5173 when ready
REM   - Close the "Tocify Server" window to stop
REM
REM Works from ANY folder (uses relative path, so the zip can be
REM extracted anywhere, e.g. D:\Tocify or Desktop).
REM ============================================================

REM ---- Switch to this script's directory ----
cd /d "%~dp0"

REM ---- Step 1: already running? (port 5173) ----
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [Info] Tocify is already running. Opening browser...
    start "" "http://localhost:5173/"
    timeout /t 2 >nul
    exit /b 0
)

REM ---- Step 2: check Node.js ----
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found!
    echo [Hint] Please install the LTS version from https://nodejs.org
    echo        and check "Add to PATH" during installation.
    pause
    exit /b 1
)

REM ---- Step 3: check pnpm (install via npm if missing) ----
pnpm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [Info] pnpm not found, installing via npm (needs internet)...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [Error] pnpm install failed. Check network and retry.
        pause
        exit /b 1
    )
)

REM ---- Step 4: install dependencies (skip if node_modules exists) ----
if not exist "node_modules" (
    echo [Info] First run: installing dependencies (3-10 min, needs internet)...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [Error] Install failed. Check network and retry.
        pause
        exit /b 1
    )
)

REM ---- Step 5: start server in new window ----
echo [Info] Starting Tocify server, please wait...
start "Tocify Server (close this window to stop)" cmd /c "start-server.bat"

REM ---- Step 6: wait for port (max 30s) ----
set /a count=0
:waitloop
timeout /t 1 >nul
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto ready
set /a count+=1
if %count% lss 30 goto waitloop

echo [Warn] Server start timed out. Check the server window for errors.
pause
exit /b 1

:ready
echo [OK] Tocify is up. Opening browser...
start "" "http://localhost:5173/"
timeout /t 2 >nul
exit /b 0
