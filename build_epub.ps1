$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

$SRC = "FourColors_Suffice_zh.md"
$OUT = "《四色足矣：四色猜想是如何解决的》.epub"
$TITLE = "四色足矣：四色猜想是如何解决的"
$AUTHOR = "Robin Wilson（罗宾·威尔逊）"
$COVER = "images/fig-001_封面题图彩色地图.jpg"

if (-not (Get-Command pandoc -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未找到 pandoc，请先安装：https://pandoc.org/installing.html" -ForegroundColor Red
    Read-Host "按回车键继续..."
    exit 1
}

if (-not (Test-Path $COVER)) {
    Write-Host "[错误] 未找到封面图片：$COVER" -ForegroundColor Red
    Read-Host "按回车键继续..."
    exit 1
}

Write-Host "正在将 $SRC 转换为 $OUT ..."

pandoc $SRC `
    -o $OUT `
    --toc --toc-depth=2 `
    --split-level=1 `
    --epub-title-page=false `
    --epub-cover-image="$COVER" `
    --mathml `
    --css="epub_style.css" `
    --metadata title="$TITLE" `
    --metadata author="$AUTHOR" `
    --metadata lang=zh-CN `
    --resource-path=.

if ($LASTEXITCODE -ne 0) {
    Write-Host "[失败] pandoc 转换出错，请查看上方日志。" -ForegroundColor Red
    Read-Host "按回车键继续..."
    exit 1
}

Write-Host "完成：$OUT" -ForegroundColor Green
Read-Host "按回车键继续..."