@echo off
REM Downloads cruise data for the Royal Pebble app. Add --login to include your booking.
cd /d "%~dp0"
where py >nul 2>nul || (echo Python is not installed. See README.md, step 1. & pause & exit /b 1)
py -3 cruise_sync.py %*
echo.
pause
