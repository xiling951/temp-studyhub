# 把 MinerU 的 Markdown 转成"全文.md + 裁剪图片"。
# 图片由 MinerU 自己的 read 命令按定位符导出（doc:<id>/tier:<t>/page:<p>/block:<b>）。
$ErrorActionPreference = 'Stop'

$mineru = 'C:\Users\Lenovo\.local\bin\mineru.exe'
$src    = 'D:\studyhub\lab\extract\mineru-out'
$base   = 'D:\studyhub\lab\extract'
$mdDir  = Join-Path $base '全文-p200-206'
$imgDir = Join-Path $mdDir 'images'

New-Item -ItemType Directory -Force -Path $imgDir | Out-Null

$md = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
$rx = [regex]'!\[(?<label>[^\]]*)\]\((?<loc>doc:[^)\s]+)\)'

$sb   = New-Object System.Text.StringBuilder
$last = 0
$i    = 0
foreach ($m in $rx.Matches($md)) {
  [void]$sb.Append($md.Substring($last, $m.Index - $last))
  $i++
  $loc  = $m.Groups['loc'].Value
  $page = 'x'
  if ($loc -match 'page:(\d+)') { $page = $matches[1] }
  $file = 'p{0}-fig{1:D2}.jpg' -f $page, $i
  $dest = Join-Path $imgDir $file
  & $mineru read $loc -f image -o $dest | Out-Null
  if (-not (Test-Path -LiteralPath $dest)) { throw "导出失败: $loc" }
  $size = (Get-Item -LiteralPath $dest).Length
  Write-Host ('  {0}  {1,8:N0} B   <- {2}' -f $file, $size, $loc)
  $alt = '图块 ' + $i + '（原书第 ' + $page + ' 页）'
  [void]$sb.Append('![' + $alt + '](images/' + $file + ')')
  $last = $m.Index + $m.Length
}
[void]$sb.Append($md.Substring($last))
$body = $sb.ToString()

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$header = @"
# 数字集成电路（第2版）第 200–206 页 · 全文提取

- 来源：数字集成电路-p200-206.pdf（原书 572 页扫描版 PDF 的第 200–206 页，印刷页 182–188）
- 解析：MinerU 4.0.11，standard 档，模型 MinerU2.5-Pro-2605-1.2B-GGUF，OCR 后输出
- 内容：文字、公式（LaTeX）、表格（Markdown 或 HTML 原样保留）、图片（按版式坐标裁剪，保存在 images/）
- 说明：页眉、页脚与页码按解析结果保留，未作删除；图片仅正文插图与图表，不含整页截图
- 生成时间：$stamp

---

"@

$out = Join-Path $mdDir '全文.md'
[System.IO.File]::WriteAllText($out, $header + $body, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host ('已写入: ' + $out)
Write-Host ('图片数: ' + $i + '，Markdown 字符数: ' + $body.Length)
