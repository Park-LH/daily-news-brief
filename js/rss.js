/**
 * ============================================================
 * rss.js —— RSS 抓取与解析工具
 * ============================================================
 * 原理（零基础解释）：
 *   浏览器出于安全限制，不能直接读取别人网站的 RSS 文件，
 *   所以我们借助一个免费的公共接口 rss2json，
 *   它帮我们把 RSS 转成好处理的 JSON 数据再传回来。
 *   接口文档：https://rss2json.com  免费额度：每天若干次，够个人使用
 */

/**
 * 从一个 RSS 地址抓取新闻列表
 * @param {string} feedUrl RSS 订阅地址
 * @returns {Array} 新闻数组，每项含 title / link / summary / pubDate
 */
async function fetchRss(feedUrl) {
  // 拼接公共接口地址，rss_url 参数填入 RSS 地址
  const api = "https://api.rss2json.com/v1/api.json?rss_url="
            + encodeURIComponent(feedUrl);

  // 超时控制：15 秒没回应就放弃，避免页面一直转圈
  // （零基础解释：AbortController 就像一个闹钟，到点强制取消这次请求）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

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
 * 把新闻归入"科技/财经/生活"三个板块并渲染到页面
 * （渲染逻辑在第 2 步由 app.js 调用，这里只提供数据工具）
 */
