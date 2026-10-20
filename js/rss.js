/**
 * ============================================================
 * rss.js —— RSS 抓取与解析工具
 * ============================================================
 * 原理（零基础解释）：
 *   浏览器出于安全限制，不能直接读取别人网站的 RSS 文件，
 *   所以要靠"中间人"帮忙取数据。本项目有两条通道，再加一级兜底：
 *
 *   通道 1（优先）/api/feed —— 本地 start-server.ps1 自带的代理接口
 *     和页面同源，所以没有跨域问题；服务端直接抓源站，
 *     能拿到源站全部条目（中新网实测 30 条，而 rss2json 只给 10 条）。
 *     只有用 start-server 打开页面（http://）时才存在，
 *     直接双击 index.html（file://）时没有服务器，会自动跳过。
 *
 *   通道 2（降级）rss2json —— 免费公共接口，文档 https://rss2json.com
 *     代理不可用（服务器没起、超时、源站报错）时自动退回这里。
 *
 *   通道 3（兜底）两条都失败 → 抛中文错误，
 *     页面沿用现有的"以下源暂时无法访问"提示，不会白屏。
 */

// 本地代理接口路径与超时。
// 超时 10 秒：必须大于服务端的抓取超时（start-server.ps1 里是 8 秒）。
// 否则源站慢到 5 秒时，前端 3 秒就放弃、降级到只给 10 条的 rss2json，
// 而代理本来是能成功的——那就白降级了。
const FEED_PROXY_PATH = "/api/feed";
const FEED_PROXY_TIMEOUT_MS = 10000;   // 必须 > 服务端抓取超时（8 秒）
const RSS2JSON_TIMEOUT_MS = 15000;

/**
 * 从一个 RSS 地址抓取新闻列表（三级降级入口）
 *
 * 顺序：本地代理 /api/feed → rss2json → 抛中文错误（页面显示"源暂时无法访问"）
 * file:// 打开时没有本地服务器，跳过代理直接走 rss2json。
 *
 * @param {string} feedUrl RSS 订阅地址
 * @returns {Array} 新闻数组，每项含 title / link / summary / pubDate
 */
// file:// 直开的提示只打一次（否则 7 个源会重复 7 行一样的 Console）
let fileModeHintShown = false;

async function fetchRss(feedUrl) {
  const started = Date.now();

  // location 在部分环境（如 node 里做单元测试）可能不存在，做个保护
  const hasServer = typeof location !== "undefined" && location.protocol !== "file:";

  // ---- file:// 直开（双击 index.html）：没有本地服务器，只能走 rss2json ----
  // 每个源只返回最新 10 条（本地代理能拿到约 30 条），
  // 科技池候选从约 110 条降到约 40 条，条数明显变少是预期行为，不是故障。
  if (!hasServer && !fileModeHintShown) {
    fileModeHintShown = true;
    console.log(
      "[RSS] 当前是 file:// 直开（双击 index.html）：没有本地服务器，只能走 rss2json，" +
      "每个源只返回最新 10 条（用本地代理能拿到约 30 条）。\n" +
      "[RSS] 因此科技池候选从约 110 条降到约 40 条，各板块条数会明显变少——属正常现象，不是故障。\n" +
      "[RSS] 想拿全量：请用 start-server.bat 打开页面（启用本地代理）。"
    );
  }

  // ---- 通道 1：本地代理（http:// 打开时才存在）----
  if (hasServer) {
    try {
      const items = await fetchViaProxy(feedUrl);
      logFetchResult(feedUrl, "本地代理 /api/feed", items.length, started);
      return items;
    } catch (e) {
      // 代理不可用不算失败，只是让位给下一条通道
      console.warn(`[RSS] 本地代理不可用，降级到 rss2json：${e.message}`);
    }
  }

  // ---- 通道 2：rss2json（失败会抛中文错误，由调用方显示提示）----
  const items = await fetchViaRss2Json(feedUrl);
  logFetchResult(feedUrl, hasServer ? "rss2json（代理已降级）" : "rss2json（file:// 直连）",
                 items.length, started);
  return items;
}

