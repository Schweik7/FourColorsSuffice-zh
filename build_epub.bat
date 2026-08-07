@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "SRC=FourColors_Suffice_zh.md"
set "OUT=FourColors_Suffice_zh.epub"
set "TITLE=四色足矣：四色猜想是如何解决的"
set "AUTHOR=Robin Wilson（罗宾·威尔逊）"
set "COVER=images/fig-001_封面题图彩色地图.jpg"

where pandoc >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 pandoc，请先安装：https://pandoc.org/installing.html
    pause
    exit /b 1
)

if not exist "%COVER%" (
    echo [错误] 未找到封面图片：%COVER%
    pause
    exit /b 1
)

echo 正在将 %SRC% 转换为 %OUT% ...

pandoc "%SRC%" ^
    -o "%OUT%" ^
    --toc --toc-depth=2 ^
    --split-level=1 ^
    --epub-title-page=false ^
    --epub-cover-image="%COVER%" ^
    --mathml ^
    --css="epub_style.css" ^
    --metadata title="%TITLE%" ^
    --metadata author="%AUTHOR%" ^
    --metadata lang=zh-CN ^
    --resource-path=.

if errorlevel 1 (
    echo [失败] pandoc 转换出错，请查看上方日志。
    pause
    exit /b 1
)

echo 完成：%OUT%
pause
