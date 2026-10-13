# 把 StudyHub 3.3.0 + 检索扩展装进 DSH Desktop 的 profile。
#
# 前提：桌面端已经在跑 harness 0.2.x（DSH Desktop 0.11.x）。StudyHub 3.3.0 声明
# @deepseek-ai/dsh-llm >=0.2.0-rc.2 <0.3，所以在 0.10.0（harness 0.1.7-rc.2）上
# 绝不能把它加进这个 profile。
#
# 做的事：用本部署的 0.2.0-rc.2 harness，把两个发布包 pnpm 装进
# %APPDATA%\dsh-desktop\harness\profiles\web，并写入该 profile 的
# dsh.profile.bundles。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File D:\studyhub\install-studyhub-into-desktop.ps1
# 然后：完全退出并重开 DSH Desktop（含托盘图标），左栏就会出现 StudyHub。
#
# 状态：本脚本已于 2026-10-09 成功执行过一次，桌面端 profile 的 bundles 里已经有
# 这两个包；下面是重跑 / 复现时的完整说明。

$ErrorActionPreference = 'Stop'
$harnessHome = Join-Path $env:APPDATA 'dsh-desktop\harness'
$profileDir = Join-Path $harnessHome 'profiles\web'

# --- 1. 版本闸门：优先看"正在运行"的桌面端 -------------------------------
$running = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path } | Select-Object -First 1

if ($running) {
  $desktopExe = $running.Path
  $version = (Get-Item $desktopExe).VersionInfo.ProductVersion
  Write-Host "正在运行的桌面端: $desktopExe (app $version)"
} else {
  # 只认官方安装位置：曾经解出的便携副本 D:\DSH-Desktop-0.11.1 已删除、旧的
  # 0.10.0 也已清除，磁盘上不存在第二份可启动的桌面端。
  $installed = "$env:LOCALAPPDATA\Programs\DSH Desktop\DSH Desktop.exe"
  $candidate = if (Test-Path $installed) { Get-Item $installed } else { $null }
  if ($candidate) {
    $desktopExe = $candidate.FullName
    $version = $candidate.VersionInfo.ProductVersion
    Write-Host "桌面端未在运行，核对磁盘上的安装: $desktopExe (app $version)"
  } else {
    Write-Warning '找不到 DSH Desktop.exe，无法核对 harness 版本，已停止以免装错 profile。'
    exit 1
  }
}

if ([version]($version -replace '\.0$', '') -lt [version]'0.11') {
  Write-Warning @"
这个桌面端（$version）内置 harness 0.1.7-rc.2，装不了 StudyHub 3.3.0。
请先升到 DSH Desktop 0.11.x（内置 harness 0.2.0-rc.2）：运行官方安装包
D:\studyhub\deploy\DSH-Desktop-0.11.1-setup.exe。
它会强制关闭正在运行的桌面端；若你正用着它，请自己选好时机再双击。
"@
  exit 1
}

if (-not (Test-Path $profileDir)) { throw "找不到桌面端 profile：$profileDir" }

# --- 2. 用 0.2.0-rc.2 harness 安装两个 bundle ---------------------------
$runner = 'D:\studyhub\dsh-0.2\harness-entry.mjs'
$entry = 'D:\studyhub\dsh-0.2\node_modules\@deepseek-ai\dsh\lib\bin.js'
$packages = @(
  'D:\studyhub\deploy\studyhub-3.3.0.tgz',
  'D:\studyhub\deploy\studyhub-retrieval-3.3.0.tgz'
)
foreach ($package in $packages) {
  if (-not (Test-Path $package)) { throw "缺少发布包：$package" }
}

Get-ChildItem env: | Where-Object { $_.Name -like 'DSH_*' } |
  ForEach-Object { Remove-Item "env:$($_.Name)" -ErrorAction SilentlyContinue }
$env:DSH_HOME = $harnessHome
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY = 'localhost,127.0.0.1,::1,deepseek.com'
$env:NODE_USE_ENV_PROXY = '1'

foreach ($package in $packages) {
  Write-Host "`n=== 安装 $package 到桌面端 profile ==="
  node $runner $entry plugin --profile web add $package
}

# --- 3. 汇报 -------------------------------------------------------------
$manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
Write-Host "`n桌面端 profile 的 bundles："
$manifest.dsh.profile.bundles | ForEach-Object { Write-Host "  - $_" }
Write-Host @"

下一步：
  1. 完全退出 DSH Desktop（含托盘图标）再打开 —— 插件清单只在启动时读。
  2. 打开左栏的 StudyHub；新会话选「学习模式 · StudyHub」预设。
  3. 检索扩展的嵌入模型已放到 %APPDATA%\dsh-desktop\harness\study\retrieval\models，
     首次建索引不需要再下载 90 MB。
  4. 本机现在只有一份 DSH Desktop：%LOCALAPPDATA%\Programs\DSH Desktop（0.11.1 内置
     harness 0.2.0-rc.2）。旧的 0.10.0 与便携副本都已清除，不存在"点错快捷方式"的问题。

回退：把这两个名字从
$profileDir\package.json 的 dsh.profile.bundles 里删掉并重启桌面端；
或直接用 D:\studyhub\deploy\desktop-profile-backup-* 里的备份覆盖回去。
"@