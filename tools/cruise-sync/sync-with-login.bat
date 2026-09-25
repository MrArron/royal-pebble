@echo off
REM Same as sync.bat, but also logs in to fetch your stateroom and purchases.
cd /d "%~dp0"
where py >nul 2>nul || (echo Python is not installed. See README.md, step 1. & pause & exit /b 1)
py -3 cruise_sync.py --login %*
echo.
pause
