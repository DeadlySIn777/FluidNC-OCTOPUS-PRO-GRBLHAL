@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 and reopen this launcher.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0]) !== 24) process.exit(1)"
if errorlevel 1 (
  echo This source build is tested with Node.js 24. Select that runtime first.
  pause
  exit /b 1
)
if not exist "node_modules\serialport\package.json" (
  echo Run npm ci from this folder before launching.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Run npm run build from this folder before launching.
  pause
  exit /b 1
)
echo Native console: http://127.0.0.1:5174/?native=1
echo Keep this window open. No serial connection opens automatically.
echo Missing or mismatched local firmware blocks startup; see README.md.
node service\native-server.mjs
if errorlevel 1 pause
