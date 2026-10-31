/**
 * sw.js —— Service Worker：把网站变成可安装、可离线的 APP（2026-10-31 新增）
 *
 * 【策略：网络优先，掉线时用缓存兜底】
 *   - 有网：正常请求，并把成功的响应存进缓存（这样新闻缓存 feed-cache.json
 *     每次有网都会更新，不会一直读旧数据）；
 *   - 掉线：同源请求用缓存顶上（css/js 用 ignoreSearch 匹配，
 *     因为 index.html 引用它们时带 ?v= 版本号，而缓存里存的是不带版本的路径）；
 *   - 页面导航（刷新）掉线时：回退到缓存里的 index.html，APP 仍然打得开。
 *
 * 【第三方请求不拦】rss2json / allorigins 这些跨域接口不强求缓存：
 *   它们经常限流，缓存住了反而让用户一直看旧新闻，掉线时让它自然失败即可。
 *
 * 【版本】SW_CACHE 每次发版要变（tools/bump-asset-version.ps1 会自动改它），
 *   变了浏览器就会丢弃旧缓存、重新预热，用户不会卡在旧版本上。
 */
const SW_CACHE = "daily-news-shell-202610312238";

/* 预热缓存：第一次安装时就把"外壳"存好，之后掉线也能打开 */
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/config.js",
  "./js/app.js",
  "./js/summarize.js",
  "./js/interpret.js",
  "./js/stats.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SW_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())     // 装完立刻启用，不等旧标签页关闭
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SW_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())   // 立刻接管已打开的页面
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 第三方接口不拦

  // 导航请求（刷新/打开 APP）：网络优先，掉线回退到缓存的首页
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SW_CACHE).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // 其他同源请求：网络优先，掉线用缓存（忽略 ?v= 版本号差异）
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(SW_CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || Response.error()))
  );
});