/**
 * 通道 1：走本地服务器代理 /api/feed?url=...
 * 同源请求，没有跨域限制；服务端直连源站，条目不截断。
 */
async function fetchViaProxy(feedUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_PROXY_TIMEOUT_MS);

  let resp, data;
  try {
    resp = await fetch(`${FEED_PROXY_PATH}?url=${encodeURIComponent(feedUrl)}`,
                       { signal: controller.signal });
    // 403/404/500/502/504 都算代理通道失败，交给 rss2json
    if (!resp.ok) {
      throw new Error(`接口返回 HTTP ${resp.status}`);
    }
    data = await resp.json();
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`代理超时（${FEED_PROXY_TIMEOUT_MS} 毫秒）`);
    }
    throw new Error(e && e.message ? e.message : "本地代理不可用");
  } finally {
    clearTimeout(timer);
  }

  // 接口自己也会返回 ok:false（白名单拦截、源站 404、解析失败等）
  if (!data || data.ok !== true) {
    throw new Error((data && data.message) || "代理返回失败");
  }

  const items = Array.isArray(data.items) ? data.items : [];
  // 代理只给 title/link/pubDate/description 四个字段（中新网 RSS 实测
  // 没有 content:encoded，也没有任何图片字段）。
  // 正文 content 不留空：用 description 全文兜底，并打 contentFromSummary 标记，
  // 「摘抄正文」里会据此如实说明"该源只提供摘要"，不让读者以为是全文。
  return items.map(item => ({
    title: stripHtml(item.title || ""),
    link: item.link || "",
    summary: stripHtml(item.description || ""),
    pubDate: item.pubDate || "",
    image: extractImage(item),
    content: stripHtml(item.description || "").slice(0, 3000),
    contentFromSummary: true,
  }));
}

/**
 * 通道 2：走 rss2json 公共接口（代理不可用时的退路）
 * 它会额外整理出 content / thumbnail 字段，但只返回最新 10 条。
 */
async function fetchViaRss2Json(feedUrl) {
  // 拼接公共接口地址，rss_url 参数填入 RSS 地址
  const api = "https://api.rss2json.com/v1/api.json?rss_url="
            + encodeURIComponent(feedUrl);

  // 超时控制：15 秒没回应就放弃，避免页面一直转圈
  // （零基础解释：AbortController 就像一个闹钟，到点强制取消这次请求）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS2JSON_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(api, { signal: controller.signal });
  } catch (e) {
    // fetch 本身失败：断网 / 超时 / 接口被网络屏蔽
    if (e.name === "AbortError") {
      throw new Error("请求超时（15 秒无响应）");
    }
    throw new Error("网络连接失败，请检查是否联网");
  } finally {
    clearTimeout(timer);
  }

  // 把返回的文本解析成 JSON；解析失败说明接口没返回正常数据
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error("接口返回了无法解析的数据");
  }

  // 接口返回 status 为 "ok" 才算成功
  if (data.status !== "ok") {
    throw new Error("该 RSS 源暂时无法抓取");
  }

  // 只保留我们需要的字段，顺便把 HTML 标签从摘要里清掉
  // 注意：个别源即使返回 status=ok 也不带 items 字段，
  // 以前直接 .map 会因为"读不到 items"报错，这里兜底成空数组
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(item => ({
    title: stripHtml(item.title),
    link: item.link,
    summary: stripHtml(item.description || item.summary || ""),
    pubDate: item.pubDate || "",
    image: extractImage(item),   // 新闻配图地址，可能是空字符串

    // 正文全文（纯文字，最多 3000 字）
    // 用途：沉浸浏览里的「摘抄正文」按钮要从全文里挑要点
    // 只存 3000 字是为了省内存；有些源不提供正文，这里会是空字符串
    content: stripHtml(item.content || "").slice(0, 3000),
  }));
}

