@echo off
title liangquanqimei - 安装依赖 & 启动
cd /d "d:\projects\liangquanqimei"

echo ========================================
echo  粮全齐美数据看板 - 安装 & 启动
echo  镜像源: registry.npmmirror.com (阿里)
echo ========================================
echo.

echo [1/2] 正在安装依赖...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo  安装失败! Error code: %errorlevel%
    echo ========================================
    pause
    exit /b 1
)

echo.
echo [2/2] 安装成功，启动开发服务器...
echo  打开 http://localhost:3055
echo ========================================
echo.
call npm run dev

pause
