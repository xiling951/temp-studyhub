# Start the standalone DSH 0.2 harness that hosts StudyHub 3.3.0.
#
# This deployment is deliberately separate from DSH Desktop (harness 0.1.7-rc.2):
# StudyHub 3.3.0 requires DSH >=0.2.0-rc.2 <0.3, so it runs in its own harness
# home and its own port. DSH Desktop, its profile and its plugins are untouched.
#
# Usage:  powershell -ExecutionPolicy Bypass -File D:\studyhub\start-studyhub.ps1
# Stop:   Ctrl+C in this window (or close it)

$ErrorActionPreference = 'Stop'

# The harness resolves its home from $DSH_HOME; clear any inherited desktop
# variables first so this instance can never touch the Desktop harness home.
Get-ChildItem env: | Where-Object { $_.Name -like 'DSH_*' } |
  ForEach-Object { Remove-Item "env:$($_.Name)" -ErrorAction SilentlyContinue }

$env:DSH_HOME = 'D:\studyhub\dsh-home'

# Network: this machine reaches the outside world through a local proxy
# (WinINET proxy 127.0.0.1:7890 — see HKCU Internet Settings). Node does not
# read the Windows proxy on its own, so pass it explicitly; NODE_USE_ENV_PROXY
# makes Node 24's global fetch (undici) honour these variables. StudyHub's
# search extension needs this to download its ~90 MB embedding model from
# huggingface.co on first index build. Localhost and DeepSeek stay direct.
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:NO_PROXY = 'localhost,127.0.0.1,::1,deepseek.com'
$env:NODE_USE_ENV_PROXY = '1'

$runner = 'D:\studyhub\dsh-0.2\harness-entry.mjs'
$entry = 'D:\studyhub\dsh-0.2\node_modules\@deepseek-ai\dsh\lib\bin.js'

Set-Location 'D:\studyhub'
Write-Host 'StudyHub 3.3.0 · DSH 0.2.0-rc.2 · http://127.0.0.1:43130'
Write-Host 'The URL printed below carries a fresh access token; open it in a browser.'
node $runner $entry --profile web --port 43130
