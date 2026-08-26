@echo off
REM ============================================================
REM Tocify Server Starter (called by 启动Tocify.bat)
REM Starts the Vite dev server in the current folder.
REM Keep this file simple - no complex quoting, pure ASCII body.
REM ============================================================
cd /d "%~dp0"
pnpm dev
