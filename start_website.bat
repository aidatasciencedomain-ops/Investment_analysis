@echo off
echo Starting Ledger Atlas Web Application...
start "" http://localhost:3000
where node >nul 2>nul
if %errorlevel% equ 0 (
  node server.js
) else (
  python -m http.server 3000
)
pause
