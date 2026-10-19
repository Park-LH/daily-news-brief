# ============================================================
# start-server.ps1 —— 零依赖迷你网页服务器（含数据接口）
# ============================================================
# 原理（零基础解释）：
#   Windows 自带 PowerShell，里面有个 HttpListener 组件，
#   可以监听浏览器请求并把项目文件发回去，不需要安装任何软件。
# 用法：双击 start-server.bat（它会自动调用本文件）
#
# 本服务器提供三类服务：
#   1. 静态文件：把 html/css/js 文件发给浏览器
#   2. 数据接口：/api/stats —— 保存和读取历史统计数据（存 .data/stats.json）
#   3. RSS 代理：/api/feed —— 服务端代抓 RSS（解决 rss2json 只返回 10 条的限制）

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8019

# 统计数据文件的存放位置
$dataFile = Join-Path $root ".data\stats.json"

# ---------- 资源版本号（防缓存）----------
# index.html 里写的都是占位符 ?v=__BUILD__，这里把 __BUILD__ 换成当天日期
# 再发给浏览器（运行时替换）。磁盘上的 index.html 一个字都不动，
# 所以 git 工作区永远是干净的，不会出现"一启动就冒出个已修改文件"。
# 日期每天变一次 → 浏览器每天都会重新下载 js/css，不用按 Ctrl+F5。
$buildId = Get-Date -Format "yyyyMMdd"

# ---------- RSS 代理（/api/feed）的域名白名单 ----------
# 只放行这里登记的域名及其子域（如 www.chinanews.com.cn）。
# 目的：本接口是"服务器代你抓网页"，如果不限制域名，
# 就等于开放了一个任意 URL 代理，局域网内谁都能借它访问外网任意地址。
# 要接入新的官方媒体，把它的域名加进这个数组即可。
$ALLOWED_FEED_HOSTS = @("chinanews.com.cn")