/**
 * 每个源打一行 Console：走了哪条通道、拿到几条、花了多少毫秒
 * 例：[RSS] scroll-news.xml · 本地代理 /api/feed · 30 条 · 412ms
 * 排查"为什么只有 10 条"时，看这一行就知道是不是降级到了 rss2json。
 */
function logFetchResult(feedUrl, channel, count, started) {
  const name = String(feedUrl).split("/").pop() || feedUrl;
  console.log(`[RSS] ${name} · ${channel} · ${count} 条 · ${Date.now() - started}ms`);
}

/**
 * 去掉文本中的 HTML 标签（如 <p>、<img>），只留纯文字
 * 原理：利用浏览器自带的 DOM 解析，比正则更可靠
 */
function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").trim();
}

/**
 * 提取新闻配图地址（记者/编辑选用的文章封面图）
 * 按优先级依次尝试 3 个地方，找到哪个用哪个，都没有则返回 ""
 *   1. item.thumbnail      —— rss2json 整理好的缩略图字段
 *   2. item.enclosure      —— RSS 标准的附件字段（很多新闻站的封面图放这里）
 *   3. 正文 description 里 —— 有的站把图直接嵌在正文第一段 HTML 里
 */
function extractImage(item) {
  // 1. 缩略图字段
  if (item.thumbnail && item.thumbnail.startsWith("http")) {
    return item.thumbnail;
  }

  // 2. 附件字段（必须是图片类型的附件才用）
  if (item.enclosure && item.enclosure.link
      && (item.enclosure.type || "").startsWith("image")) {
    return item.enclosure.link;
  }

  // 3. 从正文 HTML 里找出第一张 <img> 的地址
  const div = document.createElement("div");
  div.innerHTML = item.description || "";
  const img = div.querySelector("img");
  if (img && img.src && img.src.startsWith("http")) {
    return img.src;
  }

  return "";
}

/**
 * 判断一条文本是否命中某个关键词
 *
 * 中文关键词：直接看有没有这段字（"科技"命中"科技成果"）。
 * 纯字母/数字的关键词（AI、5G、6G 这类）：按"整词"匹配，
 *   前后必须不是字母或数字，否则 "CAI" "AIA" "ShanghaiAI" 都会被 "AI" 命中。
 *   实测反例：CAI / AIA / ShanghaiAI 都不再算命中，而"AI时代""AI重塑"仍算命中。
 */
function matchKeyword(text, word) {
  if (!word) return false;
  const isAscii = /^[A-Za-z0-9+\-.#]+$/.test(word);
  if (!isAscii) return text.includes(word);
  const re = new RegExp("(^|[^A-Za-z0-9])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                        + "([^A-Za-z0-9]|$)", "i");
  return re.test(text);
}

/**
 * 按关键词筛选新闻
 * 用途：某些官方媒体没有细分频道（比如中新网没有专门的科技频道），
 * 只能先抓综合频道，再用关键词把某一类新闻挑出来。
 *
 * 【只匹配标题，不匹配摘要】
 * 以前标题 + 摘要一起匹配，实测 9 条命中里约 4 条是误命中
 * （"快递业务量""消费新空间""医疗队""网络名人行"这类，
 *   关键词其实出现在摘要的枝节里，新闻本身不是科技稿）。
 * 改成只看标题后 9 条 → 5 条，条数少了但条条相关。
 * 代价：个别"标题没写关键词、摘要里才出现"的真科技稿会被漏掉，
 * 权衡下来宁可少而准。
 *
 * @param {Array}  items    新闻数组
 * @param {Array}  keywords 关键词数组；为空数组/不传则原样返回（不做筛选）
 * @returns {Array} 标题中命中任意一个关键词的新闻
 */
function filterByKeywords(items, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return items;
  }
  return items.filter(item => {
    const text = item.title || "";          // 只匹配标题
    return keywords.some(word => matchKeyword(text, word));
  });
}

/**
 * 把新闻归入"政治/科技/财经/生活"四个板块并渲染到页面
 * （渲染逻辑在第 2 步由 app.js 调用，这里只提供数据工具）
 */
