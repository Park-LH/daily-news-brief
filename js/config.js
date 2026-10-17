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
 *   生活 → 什么值得买（日更）、阮一峰周刊（更新频率较低，属正常）
 * 【2026-10-17 补充】生活原来只有"阮一峰周刊"一个源，它是周刊、更新慢，
 *   经常几天没有新文章，导致生活板块天天是空的。
 *   已实测新增"什么值得买"（生活消费类，每天约 10 条更新）。
 *   同期实测不可用（接口返回 500）的候选源，供以后参考，别再试：
 *   果壳 / 三联生活周刊 / 中国国家地理 / 下厨房。
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
  {
    // 2026-10-17 新增：生活板块的日更主力源（实测每天约 10 条）
    // 阮一峰周刊是周刊、更新不稳定，靠它生活板块经常是空的
    name: "什么值得买",
    url: "https://post.smzdm.com/feed",
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
 * 【沉浸浏览：每个专题最多取几条】
 * 沉浸浏览不再"全站统一取最新的 10 条"，而是按 科技 → 财经 → 生活
 * 的顺序，每个专题各取最多这么多条，再拼成一张列表。
 *
 * 为什么要这样：原来按时间统一取前 10 条时，更新慢的专题（比如"生活"）
 * 常常一条都进不来，沉浸浏览里就只剩一两个专题。
 * 改成"每个专题都取"，三个专题就都能刷到。
 *
 * 想让某个专题多出现几条，把这个数字调大即可。
 */
const IMMERSIVE_MAX_PER_CATEGORY = 5;

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
  // 现在的做法：调用 summarize.js 里的本地自动总结，
  // 从原文里挑出最重要的一两句话（不联网、不需要 AI，也不会编造内容）
  //
  // TODO（未来扩展）: 想接入真正的 AI 时，把下面这行替换成调用 AI 接口即可，
  //   例如：return await 某个AI接口(title, summary);
  //   其他所有代码都不用改。
  return summarizeText(summary, 90);

  // 小提示：第二个参数 90 是摘要的字数上限，想更长或更短改这个数字就行
}
