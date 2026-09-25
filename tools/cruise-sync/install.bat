@echo off
REM Installs what the Royal Pebble sync tool needs (run once).
cd /d "%~dp0"
where py >nul 2>nul || (echo Python is not installed. See README.md, step 1. & pause & exit /b 1)
py -3 -m pip install --upgrade -r requirements.txt
echo.
echo Done. Double-click sync.bat to download cruise data.
pause
