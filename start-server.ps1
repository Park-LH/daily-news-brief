# ============================================================
# start-server.ps1 —— 零依赖迷你网页服务器（含数据接口）
# ============================================================
# 原理（零基础解释）：
#   Windows 自带 PowerShell，里面有个 HttpListener 组件，
#   可以监听浏览器请求并把项目文件发回去，不需要安装任何软件。
# 用法：双击 start-server.bat（它会自动调用本文件）
#
# 本服务器提供四类服务：
#   1. 静态文件：把 html/css/js 文件发给浏览器
#   2. 数据接口：/api/stats —— 保存和读取历史统计数据（存 .data/stats.json）
#   3. 配图接口：/api/ai-image —— 给缺图的新闻生成 AI 配图（调 tools/gen_news_image.py）
#   4. RSS 代理：/api/feed —— 服务端代抓 RSS（解决 rss2json 只返回 10 条的限制）

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

# ---------- /api/image 用的白名单与缓存 ----------
# 文章页域名：只放行中新网（与 RSS 同一个媒体机构）
$ALLOWED_ARTICLE_HOSTS = @("www.chinanews.com.cn", "chinanews.com.cn")
# 文章页必须"整体"长这样：
#   https://www.chinanews.com.cn/gn/2026/10-20/10718054.shtml
# 频道首页（/importnews.html）、栏目页（/photo.html）都不算文章页，
# 实测 RSS 里会混进频道首页，不校验就会拿列表缩略图当封面。
#
# ⚠️ 必须**整体锚定**（^...$），不能只匹配一段子串：
# 实测旧版裸正则 '\d{4}/\d{1,2}-\d{1,2}/\d+\.shtml' 能被查询串绕过——
#   https://www.chinanews.com.cn/?x=2026/10-20/10718054.shtml
# 主机名是合法白名单域名、子串匹配命中，于是 200 并真的去抓了首页。
$ARTICLE_URL_PATTERN = '^https?://(?:www\.)?chinanews\.com\.cn(?:/[a-z0-9-]{2,10})*/\d{4}/\d{1,2}-\d{1,2}/\d+\.shtml/?$'
# 24 小时内存缓存：沉浸浏览来回翻页会重复请求同一篇，没必要每次都抓
$IMAGE_CACHE_HOURS = 24
$ImageCache = @{}

