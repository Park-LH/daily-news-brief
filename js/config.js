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

/**
 * 【注意事项（2026-10 实测结果）】
 * 下面 5 个源都是实测通过、能正常抓取的。
 * 早期版本用的 36氪 / 少数派 / 虎嗅 / 知乎每日精选，
 * 在 rss2json 接口上已返回 422/500（源站限制），所以更换为以下源：
 *   科技 → IT之家、Solidot
 *   财经 → 华尔街见闻、BBC中文
 *   生活 → 阮一峰周刊（更新频率较低，每次约 3 条，属正常）
 * 如果将来某个源又失效了，页面会提示"以下源暂时无法访问"，
 * 届时照本节格式替换 url 即可。
 */
const RSS_SOURCES = [
  {
    name: "IT之家",
    url: "https://www.ithome.com/rss/",     // IT之家官方 RSS（科技）
    category: "科技",
    maxItems: 4,
  },
  {
    name: "Solidot",
    url: "https://www.solidot.org/index.rss", // Solidot 官方 RSS（科技）
    category: "科技",
    maxItems: 3,
  },
  {
    name: "华尔街见闻",
    url: "https://dedicated.wallstreetcn.com/rss.xml", // 华尔街见闻 RSS（财经）
    category: "财经",
    maxItems: 4,
  },
  {
    name: "BBC中文",
    url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml", // BBC中文 RSS（财经/国际）
    category: "财经",
    maxItems: 3,
  },
  {
    name: "阮一峰周刊",
    url: "http://www.ruanyifeng.com/blog/atom.xml", // 阮一峰科技爱好者周刊（生活）
    category: "生活",
    maxItems: 3,
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
