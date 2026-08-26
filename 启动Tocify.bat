@echo off
title Tocify Server
cd /d "%~dp0"

REM ============================================================
REM Tocify Web Launcher
REM Double-click to start. THIS window is the server window.
REM Browser opens automatically when the server is ready.
REM Close this window to stop the server.
REM ============================================================

REM ---- Step 1: already running? just open the browser ----
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Tocify is already running. Opening browser...
    start "" "http://localhost:5173/"
    exit /b 0
)

REM ---- Step 2: check Node.js ----
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo [HINT] Install the LTS version from https://nodejs.org
    echo        Remember to check "Add to PATH" during installation.
    pause
    exit /b 1
)

REM ---- Step 3: check pnpm ----
call pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [INFO] pnpm not found. Installing via npm, needs internet...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] pnpm installation failed. Check your network.
        pause
        exit /b 1
    )
)

REM ---- Step 4: install dependencies on first run ----
if not exist "node_modules" (
    echo [INFO] First run: installing dependencies, 3-10 min, please wait...
    call pnpm install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed. Check your network.
        pause
        exit /b 1
    )
)

REM ---- Step 5: start the server in THIS window ----
echo.
echo ============================================================
echo   Starting Tocify ...
echo   The browser will open automatically when ready.
echo   Keep this window open while using Tocify.
echo   CLOSE THIS WINDOW TO STOP THE SERVER.
echo ============================================================
echo.
call pnpm dev --open

echo.
echo [INFO] Server stopped.
pause
