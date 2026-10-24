<#
启动服务-局域网.ps1 —— 让手机也能打开新闻简报（管理员一键操作）
================================================================
为什么需要这个脚本（2026-10-24 真机验收实测）：
  手机打不开的根因有两个，都绕不开管理员权限：
    1. 服务默认只注册 http://localhost:8019/，手机用 IP 访问会被直接拒（HTTP 400）。
       要监听所有网卡得注册 http://+:8019/，这需要管理员（或提前做 URL 保留）。
    2. Windows 防火墙默认拦入站，本机实测没有 8019 的放行规则；
       且 WLAN 被识别为"公用网络"，拦得更严。

这个脚本一次性做完四件事：
    A. 自己申请管理员权限（弹 UAC，点「是」）
    B. 做 URL 保留 http://+:8019/（做完以后，普通窗口启动也能被手机访问）
    C. 加防火墙入站规则（TCP 8019，覆盖公用/专用网络）
    D. 以管理员身份启动服务，并自测局域网地址是否真的通

用法：双击本文件 → UAC 点「是」→ 看最后打印的「手机访问地址」
#>

param([int]$Port = 8019)

$scriptPath = $MyInvocation.MyCommand.Path
$here = Split-Path -Parent $scriptPath
$root = Split-Path -Parent $here          # tools 的上一级就是项目根

# ---------- A. 不是管理员就自我提权 ----------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "=========================================" -ForegroundColor Yellow
  Write-Host "  正在申请管理员权限……" -ForegroundColor Yellow
  Write-Host "  请在弹出的窗口里点「是」，否则手机仍然打不开。" -ForegroundColor Yellow
  Write-Host "=========================================" -ForegroundColor Yellow
  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"", "-Port", $Port
  )
  exit
}

Write-Host "已取得管理员权限 ✔" -ForegroundColor Green

# ---------- 端口被占用就先停掉旧服务 ----------
$occupied = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($occupied) {
  $pids = $occupied | Select-Object -ExpandProperty OwningProcess -Unique
  Write-Host "端口 $Port 已被占用（PID: $($pids -join ', ')）——多半是之前那个「本地模式」的服务。" -ForegroundColor Yellow
  $ans = Read-Host "是否结束它并以局域网模式重新启动？(Y/n)"
  if ($ans -ne "n" -and $ans -ne "N") {
    $pids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Write-Host "  已停止旧服务" -ForegroundColor DarkGray
  } else {
    Write-Host "  保留旧服务，后面可能仍绑不上局域网地址。" -ForegroundColor Yellow
  }
}

# ---------- B. URL 保留：http://+:8019/ ----------
Write-Host ""
Write-Host "B. 注册 URL 保留 http://+:$Port/ ……" -ForegroundColor Cyan
netsh http delete urlacl url="http://+:$Port/" 2>&1 | Out-Null
$acl = netsh http add urlacl url="http://+:$Port/" user="Everyone" 2>&1 | Out-String
if ($acl -match "成功|successfully") {
  Write-Host "   URL 保留成功（以后普通窗口启动也能被手机访问）" -ForegroundColor Green
} else {
  Write-Host "  URL 保留结果: $($acl.Trim())" -ForegroundColor Yellow
}

# ---------- C. 防火墙放行 ----------
Write-Host ""
Write-Host "C. 放行防火墙 TCP $Port 入站（公用/专用网络都放行）……" -ForegroundColor Cyan
netsh advfirewall firewall delete rule name="每日新闻简报 $Port" 2>&1 | Out-Null
$fw = netsh advfirewall firewall add rule name="每日新闻简报 $Port" `
      dir=in action=allow protocol=TCP localport=$Port profile=any 2>&1 | Out-String
if ($fw -match "确定|Ok|成功") {
  Write-Host "   防火墙规则已添加" -ForegroundColor Green
} else {
  Write-Host "   防火墙结果: $($fw.Trim())" -ForegroundColor Yellow
}

# ---------- D. 以管理员身份启动服务 ----------
Write-Host ""
Write-Host "D. 启动新闻服务（局域网模式）……" -ForegroundColor Cyan
$srv = Join-Path $root "start-server.ps1"
Start-Process -FilePath "powershell.exe" -WorkingDirectory $root -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$srv`""
)
Start-Sleep -Seconds 8

# ---------- 自测：局域网地址到底通不通 ----------
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -notlike "192.168.56.*"
} | Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
if ($lanIP) {
  try {
    $r = Invoke-WebRequest -Uri ("http://" + $lanIP + ":$Port/") -TimeoutSec 8 -UseBasicParsing
    Write-Host "   自测通过：HTTP $($r.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "   自测失败：$($_.Exception.Message)" -ForegroundColor Red
  }
  # 用 -f 拼地址，不写 "http://$lanIP`:$Port/" 这种反引号转义
  # （反引号在双引号字符串里容易把后面的引号一起吃掉，实测报「字符串缺少终止符」）
  Write-Host ("   手机访问地址：http://{0}:{1}/" -f $lanIP, $Port) -ForegroundColor Cyan
} else {
  Write-Host "   没探测到局域网 IP，请自己跑 ipconfig 看『无线局域网适配器 WLAN』的 IPv4" -ForegroundColor Yellow
}
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "手机上请注意：" -ForegroundColor Yellow
Write-Host ("  1. 地址栏要输完整：http://{0}:{1}/（只输 IP 会被浏览器当搜索词）" -f $lanIP, $Port) -ForegroundColor Gray
Write-Host "  2. 手机和电脑连同一个 WiFi（都是 192.168.1.x），别连访客网络" -ForegroundColor Gray
Write-Host "  3. 若还打不开：本机装了腾讯电脑管家，它的防火墙也可能拦，需在其中放行 $Port" -ForegroundColor Gray
Write-Host "  4. 可在手机浏览器先试 http://192.168.1.1（路由器后台），能开说明网段没问题" -ForegroundColor Gray
Write-Host ""
Read-Host "按回车关闭本窗口"
