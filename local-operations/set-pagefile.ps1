<#
  页面文件 / 休眠文件 调整脚本（必须在“管理员 PowerShell”里运行）
  用法（默认安全模式）：
    powershell -ExecutionPolicy Bypass -File D:\studyhub\set-pagefile.ps1 -Mode Safe
    ... -Mode MoveToD -MaxGb 24     # 把页面文件搬到 D 盘，C 盘不再放
    ... -Mode Remove                # 完全删除页面文件（脚本会先做可行性检查，不满足就拒绝）
  -Force 可跳过确认提问。
#>
param(
  [ValidateSet('Safe','MoveToD','Remove')][string]$Mode = 'Safe',
  [int]$MaxGb = 24,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Warning '请用“管理员 PowerShell”运行本脚本（当前不是管理员）。'
  exit 1
}

$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$ramGb      = [Math]::Round($cs.TotalPhysicalMemory/1GB, 1)
$commitUsed = [Math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory)/1MB, 1)
$commitMax  = [Math]::Round($os.TotalVirtualMemorySize/1MB, 1)
$pf         = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue

Write-Host "物理内存 $ramGb GB | 提交已用 $commitUsed GB / 上限 $commitMax GB" -ForegroundColor Cyan
if ($pf) { Write-Host "当前页面文件: $($pf.Name) 已用 $([Math]::Round($pf.CurrentUsage/1KB,1)) GB (峰值 $([Math]::Round($pf.PeakUsage/1KB,1)) GB)" }
Write-Host "模式: $Mode" -ForegroundColor Cyan

# ---- 可行性检查：任何会降低提交上限的操作，都必须满足 上限 >= 当前提交需求 ----
$newLimitGb = $ramGb
switch ($Mode) {
  'MoveToD' { $newLimitGb = $ramGb + $MaxGb }
  'Remove'  { $newLimitGb = $ramGb }
  'Safe'    { $newLimitGb = [Math]::Max($commitMax, $ramGb) }
}
if ($Mode -ne 'Safe' -and $newLimitGb -lt ($commitUsed * 1.1)) {
  Write-Warning ("拒绝执行：$Mode 之后提交上限约 {0} GB，而当前提交需求已 {1} GB（还需 10% 余量）。" -f $newLimitGb, $commitUsed)
  Write-Warning '请先关闭占用大的进程（python / MinerU 服务 / 浏览器等）再运行，或改用 -Mode MoveToD -MaxGb 32。'
  exit 2
}

if (-not $Force) {
  $answer = Read-Host "确认执行？输入 y 继续"
  if ($answer -ne 'y') { Write-Host '已取消'; exit 0 }
}

# ---- 1) 关休眠（安全，回收 hiberfil.sys） ----
Write-Host '== 关闭休眠（回收 hiberfil.sys）==' -ForegroundColor Yellow
powercfg /h off

switch ($Mode) {
  'Safe' {
    Write-Host '== 保持系统自动管理页面文件 ==' -ForegroundColor Yellow
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }
  }
  'MoveToD' {
    Write-Host "== 页面文件搬到 D 盘（上限 $MaxGb GB），C 盘不再放 ==" -ForegroundColor Yellow
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
    Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { Remove-CimInstance -InputObject $_ }
    $initial = [Math]::Min(4096, $MaxGb * 1024)
    New-CimInstance -ClassName Win32_PageFileSetting -Property @{
      Name = 'D:\pagefile.sys'; InitialSize = [uint32]$initial; MaximumSize = [uint32]($MaxGb * 1024)
    } | Out-Null
  }
  'Remove' {
    Write-Host '== 删除页面文件（无分页文件）==' -ForegroundColor Yellow
    Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false }
    Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { Remove-CimInstance -InputObject $_ }
  }
}

Write-Host ''
Write-Host '完成。以下改动需要重启才生效：' -ForegroundColor Green
Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name)  Initial=$($_.InitialSize)MB Max=$($_.MaximumSize)MB" }
Write-Host '  hiberfil.sys 已删除（如需恢复休眠：powercfg /h on）'
Write-Host '  想还原成系统自动管理：Set-CimInstance -InputObject (Get-CimInstance Win32_ComputerSystem) -Property @{AutomaticManagedPagefile=$true}'