# ---------- 找 python（AI 补图要用）----------
# 生成图片要靠 python 调 CodeBuddy 的图片生成脚本，所以先在本机找一个能用的解释器。
# 找不到也不影响服务器启动，只是 AI 补图不可用（页面会保持干净空位）。
function Resolve-Python {
  $candidates = @($env:BUDDY_PYTHON)
  # CodeBuddy 自带的 python（优先，最稳）
  $wb = Join-Path $env:USERPROFILE ".workbuddy\binaries\python"
  if (Test-Path $wb) {
    Get-ChildItem $wb -Recurse -Depth 3 -Filter "python.exe" -ErrorAction SilentlyContinue |
      ForEach-Object { $candidates += $_.FullName }
  }
  $candidates += @("python", "python3", "py")

  foreach ($c in $candidates) {
    if (-not $c) { continue }
    try {
      $ver = & $c --version 2>&1 | Out-String
      if ($ver -match "Python\s*\d") { return $c }   # 确认真的能跑，而不是应用商店占位
    } catch { }
  }
  return $null
}
$pythonExe = Resolve-Python

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
if ($pythonExe) {
  if ($env:BUDDY_CLOUD_TOKEN) {
    Write-Host "  AI 补图：可用（已检测到 python 与生成服务密钥）" -ForegroundColor Green
  } else {
    Write-Host "  AI 补图：未启用（缺生成服务密钥 BUDDY_CLOUD_TOKEN，缺图条目保持干净空位）" -ForegroundColor Yellow
  }
} else {
  Write-Host "  AI 补图：未启用（本机没有可用 python，缺图条目保持干净空位）" -ForegroundColor Yellow
}
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
        # 超时 8 秒：要和前端代理超时（rss.js 的 FEED_PROXY_TIMEOUT_MS = 10 秒）配套，
        # 后端必须比前端先放弃，否则前端先超时就白降级到只有 10 条的 rss2json 了。
        $resp = Invoke-WebRequest -Uri $feedUrl -UseBasicParsing -TimeoutSec 8 `
                -Headers @{ "User-Agent" = "Mozilla/5.0" }
      } catch {
        $msg = ($_.Exception.Message | Out-String).Trim()
        $isTimeout = $msg -match "超时|timed out|Timeout"
        $errCode = if ($isTimeout) { "FETCH_TIMEOUT" } else { "FETCH_FAILED" }
        $errMsg  = if ($isTimeout) { "抓取超时（8 秒）" } else { "抓取失败：$msg" }
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

    # ===== 接口 3：/api/image 取文章页的正文配图（GET /api/image?url=...）=====
    # 为什么需要它：中新网 RSS 完全没有图片字段（enclosure / media:content /
    # media:thumbnail / <img> 实测全部为 0），文章页也没有 og:image（实测索引 -1），
    # 只有文章正文里配了图。沉浸浏览的全屏封面只能从这里拿。
    #
    # 取图规则（2026-10-20 实测 10 篇真实文章）：
    #   ① 只认 /simg/cmshd/ 下的图 —— 这才是真正的正文配图（10 篇里 3 篇有）
    #   ② 取不到就返回 image=$null，前端铺分类渐变底，**不**退而求其次取侧栏图：
    #      实测侧栏图（_zsite / _zsite_sl / _700x1000_zsite_sl）会跨文章重复出现，
    #      同一张 ff77d5fb…_700x1000_zsite_sl.jpeg 同时出现在多篇不同文章里
    #   ③ 入参必须是文章页（路径匹配 YYYY/MM-DD/数字.shtml），
    #      频道首页（如 http://www.chinanews.com/importnews.html）直接
    #      400 NOT_ARTICLE，一个字节都不往外发
    #
    # 返回：{ ok, url, image, cached }（image 为 null = 这篇没有正文配图，走渐变底）
    if ($path -eq "/api/image") {
      if ($ctx.Request.HttpMethod -ne "GET") {
        Send-Json $ctx @{ ok = $false; error = "METHOD_NOT_ALLOWED"; message = "请用 GET" } -statusCode 405
        $ctx.Response.Close()
        continue
      }

      # ---- 第 0 步：取 url 参数 ----
      $articleUrl = ""
      if ($ctx.Request.QueryString["url"]) {
        $articleUrl = ($ctx.Request.QueryString["url"] | Out-String).Trim()
      }
      if ([string]::IsNullOrEmpty($articleUrl)) {
        Send-Json $ctx @{ ok = $false; error = "MISSING_URL"
                          message = "缺少 url 参数，例：/api/image?url=<文章页地址>" } -statusCode 400
        $ctx.Response.Close()
        continue
      }

      # ---- 第 1 步：域名白名单 ----
      $artHost = ""
      try { $artHost = ([Uri]$articleUrl).Host } catch { $artHost = "" }
      if ($ALLOWED_ARTICLE_HOSTS -notcontains $artHost) {
        Send-Json $ctx @{
          ok = $false; error = "DOMAIN_NOT_ALLOWED"
          message = "只允许抓取白名单域名的文章页（当前允许：$($ALLOWED_ARTICLE_HOSTS -join '、')）"
          host = $artHost
        } -statusCode 403
        $ctx.Response.Close()
        continue
      }

      # ---- 第 2 步：必须是文章页（频道首页/栏目页一律拒绝，不发起抓取）----
      # 先剥掉 ? 查询串 与 # 锚点再匹配：否则
      # https://www.chinanews.com.cn/?x=2026/10-20/10718054.shtml
      # 会靠子串匹配骗过裸正则，把频道首页当文章页抓（2026-10-20 实测复现）。
      # 正常文章链接带追踪参数时也能通过（剥掉后仍是文章页形态）。
      $articlePath = $articleUrl -replace '[?#].*$', ''
      if ($articlePath -notmatch $ARTICLE_URL_PATTERN) {
        Send-Json $ctx @{
          ok = $false; error = "NOT_ARTICLE"
          message = "不是文章页（文章页路径形如 /gn/2026/10-20/10718054.shtml），已拒绝抓取"
          url = $articleUrl
        } -statusCode 400
        $ctx.Response.Close()
        continue
      }

      # ---- 第 3 步：命中缓存就直接返回（24 小时内不重复抓）----
      if ($ImageCache.ContainsKey($articleUrl)) {
        $entry = $ImageCache[$articleUrl]
        $ageHours = ((Get-Date) - $entry.time).TotalHours
        if ($ageHours -lt $IMAGE_CACHE_HOURS) {
          Send-Json $ctx @{ ok = $true; url = $articleUrl; image = $entry.image; cached = $true }
          $ctx.Response.Close()
          continue
        }
        $ImageCache.Remove($articleUrl)
      }

      # ---- 第 4 步：抓页面（超时 3 秒，比 RSS 抓取的 8 秒更严）----
      # 3 秒的依据：实测文章页 41~93ms 就返回（平均 63ms），
      # 3 秒已经是很宽松的上限；慢了就放弃，前端铺渐变底。
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $resp = $null
      $fetchErr = ""
      # 源站偶发抖动：同一篇真实文章第一次返回 404、立刻重试就 200（实测复现过）。
      # 所以失败时重试 1 次（间隔 300ms）；成功就不再重试。
      # 影响面很小：沉浸浏览只对"当前 ±1"取图，最坏多花一次 3 秒超时，
      # 前端另有 4 秒兜底超时，不会卡住翻页。
      for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
          $resp = Invoke-WebRequest -Uri $articleUrl -UseBasicParsing -TimeoutSec 3 `
                  -Headers @{ "User-Agent" = "Mozilla/5.0" }
          break
        } catch {
          $fetchErr = ($_.Exception.Message | Out-String).Trim()
          if ($attempt -eq 1) {
            Write-Host "  [取图] 第 1 次失败，$articleUrl —— $fetchErr（重试一次）" -ForegroundColor Yellow
            Start-Sleep -Milliseconds 300
          }
        }
      }

      if (-not $resp) {
        $isTimeout = $fetchErr -match "超时|timed out|Timeout"
        Write-Host "  [取图] 失败（已重试 1 次）$articleUrl —— $fetchErr" -ForegroundColor Yellow
        Send-Json $ctx @{
          ok = $false
          error = $(if ($isTimeout) { "FETCH_TIMEOUT" } else { "FETCH_FAILED" })
          message = $(if ($isTimeout) { "抓取超时（3 秒，已重试 1 次）" } else { "抓取失败（已重试 1 次）：$fetchErr" })
          url = $articleUrl
        } -statusCode $(if ($isTimeout) { 504 } else { 502 })
        $ctx.Response.Close()
        continue
      }

      # ---- 第 5 步：按页面声明的编码解出 HTML（中文不乱码）----
      $ms2 = New-Object IO.MemoryStream
      try { $resp.RawContentStream.Position = 0; $resp.RawContentStream.CopyTo($ms2) } catch { }
      $htmlBytes = $ms2.ToArray()
      $headTxt = [Text.Encoding]::ASCII.GetString($htmlBytes, 0, [Math]::Min(2000, $htmlBytes.Length))
      $htmlEnc = [Text.Encoding]::UTF8
      if ($headTxt -match 'charset\s*=\s*["'']?gb') {
        try { $htmlEnc = [Text.Encoding]::GetEncoding("GB2312") } catch { $htmlEnc = [Text.Encoding]::UTF8 }
      }
      $html = $htmlEnc.GetString($htmlBytes)

      # ---- 第 6 步：只在正文区里找 /simg/cmshd/ 的第一张 ----
      $cIdx = $html.IndexOf('class="content"')
      $body = ""
      if ($cIdx -ge 0) {
        $len = [Math]::Min(40000, $html.Length - $cIdx)
        $body = $html.Substring($cIdx, $len)
      }

      $image = $null
      if ($body.Length -gt 0) {
        $m = [regex]::Match($body, '//i\d*\.chinanews\.com\.cn/simg/cmshd/[^"''\s>]+')
        if ($m.Success) {
          $cand = $m.Value
          # 排除清单：模板图 / 侧栏图 / 缩略图标记
          if ($cand -notmatch 'fileftp' -and $cand -notmatch '_zsite' -and $cand -notmatch '_700x1000') {
            # 相对协议 //i2... 补成 https://i2...
            if ($cand.StartsWith("//")) { $cand = "https:" + $cand }
            # 图片域名再校验一遍（防页面里出现别的域名的图）
            $imgHost = ""
            try { $imgHost = ([Uri]$cand).Host } catch { $imgHost = "" }
            if ($imgHost -match '^i\d*\.chinanews\.com\.cn$') { $image = $cand }
          }
        }
      }

      Write-Host "  [取图] $($articleUrl.Split('/')[-1]) → $(if ($image) { $image } else { '无正文配图（走渐变底）' })"

      # ---- 第 7 步：写缓存并返回（只给 URL，不给 base64）----
      $ImageCache[$articleUrl] = @{ time = (Get-Date); image = $image }
      Send-Json $ctx @{ ok = $true; url = $articleUrl; image = $image; cached = $false }
      $ctx.Response.Close()
      continue
    }

    # ===== 接口 4：/api/ai-image 给缺图的新闻生成配图 =====
    # 前端（js/aiImage.js）在没有可用配图时 POST 过来：
    #   {"id":"n1a2b3c","category":"科技","keywords":["芯片"],"prompt":"……"}
    # 本接口调用 tools/gen_news_image.py 出图并落盘，
    # 返回 {"ok":true,"url":"assets/images/gen/n1a2b3c.png"}
    # 失败时返回 {"ok":false,...}，前端不放占位图标，只留干净空位。
    if ($path -eq "/api/ai-image") {
      if ($ctx.Request.HttpMethod -ne "POST") {
        Send-Json $ctx @{ ok = $false; error = "METHOD_NOT_ALLOWED"; message = "请用 POST" } -statusCode 405
        $ctx.Response.Close()
        continue
      }

      $reader = New-Object IO.StreamReader($ctx.Request.InputStream)
      $req = ($reader.ReadToEnd()) | ConvertFrom-Json

      # 文件名只保留安全字符，防止路径穿越
      $rawId = if ($req.id) { ($req.id | Out-String).Trim() } else { "" }
      $id = [regex]::Replace($rawId, '[^A-Za-z0-9_\-]', '')
      if ([string]::IsNullOrEmpty($id)) { $id = [Guid]::NewGuid().ToString("N").Substring(0, 10) }

      # 生成过就直接复用
      $outRel = "assets/images/gen/$id.png"
      $outAbs = Join-Path $root ($outRel -replace "/", "\")
      if (Test-Path $outAbs) {
        Send-Json $ctx @{ ok = $true; url = $outRel; from = "cached" }
        $ctx.Response.Close()
        continue
      }

      if (-not $pythonExe) {
        # 503：服务端缺少依赖（python），属于"暂时不可用"，不是请求本身有问题
        Send-Json $ctx @{ ok = $false; error = "PYTHON_NOT_FOUND"; message = "本机没有可用的 python，AI 补图不可用" } -statusCode 503
        $ctx.Response.Close()
        continue
      }

      # 描述词写进临时文件再传给脚本：内容长、含引号时更安全
      New-Item -ItemType Directory -Path (Join-Path $root ".data") -Force | Out-Null
      $promptFile = Join-Path $root ".data\ai-prompt-$id.txt"
      [IO.File]::WriteAllText($promptFile, ($req.prompt | Out-String), [Text.Encoding]::UTF8)

      $genScript = Join-Path $root "tools\gen_news_image.py"
      $pyArgs = @(
        $genScript,
        "--id", $id,
        "--category", ($req.category | Out-String).Trim(),
        "--keywords", (($req.keywords | ForEach-Object { $_ }) -join ","),
        "--prompt-file", $promptFile,
        "--python", $pythonExe
      )
      if ($env:BUDDY_CLOUD_TOKEN) { $pyArgs += @("--token", $env:BUDDY_CLOUD_TOKEN) }

      $result = $null
      try {
        # 生成一张图通常要十几秒到一分钟，这里同步等它完成
        $raw = (& $pythonExe @pyArgs 2>$null | Out-String).Trim()
        if ($raw) { $result = $raw | ConvertFrom-Json }
      } catch {
        $result = $null
      }
      Remove-Item $promptFile -Force -ErrorAction SilentlyContinue

      if ($null -ne $result -and $result.ok) {
        Send-Json $ctx @{ ok = $true; url = $result.url; from = $result.from }
      } else {
        $msg = if ($result -and $result.message) { $result.message } else { "AI 补图未成功" }
        Send-Json $ctx @{ ok = $false; error = if ($result) { $result.error } else { "SCRIPT_FAILED" }; message = $msg }
      }
      $ctx.Response.Close()
      continue
    }

    # ===== 接口 5：静态文件 =====
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
