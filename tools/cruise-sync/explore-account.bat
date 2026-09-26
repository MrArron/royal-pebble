@echo off
REM Test tool: logs in and saves every piece of data your Royal Caribbean login can reach.
REM Writes a royal-pebble-explore-<time> folder. report.txt is safe to share; raw\ is private.
cd /d "%~dp0"
where py >nul 2>nul || (echo Python is not installed. See README.md, step 1. & pause & exit /b 1)
py -3 explore_account.py %*
echo.
pause
