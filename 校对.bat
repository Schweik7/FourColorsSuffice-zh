@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在重新扫描 images/ 生成最新清单...
python gen_review.py
echo.
echo 校对台地址: http://127.0.0.1:8777/review.html
echo 关闭本窗口即停止服务。
start "" "http://127.0.0.1:8777/review.html"
python -m http.server 8777 --bind 127.0.0.1
