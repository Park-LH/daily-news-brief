/**
 * ============================================================
 * config.js —— 项目配置文件（修改 RSS 源和分类请看这里）
 * ============================================================
 *
 * 【RSS_SOURCES】新闻源列表
 *   - name:     源的显示名称
 *   - url:      RSS 订阅地址（以 .xml 或 /feed 结尾的链接）
 *   - category: 分类，只能是 "科技" / "财经" / "生活" 三者之一
 *   - maxItems: 最多从这个源取几条新闻
 *
 * 想换源：改 url 即可；想加源：往数组里照格式加一项。
 */

const RSS_SOURCES = [
  {
    name: "36氪",
    url: "https://36kr.com/feed",          // 36氪官方 RSS
    category: "科技",
    maxItems: 4,
  },
  {
    name: "少数派",
    url: "https://www.sspai.com/feed",      // 少数派官方 RSS
    category: "科技",
    maxItems: 3,
  },
  {
    name: "虎嗅",
    url: "https://www.huxiu.com/rss/0.xml", // 虎嗅官方 RSS
    category: "科技",
    maxItems: 3,
  },
  {
    name: "华尔街见闻",
    url: "https://dedicated.wallstreetcn.com/rss.xml", // 华尔街见闻 RSS
    category: "财经",
    maxItems: 4,
  },
  {
    name: "知乎每日精选",
    url: "https://www.zhihu.com/rss",       // 知乎每日精选 RSS
    category: "生活",
    maxItems: 4,
  },
];

/**
 * 【每日简报最多显示的条数】
 * 所有源抓完后，按时间排序，只保留最新的 MAX_NEWS 条。
 */
const MAX_NEWS = 10;

/**
 * ============================================================
 * AI 摘要功能 —— 仅预留接口，第一版不接入
 * ============================================================
 * 现在的实现：直接返回 RSS 自带的摘要，不做任何 AI 处理。
 * 以后想接入 AI（如某个大模型 API），只需修改这个函数，
 * 把 summary 传给 AI 接口并返回结果即可，其他代码无需改动。
 *
 * @param {string} title    新闻标题
 * @param {string} summary  RSS 自带的原始摘要
 * @returns {string}        最终展示用的一句话摘要
 */
async function generateSummary(title, summary) {
  // TODO（未来扩展）: 在这里调用 AI 接口生成更好的摘要
  return summary;
}
