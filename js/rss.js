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

  const resp = await fetch(api);
  const data = await resp.json();

  // 接口返回 status 为 "ok" 才算成功
  if (data.status !== "ok") {
    throw new Error("RSS 源抓取失败: " + feedUrl);
  }

  // 只保留我们需要的 4 个字段，顺便把 HTML 标签从摘要里清掉
  return data.items.map(item => ({
    title: stripHtml(item.title),
    link: item.link,
    summary: stripHtml(item.description || item.summary || ""),
    pubDate: item.pubDate || "",
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
 * 把新闻归入"科技/财经/生活"三个板块并渲染到页面
 * （渲染逻辑在第 2 步由 app.js 调用，这里只提供数据工具）
 */
