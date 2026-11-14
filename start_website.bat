@echo off
echo Starting Ledger Atlas Web Application...
start "" http://localhost:3000
where node >nul 2>nul
if %errorlevel% equ 0 (
  nAQ.Ab8RN6KYFlU8D-DaKn0oALzhaEP0pTvXbEp_jqmQMNB1-K-AqAode server.js
) else (
  python -m http.server 3000
)
pause