# ---------- 启动前 1：探测本机局域网 IP（给手机访问用）----------
# 优先取 192.168.* 这类家庭/办公网段地址，取不到再退到其他内网地址
function Get-LanIP {
  $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
         Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
  $home = $all | Where-Object { $_.IPAddress -like '192.168.*' }
  if ($home) { return ($home | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress }
  $other = $all | Where-Object { $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.1?.*' -or $_.IPAddress -like '172.2?.*' -or $_.IPAddress -like '172.3?.*' }
  if ($other) { return ($other | Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress }
  return $null
}
$lanIP = Get-LanIP

# ---------- 启动前 2：端口是否被占用 ----------
# 原理：先试着把 8019 端口"占"一下，如果已被别人占用会抛异常
$probe = New-Object System.Net.HttpListener
try {
  $probe.Prefixes.Add("http://localhost:$port/")
  $probe.Start()
  $probe.Stop()
  $probe.Close()
} catch {
  Write-Host "=========================================" -ForegroundColor Red
  Write-Host "  ❌ 端口被占：$port 已被其他程序使用" -ForegroundColor Red
  Write-Host ""
  Write-Host "  请选择以下任一方式解决：" -ForegroundColor Yellow
  Write-Host "  1. 关掉占用进程（比如之前没关的旧服务器窗口）再重试"
  Write-Host "  2. 或者修改本文件第 10 行的 `$port = 8019` 换个端口（如 8020）"
  Write-Host ""
  Write-Host "  查看是谁占用了端口：在命令行运行"
  Write-Host "  netstat -ano | findstr :$port"
  Write-Host "=========================================" -ForegroundColor Red
  exit 1
}

# ---------- 启动前 3：决定监听地址（手机能不能访问就看这一步）----------
# http://+:8019/ 表示监听所有网卡，手机在同一 WiFi 下就能连进来；
# 但它需要管理员权限。不是管理员就退回 localhost，并明确中文提示，不静默失败。
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$lanMode = $false
if ($isAdmin) {
  $lanMode = $true
} else {
  Write-Host "=========================================" -ForegroundColor Yellow
  Write-Host "  ⚠️ 当前为本地模式，手机无法访问" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  原因：监听局域网地址 http://+:$port/ 需要管理员权限，"
  Write-Host "  而本窗口是以普通用户身份运行的。"
  Write-Host ""
  Write-Host "  想用手机访问：关闭本窗口 → 右键 start-server.bat"
  Write-Host "  → 选择「以管理员身份运行」，启动后会显示手机访问地址。"
  Write-Host "=========================================" -ForegroundColor Yellow
  Write-Host ""
}

# ---------- 启动前检查 2：数据目录与文件是否就绪 ----------
$dataDir = Split-Path -Parent $dataFile
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Write-Host "已自动创建数据目录: .data\"
}
if (-not (Test-Path $dataFile)) {
  "{}" | Out-File -FilePath $dataFile -Encoding utf8
  Write-Host "已自动创建空数据文件: .data\stats.json"
}

$listener = New-Object System.Net.HttpListener
if ($lanMode) { $listener.Prefixes.Add("http://+:$port/") } else { $listener.Prefixes.Add("http://localhost:$port/") }
try {
  $listener.Start()
} catch {
  # 少数情况下即使是管理员也绑不上 +（被其他程序独占），退回 localhost 并说明
  Write-Host "  ⚠️ 绑定局域网地址失败，已退回本地模式：$_" -ForegroundColor Yellow
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$port/")
  $listener.Start()
  $lanMode = $false
}

Write-Host "========================================="
if ($lanMode) {
  Write-Host "  手机/局域网模式：同一 WiFi 下的手机也能打开" -ForegroundColor Green
  Write-Host "  本机访问: http://localhost:$port/" -ForegroundColor Cyan
  Write-Host ("  手机访问: http://" + ($(if ($lanIP) { $lanIP } else { "未探测到局域网IP" })) + ":$port/") -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  手机打不开时按顺序排查：" -ForegroundColor Yellow
  Write-Host "   1. 手机和电脑连的是同一个 WiFi"
  Write-Host "   2. Windows 防火墙弹过窗的话要选「允许访问」"
  Write-Host "   3. 上面这行的 IP 要在手机浏览器里原样输入（含 http:// 和端口）"
} else {
  Write-Host "  服务器已启动（本地模式，仅本机能访问）" -ForegroundColor Yellow
  Write-Host "  本机访问: http://localhost:$port/" -ForegroundColor Cyan
}
Write-Host "  停止方法：直接关闭本窗口"
Write-Host "========================================="

Start-Process "http://localhost:$port/"

# 文件后缀 → 网页内容类型 对照表
$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif"  = "image/gif"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

# ---------- 数据接口的工具函数 ----------

# 读取统计文件；没有或损坏则返回空对象
function Read-StatsFile {
  if (Test-Path $dataFile) {
    try {
      return (Get-Content $dataFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
      return $null
    }
  }
  return $null
}

# 把统计对象写回文件（自动创建 .data 文件夹）
function Write-StatsFile($obj) {
  $dir = Split-Path -Parent $dataFile
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $obj | ConvertTo-Json -Depth 5 | Out-File -FilePath $dataFile -Encoding utf8
}

# 给浏览器回一段 JSON
# $depth 默认 5；RSS 代理那种"对象数组"要用到 10
# （PS 5.1 的 ConvertTo-Json 默认 -Depth 2，深层结构会被压成字符串）
# $statusCode 用于返回 403/502/504 等错误状态，不传就是默认 200
function Send-Json($ctx, $obj, $depth = 5, $statusCode = 200) {
  $json = $obj | ConvertTo-Json -Depth $depth
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $statusCode
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# 取 XML 节点里的文字（兼容带命名空间前缀的 RSS，如 dc:date）
function Get-NodeText($node, $name) {
  $child = $node.SelectSingleNode("*[local-name()='$name']")
  if ($null -eq $child) { return "" }
  return ($child.InnerText | Out-String).Trim()
}

# ---------- 主循环：等待并处理请求 ----------

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)

    # ===== 接口 1：/api/stats 数据的保存与读取 =====
    if ($path -eq "/api/stats") {
      if ($ctx.Request.HttpMethod -eq "POST") {
        # POST = 保存某一天的分类数据
        # 请求体格式：{"date":"2026-10-13","stats":{"科技":3,"财经":7,"生活":0,"total":10}}
        $reader = New-Object IO.StreamReader($ctx.Request.InputStream)
        $body = $reader.ReadToEnd()
        $data = $body | ConvertFrom-Json

        $stats = Read-StatsFile
        if ($null -eq $stats) { $stats = [PSCustomObject]@{} }
        # 同一天重复保存会覆盖旧的（-Force）
        $stats | Add-Member -NotePropertyName $data.date -NotePropertyValue $data.stats -Force
        Write-StatsFile $stats

        Send-Json $ctx @{ ok = $true }
      } else {
        # GET = 读取全部历史数据
        # 返回格式：{"2026-10-12":{"科技":2,...},"2026-10-13":{...}}
        $stats = Read-StatsFile
        if ($null -eq $stats) { $stats = [PSCustomObject]@{} }
        Send-Json $ctx $stats
      }
      $ctx.Response.Close()
      continue
    }

    # ===== 接口 2：/api/feed 服务端代抓 RSS（GET /api/feed?url=...）=====
    # 为什么需要它：浏览器直连 RSS 只能走 rss2json，而它固定只返回最新 10 条；
    # 服务端自己抓源站能拿到全部条目（中新网实测 27~30 条）。
    #
    # 返回：{ ok, url, encoding, count, items:[{title,link,pubDate,description}] }
    # 出错：{ ok:false, error, message } + 对应 HTTP 状态码，绝不回吐原始异常页面。
    if ($path -eq "/api/feed") {
      if ($ctx.Request.HttpMethod -ne "GET") {
        Send-Json $ctx @{ ok = $false; error = "METHOD_NOT_ALLOWED"; message = "请用 GET" } -statusCode 405
        $ctx.Response.Close()
        continue
      }

      # ---- 第 0 步：取 url 参数 ----
      $feedUrl = ""
      if ($ctx.Request.QueryString["url"]) {
        $feedUrl = ($ctx.Request.QueryString["url"] | Out-String).Trim()
      }
      if ([string]::IsNullOrEmpty($feedUrl)) {
        Send-Json $ctx @{
          ok = $false; error = "MISSING_URL"
          message = "缺少 url 参数，例：/api/feed?url=" +
                    [Uri]::EscapeDataString("https://www.chinanews.com.cn/rss/scroll-news.xml")
        } -statusCode 400
        $ctx.Response.Close()
        continue
      }

      # ---- 第 1 步：域名白名单（防被当成任意 URL 代理）----
      $hostName = ""
      try { $hostName = ([Uri]$feedUrl).Host } catch { $hostName = "" }
      $allowed = $false
      foreach ($d in $ALLOWED_FEED_HOSTS) {
        if ($hostName -eq $d -or $hostName -like "*.$d") { $allowed = $true; break }
      }
      if (-not $allowed) {
        Send-Json $ctx @{
          ok = $false; error = "DOMAIN_NOT_ALLOWED"
          message = "只允许抓取白名单域名的 RSS（当前允许：$($ALLOWED_FEED_HOSTS -join '、')）"
          host = $hostName
        } -statusCode 403
        $ctx.Response.Close()
        continue
      }

      # ---- 第 2 步：抓取 ----
      # 强制 TLS 1.2：PS 5.1 默认可能只开 TLS 1.0，不加会报"基础连接已关闭"
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $resp = $null
      try {
        $resp = Invoke-WebRequest -Uri $feedUrl -UseBasicParsing -TimeoutSec 15 `
                -Headers @{ "User-Agent" = "Mozilla/5.0" }
      } catch {
        $msg = ($_.Exception.Message | Out-String).Trim()
        $isTimeout = $msg -match "超时|timed out|Timeout"
        $errCode = if ($isTimeout) { "FETCH_TIMEOUT" } else { "FETCH_FAILED" }
        $errMsg  = if ($isTimeout) { "抓取超时（15 秒）" } else { "抓取失败：$msg" }
        Write-Host "  [RSS代理] 失败 $feedUrl —— $errMsg" -ForegroundColor Yellow
        Send-Json $ctx @{ ok = $false; error = $errCode; message = $errMsg; url = $feedUrl } `
                  -statusCode $(if ($isTimeout) { 504 } else { 502 })
        $ctx.Response.Close()
        continue
      }

      # ---- 第 3 步：取原始字节，按 XML 声明的编码解码（保证中文不乱码）----
      # 注意：不能直接读 $resp.Content —— PS 5.1 会按错误编码把中文解成乱码
      # （实测会变成 ä¸­å¤... 这种），必须自己按字节解码。
      $ms = New-Object IO.MemoryStream
      try {
        $resp.RawContentStream.Position = 0
        $resp.RawContentStream.CopyTo($ms)
      } catch { }
      $bytes = $ms.ToArray()

      # 跳过 UTF-8 BOM（不跳的话 XML 解析会报"根级别上的数据无效"）
      $offset = 0
      if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $offset = 3
      }

      # 从 XML 声明里读 encoding，读不到就按 UTF-8
      $head = [Text.Encoding]::ASCII.GetString($bytes, $offset, [Math]::Min(300, $bytes.Length - $offset))
      $encName = ([regex]::Match($head, 'encoding\s*=\s*["'']([^"'']+)["'']')).Groups[1].Value
      if ([string]::IsNullOrEmpty($encName)) { $encName = "utf-8" }
      $enc = $null
      try { $enc = [Text.Encoding]::GetEncoding($encName) } catch { $enc = $null }
      if ($null -eq $enc) { $enc = [Text.Encoding]::UTF8 }
      $xmlText = $enc.GetString($bytes, $offset, $bytes.Length - $offset)

      # ---- 第 4 步：解析 XML，逐条取出 4 个字段 ----
      $items = @()
      try {
        $doc = New-Object System.Xml.XmlDocument
        $doc.LoadXml($xmlText)
        # 用 local-name() 兼容带命名空间前缀的 RSS
        $nodes = $doc.SelectNodes("//*[local-name()='item']")
        foreach ($n in $nodes) {
          $items += [PSCustomObject]@{
            title       = Get-NodeText $n "title"
            link        = Get-NodeText $n "link"
            pubDate     = Get-NodeText $n "pubDate"
            description = Get-NodeText $n "description"
          }
        }
      } catch {
        $msg = ($_.Exception.Message | Out-String).Trim()
        Write-Host "  [RSS代理] XML 解析失败 $feedUrl —— $msg" -ForegroundColor Yellow
        Send-Json $ctx @{
          ok = $false; error = "PARSE_FAILED"
          message = "RSS 解析失败（源站可能返回了非 XML 内容）：$msg"
          url = $feedUrl; encoding = $encName
        } -statusCode 500
        $ctx.Response.Close()
        continue
      }

      # ---- 第 5 步：返回（条目不限量，有多少给多少）----
      Write-Host "  [RSS代理] $hostName → $($items.Count) 条（编码 $encName）"
      Send-Json $ctx @{
        ok = $true; url = $feedUrl; encoding = $encName
        count = $items.Count; items = @($items)
      } -depth 10
      $ctx.Response.Close()
      continue
    }

    # ===== 接口 3：静态文件 =====
    if ($path -eq "/") { $path = "/index.html" }

    # 拼出本地文件路径，并检查它确实在项目文件夹里（安全防护）
    $file = [IO.Path]::GetFullPath((Join-Path $root ($path -replace "/", "\")))
    if (-not $file.StartsWith($root)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }

    if (Test-Path $file -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($file).ToLower()

      # HTML：先把内容读成文本，把版本号占位符 __BUILD__ 换成当天日期再下发
      # （只在内存里替换，源文件不写回磁盘）
      if ($ext -eq ".html") {
        $htmlText = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
        $bytes = [Text.Encoding]::UTF8.GetBytes(($htmlText -replace '__BUILD__', $buildId))
      } else {
        $bytes = [IO.File]::ReadAllBytes($file)
      }

      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }

      # 网页三件套一律禁止缓存：改完代码普通刷新（F5）就能看到新内容，
      # 不用再按 Ctrl+F5。（配合 HTML 里的 ?v= 版本号，双保险）
      if ($ext -eq ".html" -or $ext -eq ".js" -or $ext -eq ".css") {
        $ctx.Response.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
        $ctx.Response.Headers.Add("Pragma", "no-cache")
        $ctx.Response.Headers.Add("Expires", "0")
      }

      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
    # 单个请求出错不影响服务器继续运行
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  $ctx.Response.Close()
}
