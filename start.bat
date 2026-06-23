@echo off
chcp 65001 >nul
title 💕 恋爱点滴

cd /d "%~dp0"

echo.
echo 💕 ====================================
echo    恋爱点滴 - 正在启动...
echo    ====================================
echo.

:: 检查 node_modules
if not exist "node_modules\" (
    echo 📦 首次运行，正在安装依赖...
    npm install
    echo.
)

:: 检查端口是否被占用，如果占用则杀掉
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do (
    echo ⚠️  端口 3456 已被占用，正在释放...
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)

:: 启动服务器
echo 🚀 启动服务器...
node server.js

pause
