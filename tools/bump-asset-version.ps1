# tools/bump-asset-version.ps1 —— 发布前给 css/js 打上真实版本号
# ============================================================
# 为什么需要它（2026-10-26）：
#   以前 index.html 里写的是占位符 ?v=__BUILD__，只有本地服务端会替换它；
#   部署到静态托管时占位符原样上线，版本号永远不变，用户会一直看到旧页面。
#   现在源文件不带版本号（干净、任何环境都能直接用），**发布前**跑本脚本
#   打上 ?v=<提交号> 再推送，用户就能立刻拿到新版本。
#
# 用法（PowerShell）：
#   打版本号：powershell -ExecutionPolicy Bypass -File tools\bump-asset-version.ps1
#   恢复干净：powershell -ExecutionPolicy Bypass -File tools\bump-asset-version.ps1 -Clear
#
# 说明：
#   - 可重复执行：每次先清掉旧版本号，再打上当前提交号；
#   - 本地跑 start-server 时不需要它（服务器会自己注入当天日期）；
#   - 不打版本号网站也能正常显示，只是用户在托管商缓存期内可能看到旧页面。

param([switch]$Clear)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$indexPath = Join-Path $root "index.html"

if (-not (Test-Path $indexPath)) {
  Write-Host "找不到 index.html：$indexPath" -ForegroundColor Red
  exit 1
}

# ---- 版本号：优先用 git 短提交号，拿不到就用时间戳 ----
$ver = ""
try {
  $gitCmd = (Get-Command git -ErrorAction SilentlyContinue).Source
  if ($gitCmd) { $ver = (& $gitCmd -C $root rev-parse --short HEAD 2>$null) }
} catch { $ver = "" }
$ver = [string]$ver
$ver = $ver.Trim()
if (-not $ver) { $ver = Get-Date -Format "yyyyMMddHHmm" }
$ver = ($ver -replace '[^A-Za-z0-9]', '')
if (-not $ver) { $ver = "1" }

# ---- 读文件（保留 UTF-8，且**保留原来有没有 BOM**）----
# ⚠️ 为什么要管 BOM：第一版一律按"无 BOM"写回，结果把 index.html 原有的
# BOM 悄悄抹掉了——`git diff` 看着只有几行变化，实际整个文件字节都变了。
# 含中文的文件在 Windows 下靠 BOM 声明 UTF-8，不能不知不觉改掉它。
$rawBytes = [IO.File]::ReadAllBytes($indexPath)
$hadBom = ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF)
$html = [Text.Encoding]::UTF8.GetString($rawBytes)
if ($hadBom) { $html = $html.TrimStart([char]0xFEFF) }

# ① 清掉已有的版本号（可重复执行的关键）
$html = $html -replace '(\.(?:css|js))\?v=[^"'' ]*', '$1'

# ② 只在 href/src 引用的 css/js 后面追加版本号（不动注释里的文字）
if (-not $Clear) {
  $repl = '$1="$2?v=' + $ver + '"'
  $html = $html -replace '(href|src)="([^"]+\.(?:css|js))"', $repl
}

$utf8Enc = New-Object Text.UTF8Encoding($hadBom)
[IO.File]::WriteAllText($indexPath, $html, $utf8Enc)

if ($Clear) {
  Write-Host "已恢复：index.html 里的 css/js 引用不再带版本号"
} else {
  Write-Host ("已打版本号 ?v=" + $ver + " → 现在可以 git commit / git push 了")
}
