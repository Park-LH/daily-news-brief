/**
 * ============================================================
 * app.js —— 主逻辑：按钮交互 + 抓取 + 页面渲染
 * ============================================================
 * 点击"生成今日简报"后的完整流程：
 *   1. 并行抓取 config.js 里配置的所有 RSS 源
 *      （某个源失败不影响其他源，页面上会标注）
 *   2. 合并所有新闻，按发布时间从新到旧排序，再按每个专题的配额挑出要显示的条
 *   3. 按"政治 / 科技 / 财经 / 生活"分类渲染到对应板块
 *   4. 每条新闻调用 generateSummary()（目前直接返回 RSS 摘要，
 *      以后接入 AI 时只改 config.js 里的这个函数即可）
 */

// 小工具：按 id 获取页面元素
const $ = id => document.getElementById(id);

/**
 * 在页面底部弹出一句中文提示，2.5 秒后自动消失
 * 用途：比如"没有新闻时不允许进入沉浸浏览"这类需要提醒的情况
 */
let toastTimer = null;
function showToast(msg) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2500);
}
/**
 * 只放行 http / https 的链接
 *
 * 为什么需要：新闻的链接和图片地址都来自外部 RSS 源，
 * 万一源里混进 javascript: 这类地址，直接放进 href / src 一点就会执行脚本。
 * 这里统一过滤：不安全的地址一律返回 ""（页面就不显示它了）。
 * （escapeHtml 在 js/summarize.js 里定义，负责把 < > 这类符号变成普通文字）
 */
function safeUrl(url) {
  try {
    const u = new URL(String(url || ""), location.href);
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : "";
  } catch (e) {
    return "";         // 地址本身不合法，当作没有
  }
}

// ---- 沉浸浏览（阶段 1）用到的两个全局变量 ----
// latestNews：本次生成的新闻列表，沉浸浏览要按顺序一张张显示
// immIndex：当前显示的是第几条（从 0 开始数）
// 阶段 2 做上下翻页时，就是改 immIndex 再重新渲染卡片
let latestNews = [];
let immIndex = 0;

// 列表页当前显示的新闻（配图补图时按 id 反查用）
let shownNews = [];

// 页面打开时，在页头显示今天的日期
$("dateText").textContent = new Date().toLocaleDateString("zh-CN", {
  year: "numeric", month: "long", day: "numeric", weekday: "long",
});

/**
 * 把时间字符串/时间戳转成"今天 14:30"这种友好格式
 */
function formatTime(pubDate) {
  if (!pubDate) return "";
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 生成"来源"显示文案：媒体机构 · 频道
 * 例：中国新闻社 · 中新网要闻
 * 每条新闻都会保留 publisher（媒体机构）和 source（频道）两个字段，
 * 页面上把机构放在前面，方便一眼看出是哪家媒体发的。
 */
function formatSourceLabel(news) {
  const publisher = news.publisher || "";
  const channel = news.source || "";
  if (publisher && channel) return `${publisher} · ${channel}`;
  return publisher || channel || "未知来源";
}

/**
 * 渲染单个分类板块
 * @param {string} category 分类名："政治" / "科技" / "财经" / "生活"
 * @param {Array}  newsList 该分类下的新闻数组
 */
function renderCategory(category, newsList) {
  const section = $("cat-" + category);
  const list = section.querySelector(".news-list");
  const title = section.querySelector("h2");

  // 更新标题右侧的条数徽章（先移除旧的，再加新的）
  title.querySelector(".count-badge")?.remove();
  const badge = document.createElement("span");
  badge.className = "count-badge";
  badge.textContent = newsList.length + " 条";
  title.appendChild(badge);

  if (newsList.length === 0) {
    list.innerHTML = '<div class="news-item" style="color:#94a3b8">今日暂无该分类新闻</div>';
    return;
  }

  list.innerHTML = newsList.map(news => {
    // 重要：标题、摘要、来源都是外部 RSS 给的文本，
    // 必须先转义再插入页面，否则里面带 < > 会破坏页面结构，
    // 带脚本更会被浏览器直接执行（这是之前漏掉的一个安全隐患）
    const img = safeUrl(news.image);
    const link = safeUrl(news.link);
    return `
    <article class="news-item">
      ${img
        // 有图：直接显示，不放任何角标/边框/水印等装饰
        ? `<img class="news-thumb" data-news-id="${escapeHtml(news.id)}"
             src="${escapeHtml(img)}" alt="新闻配图" loading="lazy">`
        // 无图：留一块干净的空位（不再是 🖼️ 占位图标），
        //      随后由 aiImage.js 用素材库或 AI 生成补上
        : `<div class="news-thumb news-thumb-empty"
             data-news-id="${escapeHtml(news.id)}"></div>`}
      <div class="news-body">
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(news.title)}</a>
        <div class="summary">${escapeHtml(news.summary || "（这条新闻没有自带摘要，点击标题查看原文）")}</div>
        <div class="meta">
          <span>来源：${escapeHtml(formatSourceLabel(news))}</span>
          ${news.time ? `<span>${escapeHtml(news.time)}</span>` : ""}
        </div>
      </div>
    </article>
  `;
  }).join("");

  // 源图打不开（链接失效、防盗链等）时：
  // 换成一块干净的空位（不再放 🖼️ 占位图标），再交给 AI 生成补一张
  list.querySelectorAll("img.news-thumb").forEach(el => {
    el.addEventListener("error", () => {
      const box = document.createElement("div");
      box.className = "news-thumb news-thumb-empty";
      if (el.dataset.newsId) box.dataset.newsId = el.dataset.newsId;
      el.replaceWith(box);

      const news = shownNews.find(n => n.id === el.dataset.newsId);
      if (news) {
        news.image = "";          // 标记这条其实没图，交给补图流程
        ensureNewsImage(news);
      }
    });
  });
}

/* ============================================================
   沉浸浏览（抖音式卡片）—— 阶段 1：只负责"把一条新闻画成卡片"
   后面阶段会在此基础上加：上下翻页（阶段2）、手势（阶段3）、
   正式的视图切换开关（阶段4）
   ============================================================ */

/* ============================================================
   封面图：/api/image 取正文配图（失败静默降级到分类渐变底）
   ============================================================ */

// 文章页形态（整体锚定）：https://www.chinanews.com.cn/gn/2026/10-20/10718054.shtml
// 频道首页（/importnews.html）不匹配 —— 它里面有列表缩略图，会被误当封面。
// ⚠️ 必须整体锚定（^...$）+ 先剥掉 ? 查询串：
// 旧版裸 /\d{4}\/\d{1,2}-\d{1,2}\/\d+\.shtml/ 会被
// https://www.chinanews.com.cn/?x=2026/10-20/10718054.shtml 的子串命中绕过
// （2026-10-20 实测复现：服务端 200 并真去抓了频道首页）。
const ARTICLE_URL_RE =
  /^https?:\/\/(?:www\.)?chinanews\.com\.cn(?:\/[a-z0-9-]{2,10})*\/\d{4}\/\d{1,2}-\d{1,2}\/\d+\.shtml\/?$/i;
const ARTICLE_HOSTS = ["www.chinanews.com.cn", "chinanews.com.cn"];
const IMAGE_API_PATH = "/api/image";
const IMAGE_API_TIMEOUT_MS = 4000;   // 服务端自己 3 秒就放弃，这里只是兜底
const ARTICLE_API_PATH = "/api/article";        // 取文章页正文全文（给「摘抄正文」用）
const ARTICLE_API_TIMEOUT_MS = 6000;  // 正文比图大一点，留 6 秒兜底

/**
 * 判断一个链接是不是"文章页"
 * 不是文章页就不请求 /api/image——省一次往返，也避免拿到频道页的列表缩略图
 */
function isArticleUrl(url) {
  if (!/^https?:\/\//i.test(url || "")) return false;
  // 剥掉 ? 查询串 与 # 锚点：否则 ?x=2026/10-20/10718054.shtml 这类尾巴
  // 会让子串匹配把频道首页误判成文章页（与后端同一套规则）。
  const clean = String(url).replace(/[?#].*$/, "");
  let host = "";
  try { host = new URL(clean).host; } catch (e) { return false; }
  if (!ARTICLE_HOSTS.includes(host)) return false;
  return ARTICLE_URL_RE.test(clean);
}

/**
 * 向 /api/image 要这条新闻的正文配图
 *
 * 取不到（文章本来没配图 / 超时 / 源站报错）一律静默返回 null，
 * 页面保持分类渐变底，不放任何占位图标。每条只请求一次（imageApiDone 标记）。
 *
 * @returns {Promise<string|null>} 图片地址，拿不到就是 null
 */
async function fetchArticleImage(news) {
  if (!news || news.imageApiDone) return news && news.image ? news.image : null;
  news.imageApiDone = true;

  if (!isArticleUrl(news.link)) return null;   // 非文章页直接不发请求

  if (typeof location !== "undefined" && location.protocol === "file:") return null; // 没服务器

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_API_TIMEOUT_MS);
  try {
    const r = await fetch(`${IMAGE_API_PATH}?url=${encodeURIComponent(news.link)}`,
                          { signal: ctrl.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const img = (data && data.ok && data.image) ? data.image : null;
    console.log(`[取图] ${(news.title || "").slice(0, 16)}… → `
      + (img ? img : "无正文配图（走渐变底）") + ` · ${Date.now() - started}ms`
      + (data && data.cached ? " · 命中缓存" : ""));
    if (img) news.image = img;
    return img;
  } catch (e) {
    console.log(`[取图] 失败，静默降级到渐变底：${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 向 /api/article 要这条新闻的**正文全文**
 *
 * 为什么需要它：RSS 只给一句导语（description），像"致信 / 讲话 / 报告"这类
 * 新闻的重要要点全在文章页正文里——只摘导语就会漏掉最关键的内容
 * （2026-10-23 用户实测反馈：致信类新闻的摘抄缺了信件要点）。
 * 拿到正文后写回 news.content，并把 contentFromSummary 置为 false，
 * 「摘抄正文」据此标注"摘自文章页正文"。取不到就保持原样（退回摘要，不谎报）。
 *
 * @returns {Promise<string>} 正文全文；拿不到就是空字符串
 */
async function fetchArticleBody(news) {
  if (!news || news.bodyApiDone) {
    return (news && news.contentFromSummary === false) ? (news.content || "") : "";
  }
  news.bodyApiDone = true;

  if (!isArticleUrl(news.link)) return "";      // 非文章页直接不发请求
  if (typeof location !== "undefined" && location.protocol === "file:") return "";

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ARTICLE_API_TIMEOUT_MS);
  try {
    const r = await fetch(`${ARTICLE_API_PATH}?url=${encodeURIComponent(news.link)}`,
                          { signal: ctrl.signal });
    if (!r.ok) return "";
    const data = await r.json();
    const text = (data && data.ok && data.text) ? String(data.text) : "";
    console.log(`[取正文] ${(news.title || "").slice(0, 16)}… → ${text.length} 字`
      + ` · ${Date.now() - started}ms` + (data && data.cached ? " · 命中缓存" : ""));
    if (text) {
      news.content = text;
      news.contentFromSummary = false;   // 现在是文章页正文，不再是 RSS 摘要
    }
    return text;
  } catch (e) {
    console.log(`[取正文] 失败，摘抄时退回 RSS 摘要：${e.message}`);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 异步取图，拿到后如果这条还停在当前页，就把封面淡入到卡片上
 * （P6：无图时卡片已经是分类渐变底，图片 onload 后 0.3s 淡入，不会闪白）
 */
async function requestArticleCover(news) {
  const img = await fetchArticleImage(news);
  if (!img || !latestNews.length) return;
  if (latestNews[immIndex] !== news) return;    // 用户已经翻走了，不动 DOM
  const media = document.querySelector(".imm-media");
  if (!media || media.querySelector("img")) return;
  const el = new Image();
  el.className = "imm-cover";
  el.alt = "新闻封面";
  el.onload = () => el.classList.add("loaded");  // 加载完才淡入（见 style.css）
  el.onerror = () => el.remove();                // 打不开就撤掉，留渐变底
  el.src = img;
  media.appendChild(el);
}

/**
 * 预加载封面图：提前把"后 2 条 + 前 1 条"的图片下载好，
 * 这样手指滑过去时不会先白一下才出图。
 * 另外对"当前 ±1"各调一次 /api/image（不全量抓，只备相邻两条）。
 * 加载失败不用管——卡片里保留分类渐变底，不会出现占位图标。
 */
function preloadNeighborImages() {
  const total = latestNews.length;
  if (!total) return;

  [1, 2, -1].forEach(offset => {
    const news = latestNews[(immIndex + offset + total) % total];
    const url = news && safeUrl(news.image);
    if (!url) return;
    const img = new Image();      // 只下载到浏览器缓存里，不插进页面
    img.onerror = () => {};       // 失败就失败，不影响使用
    img.src = url;
  });

  // 只对"前一条 / 后一条"补取正文配图（当前这条由 renderImmersiveCard 负责）
  [1, -1].forEach(offset => {
    const news = latestNews[(immIndex + offset + total) % total];
    if (news) fetchArticleImage(news);
  });
}

/**
 * 挑出「列表页」要显示的新闻：每个板块各取 CATEGORY_QUOTA 里配的条数
 *
 * 为什么不直接取"全局最新 N 条"：政治源（中新网）更新很密，
 * 一口气就能把名额占满，其他专题会被挤成空板块。
 * 给每个板块留配额，四个板块就都有内容。
 * 配额统一在 config.js 的 CATEGORY_QUOTA 里改，不要在这里写死数字。
 *
 * @param {Array} sortedNews 已按时间从新到旧排好序的新闻数组
 * @returns {Array} 列表页要显示的数组（仍按时间从新到旧）
 */
/**
 * 在一个板块内挑新闻：先按板块配额，再按"每个源最多几条"限流
 *
 * 为什么要限每个源：更新最密的源会把整个板块占满。
 * 实测生活板块前 5 条全部来自「中新网文化」（日更 30 条），
 * 健康 / 生活两个源一条都进不来 —— 板块叫"生活"，内容却只有文化新闻。
 * 限流后同一源在一个板块里最多出 MAX_PER_SOURCE_IN_CATEGORY 条。
 *
 * @param {Array}  sortedNews 已按时间从新到旧排好序的新闻
 * @param {string} category   板块名
 * @returns {Array} 该板块要显示的新闻
 */
function pickCategoryNews(sortedNews, category) {
  const quota = categoryQuota(category);
  // 限流前的候选条数（排查"板块为空/条数不足"时，先分清是"候选就少"还是"被限流砍了"）
  const candidate = sortedNews.filter(n => n.category === category).length;

  // 按源分组（组内保持时间顺序）
  const bySource = new Map();
  for (const news of sortedNews) {
    if (news.category !== category) continue;
    if (!bySource.has(news.source)) bySource.set(news.source, []);
    bySource.get(news.source).push(news);
  }

  // 单一来源的板块（比如"财经"目前只有中新网财经一个源）不做限流：
  // 限了也还是它一家，只会把板块从 4 条砍成 2 条。
  const cap = bySource.size > 1 ? MAX_PER_SOURCE_IN_CATEGORY : quota;

  // 轮询分配：每个源先各出 1 条，再各出第 2 条……
  // 比"顺序遍历 + 硬截断"更好——既保证多源都露脸，又不会因为
  // 头部几个源就把名额用光导致板块提前填不满。
  const used = new Map();
  const picked = [];
  while (picked.length < quota) {
    let added = false;
    for (const [src, arr] of bySource) {
      if (picked.length >= quota) break;
      const n = used.get(src) || 0;
      if (n >= Math.min(cap, arr.length)) continue;   // 这个源已到上限
      used.set(src, n + 1);
      picked.push(arr[n]);
      added = true;
    }
    if (!added) break;                                 // 所有源都取完了
  }

  // 分环节条数（真机验收排查用，2026-10-24 加）：
  // 一行看清 候选 → 限流上限 → 配额 → 实取，以及每个源各贡献了几条
  const perSource = [...bySource]
    .map(([src, arr]) => `${src} ${Math.min(used.get(src) || 0, arr.length)}/${arr.length}`)
    .join("、") || "无";
  console.log(`[限流] ${category}：候选 ${candidate} 条（${bySource.size} 个源，单源上限 ${cap}）`
    + ` → 配额 ${quota} → 实取 ${picked.length} 条 ｜ 各源贡献：${perSource}`);

  return picked;
}

function buildListNews(sortedNews) {
  const CATEGORY_ORDER = ["政治", "科技", "财经", "生活"];
  const list = [];
  const pickedByCat = {};
  for (const category of CATEGORY_ORDER) {
    const one = pickCategoryNews(sortedNews, category);
    pickedByCat[category] = one.length;
    list.push(...one);
  }
  // 拼好后重新按时间排一次，页面上的顺序仍是"最新在前"
  list.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // 配额环节：拼齐多少条、按 MAX_NEWS 截取后剩多少条
  const final = list.slice(0, MAX_NEWS);
  console.log(`[配额] 四板块拼齐 ${list.length} 条 → 按 MAX_NEWS(${MAX_NEWS}) 截取后 ${final.length} 条`);
  console.log(`[配额] 各板块实取：`
    + CATEGORY_ORDER.map(c => `${c} ${pickedByCat[c] || 0}`).join(" ｜ "));
  return final;
}

/**
 * 去重 + 板块互斥 + 科技池归类（多频道池的关键一步）
 *
 * 三件事，缺一不可：
 *   1）按 link 去重：四个频道合并后，同一条新闻常被多个频道重复收录
 *      （实测 120 条里 22 条 URL 完全重复，约 18%），不去重会重复展示。
 *   2）板块互斥：一条新闻只能归一个板块，优先级 科技 > 财经 > 政治 > 生活。
 *      来自科技池、且**标题**命中科技关键词的 → 科技；
 *      其余按来源频道本来的板块（财经 / 政治 / 生活）。
 *      这样科技池抽走财经频道的科技稿时，财经板块不会再留同一条，
 *      不会出现"同一条新闻两个板块都有"。
 *   3）Console 打印每一步的条数，方便核对。
 *
 * @param {Array} newsList 已按时间过滤、但还没去重的新闻数组
 * @returns {Array} 去重并定好板块的数组（仍保持传入顺序）
 */
/**
 * 标题归一化：去掉空白与标点，只留汉字/字母/数字，供"标题相似度"比对用
 * 例：「我国在脑机接口领域…」和「中国在脑机接口领域…」归一化后只差前两字
 */
function normalizeTitle(title) {
  return String(title || "")
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。、；：？！“”‘’（）《》〈〉·…\-—_,.:;?!'"()[\]{}|/\\]/g, "");
}

/**
 * 判断两条标题是不是同一篇稿子
 *
 * 两个条件满足其一就算重复：
 *   ① 共同前缀 ≥ 14 字（去标点后）——同一篇稿子换个频道发，常只改开头
 *      （"我国/中国""XX 报道："这类），共同前缀很长。
 *   ② 二元字符组 Jaccard 相似度 ≥ 0.85——同一篇稿子被改了开头几个字的情况。
 *
 * 不用"前 12 字完全相同"：系列报道（…之一/之二）会被误删，实测风险太高。
 */
function isSimilarTitle(normA, normB) {
  if (!normA || !normB) return false;

  // ① 共同前缀
  let same = 0;
  const min = Math.min(normA.length, normB.length);
  while (same < min && normA[same] === normB[same]) same++;
  let similar = same >= 14;

  // ② Jaccard（按相邻两字切分，中文按字切太粗、按词切要分词库）
  if (!similar) {
    const setA = new Set();
    const setB = new Set();
    for (let i = 0; i + 1 < normA.length; i++) setA.add(normA.slice(i, i + 2));
    for (let i = 0; i + 1 < normB.length; i++) setB.add(normB.slice(i, i + 2));
    let inter = 0;
    setA.forEach(g => { if (setB.has(g)) inter++; });
    const union = setA.size + setB.size - inter;
    similar = union > 0 && inter / union >= 0.85;
  }

  // ③ 系列报道豁免：相似，但差异点正好落在序列标记上（之一/之二、第1篇/第2篇…）
  //    属于同一系列的不同篇，不是同稿重复，不能删。
  //    实测反例：「第三届粤港澳大湾区文化艺术节系列活动之一开幕」vs「…之二开幕」，
  //    共同前缀 19 字、Jaccard 也远超 0.85，不豁免就会被误删一条。
  if (similar) {
    let k = 0;
    const m = Math.min(normA.length, normB.length);
    while (k < m && normA[k] === normB[k]) k++;
    const restA = normA.slice(k);
    const restB = normB.slice(k);
    const seq = /^[一二三四五六七八九十\d]/;
    if (seq.test(restA) && seq.test(restB) && restA[0] !== restB[0]) return false;
  }

  return similar;
}

/**
 * 去重 + 板块互斥 + 科技池归类（多频道池的关键一步）
 *
 * 三件事，缺一不可：
 *   1）去重，两轮：
 *      a. 按 link 完全去重（同一条新闻被多个频道收录时 link 相同）
 *      b. 标题相似度去重（实测存在 link 不同、标题只差一两个字的同稿，
 *         如「我国在脑机接口领域…」与「中国在脑机接口领域…」）
 *      被判重复的"标题对"会整对打印出来，方便人工核对有没有误删。
 *   2）板块互斥：一条新闻只能归一个板块，优先级 科技 > 财经 > 政治 > 生活。
 *      来自科技池、且**标题**命中科技关键词、且不含排除词的 → 科技；
 *      其余按来源频道本来的板块（财经 / 政治 / 生活）。
 *   3）Console 打印每一步的条数，方便核对。
 *
 * @param {Array} newsList 已按时间过滤、但还没去重的新闻数组
 * @returns {Array} 去重并定好板块的数组（仍保持传入顺序）
 */
function dedupeAndAssignCategories(newsList) {
  // ---- 1. 去重：link 完全重复 + 标题相似重复 ----
  const seenLinks = new Map();     // link → 已保留的标题（打印重复对时用）
  const list = [];
  const dupPairs = [];             // [被丢掉的标题, 已保留的标题]
  let linkDup = 0, titleDup = 0;

  for (const news of newsList) {
    const link = (news.link || "").trim();
    const norm = normalizeTitle(news.title);
    if (!link && !norm) continue;

    if (link && seenLinks.has(link)) {
      dupPairs.push([news.title, seenLinks.get(link), "link 相同"]);
      linkDup++;
      continue;
    }
    let similarTo = null;
    for (const kept of list) {
      if (isSimilarTitle(norm, normalizeTitle(kept.title))) { similarTo = kept; break; }
    }
    if (similarTo) {
      dupPairs.push([news.title, similarTo.title, "标题相似"]);
      titleDup++;
      continue;
    }

    if (link) seenLinks.set(link, news.title);
    list.push(news);
  }

  console.log(`[去重] ${newsList.length} 条 → ${list.length} 条`
    + `（去掉 ${newsList.length - list.length} 条：link 重复 ${linkDup} 条、标题相似 ${titleDup} 条）`);
  if (dupPairs.length) {
    console.log(`[去重] 被判为重复的标题对（共 ${dupPairs.length} 对，供人工核对）：`);
    dupPairs.forEach(([dropped, kept, why], i) => {
      console.log(`   ${i + 1}. [${why}] 丢弃：${dropped}`);
      console.log(`      保留：${kept}`);
    });
  } else {
    console.log("[去重] 本次没有判出重复条目");
  }

  // ---- 2. 板块互斥：科技优先，命中但含排除词的打回原板块 ----
  const poolCount = list.filter(n => n.inTechPool).length;
  const excluded = [];
  let techCount = 0;
  let hitCount = 0;                                 // 命中科技关键词的条数（排除词打回前）
  for (const news of list) {
    if (!news.inTechPool) continue;                 // 不在池里的保持原板块

    const hitTech = filterByKeywords([news], TECH_KEYWORDS).length > 0;
    if (hitTech) hitCount++;
    if (!hitTech) {
      // 综合滚动频道：没命中就不进任何板块（这些新闻其他频道已收录）
      if (news.poolOnly) news.category = "";
      continue;
    }

    // 命中科技词，但标题里有"政治化/双开/宣讲…"这类排除词 → 不算科技
    const hitExclude = TECH_EXCLUDE_WORDS.filter(w => (news.title || "").includes(w));
    if (hitExclude.length > 0) {
      excluded.push(`${news.title}（命中排除词：${hitExclude.join("、")}）`);
      // 排除后仍要走 poolOnly 判断：滚动频道的条目本来就没别的板块可去
      if (news.poolOnly) news.category = "";
      continue;                                     // 非滚动的保留原板块（政治/财经）
    }

    news.category = "科技";
    techCount++;
  }
  console.log(`[科技池] 候选 ${poolCount} 条 → 命中科技关键词 ${techCount} 条`
    + (excluded.length ? `，被排除词打回 ${excluded.length} 条` : ""));
  if (excluded.length) {
    console.log("[科技池] 命中但被排除词打回原板块的条目：");
    excluded.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  }
  // 板块互斥单独打一行：池里多少条、命中多少、被排除词打回多少、没命中留在原板块多少
  console.log(`[板块互斥] 池中 ${poolCount} 条 → 命中关键词 ${hitCount} 条`
    + `（其中被排除词打回 ${excluded.length} 条）→ 最终归科技 ${techCount} 条`
    + `，未命中留在原板块 ${poolCount - hitCount} 条`);

  // 过滤掉没有板块的（只有 poolOnly 且未命中的会走到这里）
  const result = list.filter(news => news.category);
  console.log(`[分板块] ${result.length} 条进入板块：`
    + ["政治", "科技", "财经", "生活"]
        .map(c => `${c} ${result.filter(n => n.category === c).length}`).join(" ｜ "));
  return result;
}

/**
 * 组装「沉浸浏览」要看的新闻列表
 *
 * 做法：按 政治 → 科技 → 财经 → 生活 的顺序，每个专题各取
 * CATEGORY_QUOTA 里配的条数（与列表页共用同一张配额表），再依次拼起来。
 * 这样四个专题都能刷到，不会出现"只剩一两个专题"的情况。
 *
 * @param {Array} sortedNews 已经按时间从新到旧排好序的新闻数组
 * @returns {Array} 沉浸浏览要显示的列表
 */
function buildImmersiveList(sortedNews) {
  const CATEGORY_ORDER = ["政治", "科技", "财经", "生活"];   // 沉浸浏览里的专题顺序
  const list = [];

  for (const category of CATEGORY_ORDER) {
    // 与列表页共用 pickCategoryNews：板块配额 + 每个源最多几条
    list.push(...pickCategoryNews(sortedNews, category));
  }

  // 打印每个专题各进了几条，方便核对（浏览器 F12 → Console 可见）
  const counts = CATEGORY_ORDER
    .map(c => `${c} ${list.filter(n => n.category === c).length} 条`)
    .join(" / ");
  console.log(`[沉浸浏览] 共 ${list.length} 条 —— ${counts}`);

  return list;
}

/**
 * 把当前这条新闻（latestNews[immIndex]）画成一张全屏卡片
 */
function renderImmersiveCard() {
  const card = $("immCard");

  // 翻页会重建卡片内容，所以这里先取消"摘抄最大化"状态，
  // 否则摘抄展开着翻页，新卡片会沿用一个不合适的布局
  card.classList.remove("excerpt-open");

  // 还没生成新闻：显示一句提示，避免空白
  if (!latestNews.length) {
    $("immCounter").textContent = "第 0 / 0 条";
    card.innerHTML = '<div class="imm-empty-card">还没有新闻，请先回到列表页生成今日简报</div>';
    return;
  }

  const news = latestNews[immIndex];

  // 顶部显示"专题 · 第 N / M 条"，一眼知道在看哪个专题、第几条
  $("immCounter").textContent =
    `${news.category} · 第 ${immIndex + 1} / ${latestNews.length} 条`;

  // 底部进度条：宽度按"第几条 / 共几条"算
  $("immProgress").style.width =
    ((immIndex + 1) / latestNews.length * 100).toFixed(2) + "%";

  // 图片地址同样要先过滤，只放行 http/https（见 safeUrl 的说明）
  const cover = safeUrl(news.image);
  const link = safeUrl(news.link);

  card.innerHTML = `
    <!-- 上半屏：封面图。没图时这里显示 data-category 对应的分类渐变底（见 style.css）；
         有图时先铺渐变底，图片 onload 后加 .loaded 做 0.3s 淡入，不会闪白块 -->
    <div class="imm-media" data-news-id="${escapeHtml(news.id)}"
         data-category="${escapeHtml(news.category)}">
      ${cover
        ? `<img class="imm-cover" src="${escapeHtml(cover)}" alt="新闻封面"
             onload="this.classList.add('loaded')"
             onerror="this.remove()">`   // 图片打不开就撤掉，只留渐变底
        : ""}
    </div>

    <!-- 下半屏：标题（大字号）+ 自动摘要（大字号）+ 来源时间 + 两个按钮 -->
    <div class="imm-info">
      <h3 class="imm-title">${escapeHtml(news.title)}</h3>

      <!-- 自动总结出来的一句话摘要 -->
      <p class="imm-summary" id="immSummary">${
        escapeHtml(news.summary || "（这条新闻没有自带摘要，点下方按钮查看原文）")
      }</p>

      <!-- 「摘抄正文」展开后显示在这里，默认隐藏 -->
      <div class="imm-excerpt hidden" id="immExcerpt"></div>

      <div class="imm-meta">
        <span>来源：${escapeHtml(formatSourceLabel(news))}</span>
        ${news.time ? `<span>${news.time}</span>` : ""}
      </div>

      <!-- 两个独立按钮：左边摘抄正文，右边打开原文 -->
      <div class="imm-actions">
        <button class="imm-btn-sub" id="immExcerptBtn">📄 摘抄正文</button>
        <a class="imm-open" href="${escapeHtml(link)}" target="_blank" rel="noopener">
          打开原文 ↗
        </a>
      </div>
    </div>
  `;

  // 同步取一次"源站正文配图"（/api/image）。
  // 卡片已经铺好分类渐变底，取到图就淡入，取不到就一直是渐变底，不闪白块。
  requestArticleCover(news);

  // 提前把这篇的**正文全文**取下来（/api/article）：
  // 用户点「摘抄正文」时能立刻出要点。尤其"致信 / 讲话 / 报告"类新闻，
  // 要点只在文章页正文里，只摘 RSS 那句导语会漏掉最关键的内容。
  fetchArticleBody(news);

  // 这条还没有任何封面图 → 交给 aiImage.js（素材库 → AI 生成）补一张，
  // 补到之后会自动填进上面这张卡片（不放任何占位图标）
  if (!cover) ensureNewsImage(news);

  // 趁当前这条在看的时候，把前后几条的图片先下载好（见 preloadNeighborImages）
  preloadNeighborImages();
}

/**
 * 展开 / 收起「正文摘抄」
 * 从这条新闻的正文全文里挑出几条要点显示出来；
 * 正文取不到（或这个源本来就不提供）时退回原始摘要，并如实标注来源
 */
function toggleExcerpt() {
  const news = latestNews[immIndex];
  if (!news) return;

  const panel = $("immExcerpt");
  const summary = $("immSummary");
  const btn = $("immExcerptBtn");
  if (!panel || !summary || !btn) return;

  const isHidden = panel.classList.contains("hidden");

  if (isHidden) {
    // ---- 展开：先把面板显示出来（写"正在读取正文…"），正文到手后再填要点 ----
    // 为什么先展开：正文要从文章页现取（RSS 只有一句导语），
    // 先给反馈，别让用户点了没反应。
    panel.innerHTML =
      `<div class="imm-excerpt-title">📌 ${escapeHtml(news.category)} · 正文要点</div>
       <p class="imm-excerpt-empty">正在读取正文…</p>`;
    panel.classList.remove("hidden");
    summary.classList.add("hidden");   // 摘抄展开时先收起一句话摘要，省地方
    btn.textContent = "收起摘抄 ✕";

    // 关键：给卡片加上"摘抄模式"，CSS 会把封面图收起、文字区放满整屏，
    // 摘抄区域因此拿到最大高度（见 style.css 的 .excerpt-open）
    $("immCard").classList.add("excerpt-open");

    // 正文全文到位后再渲染要点（异步，不卡 UI）
    renderExcerptPoints(news, panel);
  } else {
    // ---- 收起：恢复显示一句话摘要 ----
    panel.classList.add("hidden");
    summary.classList.remove("hidden");
    btn.textContent = "📄 摘抄正文";
    $("immCard").classList.remove("excerpt-open");
  }
}

/**
 * 渲染「正文要点」到摘抄面板
 *
 * 要点来源分两种情况，**必须在标题里如实标注**，不能把摘要冒充成全文：
 *   ① 拿到文章页正文（contentFromSummary === false）→ 从全文里摘 5 条
 *   ② 只有 RSS 的 description 导语            → 从导语里摘 4 条，并写明"该源只提供摘要"
 *
 * 为什么必须取全文：中新网 RSS 的 description 常常只有一句导语，
 * "致信 / 讲话 / 报告"这类新闻的核心要点（讲了哪几点）全在文章页正文里，
 * 只摘导语会让摘抄漏掉最重要的内容（2026-10-23 用户实测反馈）。
 *
 * @param {Object} news  新闻对象
 * @param {HTMLElement} panel 摘抄面板（#immExcerpt）
 */
async function renderExcerptPoints(news, panel) {
  // RSS 只给导语时，先从文章页把正文全文取回来（卡片渲染时已预取，通常已就绪）
  if (news.contentFromSummary !== false) await fetchArticleBody(news);

  // 用户可能在等待期间翻页或收起了摘抄：这时不要再往旧面板里塞内容
  const livePanel = document.getElementById("immExcerpt");
  if (latestNews[immIndex] !== news || !livePanel ||
      livePanel.classList.contains("hidden") || livePanel !== panel) return;

  const fromFullText = news.contentFromSummary === false;   // true = 文章页正文
  const source = news.content || news.rawSummary || news.summary || "";
  const points = extractKeyPoints(source, fromFullText ? 5 : 4);

  // 标题要如实说明要点来源（undefined = rss2json 通道，它给的是完整 content）
  const titleNote = fromFullText
    ? "正文要点（摘自文章页正文）"
    : (news.contentFromSummary === true
        ? "正文要点（该源只提供摘要，以下摘自 RSS 摘要全文）"
        : "正文要点（自动摘抄）");

  panel.innerHTML = points.length
    ? `<div class="imm-excerpt-title">📌 ${escapeHtml(news.category)} · ${titleNote}</div>
       <ul>${points.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
    : `<div class="imm-excerpt-title">📌 ${escapeHtml(news.category)} · 正文要点</div>
       <p class="imm-excerpt-empty">没能读到这条新闻的正文，
       点右边「打开原文 ↗」可以看完整文章。</p>`;
}

// 用事件委托绑定按钮：因为卡片每次翻页都会重新生成，
// 直接绑在按钮上会失效，绑在不变的父容器 #immCard 上最稳
$("immCard").addEventListener("click", e => {
  if (e.target.closest("#immExcerptBtn")) toggleExcerpt();
});

/* ---------- 阶段 2：上下翻页 ---------- */

// 滚轮"静默检测"用的参数（单位：毫秒）
// 触控板一次慢速长滑会在 0.5 秒里连发几十个 wheel 事件。
// 以前用"翻完锁 320 毫秒"的死办法，锁一过就可能再翻一条，
// 结果滑一次翻了两条。现在改成：只要还在滚就一直不解锁，
// 必须等滚动真正停下 WHEEL_IDLE_MS 毫秒，才允许下一次翻页。
const WHEEL_IDLE_MS = 120;

/**
 * 跳到指定的一条新闻，并播放滑入动画
 * @param {number} index     目标序号（可以是负数或超出总数，会自动绕回）
 * @param {string} direction "up"=看下一条（从下滑上来），"down"=看上一条
 */
function goToImm(index, direction) {
  if (!latestNews.length) return;
  const total = latestNews.length;
  immIndex = (index + total) % total;   // 循环：最后一条的下一个回到第一条
  renderImmersiveCard();

  // 重新播放动画的小技巧：先移除动画类 → 强制页面重排 → 再加上动画类
  const card = $("immCard");
  card.classList.remove("imm-in-up", "imm-in-down");
  void card.offsetWidth;
  card.classList.add(direction === "down" ? "imm-in-down" : "imm-in-up");
}

/* ---------- 统一翻页锁（关键）----------
   滚轮、方向键、手指滑动共用这一把锁，不允许各写一套。
   规则：动画进行中、或手指手势还没结束，任何来源的翻页请求一律忽略。
   不这么做的话，手机上会出现"滑一次跳两条"。

   pageBusy    ：翻页动画播放中（约 PAGE_ANIM_MS 毫秒）
   touchActive ：手指还按着、手势未结束 */
const PAGE_ANIM_MS = 280;      // 与 CSS 里 .imm-in-up/.imm-in-down 的 0.28s 保持一致
let pageBusy = false;
let touchActive = false;

/** 当前是否允许翻页（所有来源都要先问它） */
function canPage() {
  return !pageBusy && !touchActive && latestNews.length > 0;
}

/**
 * 翻页（滚轮 / 方向键 / 手指滑动 都走这里）
 * @param {number} delta 1 = 下一条，-1 = 上一条
 */
function stepImm(delta) {
  // 一条新闻都没有时直接忽略：
  // 下面 goToImm 里有 "取模" 运算（immIndex + total) % total，
  // total 为 0 时会算出 NaN，页面就会显示空白卡片。这里先把门看住。
  if (!canPage()) return;

  pageBusy = true;
  setTimeout(() => { pageBusy = false; }, PAGE_ANIM_MS);   // 动画播完才解锁

  goToImm(immIndex + delta, delta > 0 ? "up" : "down");
}

// 记住用户上次选的浏览方式（"list"=列表，"immersive"=沉浸），下次打开自动沿用
const VIEW_MODE_KEY = "news-view-mode";

/** 读取上次的浏览方式，读不到就默认列表 */
function getSavedView() {
  try { return localStorage.getItem(VIEW_MODE_KEY) || "list"; } catch (e) { return "list"; }
}

/** 保存浏览方式（浏览器禁用存储时静默跳过，不影响使用） */
function saveView(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (e) { /* 忽略 */ }
}

/**
 * 切换浏览方式（阶段 4 的正式开关）
 * @param {string} mode "list" = 列表浏览，"immersive" = 沉浸浏览
 */
function setView(mode) {
  const isImmersive = mode === "immersive";

  // 边界情况：一条新闻都没有（比如所有 RSS 源都抓取失败）时禁止进入沉浸浏览。
  // 原因：计数会变成"第 1 / 0 条"，翻页的取模 (index + 0) % 0 会算出 NaN，
  // 卡片会变成空白。这里拦下来并给出中文提示，同时留在列表视图。
  if (isImmersive && !latestNews.length) {
    showToast("今日暂无新闻，请稍后重试");
    // 无论当时在哪个视图，都退回列表视图：
    // 万一已经在沉浸浏览里（新闻被清空的情况），也要安全退出来
    $("immersiveView").classList.add("hidden");
    document.body.style.overflow = "";
    $("btnViewList").classList.add("active");
    $("btnViewImmersive").classList.remove("active");
    return;
  }

  if (isImmersive) renderImmersiveCard();

  $("immersiveView").classList.toggle("hidden", !isImmersive);
  document.body.style.overflow = isImmersive ? "hidden" : "";  // 沉浸时锁住背景滚动

  // 开关上的高亮跟着当前视图走
  $("btnViewList").classList.toggle("active", !isImmersive);
  $("btnViewImmersive").classList.toggle("active", isImmersive);

  // 打开沉浸浏览时重新播放"操作提示"
  // 时长：显示 3 秒后淡出（动画总时长 4 秒），与 style.css 的 hintFade 一致
  // 注意：.show 必须加在里面的 <span> 上，CSS 里动画是 .imm-hint span.show，
  // 以前加在外层 div 上，提示根本不显示（已修正）
  if (isImmersive) {
    const hint = $("immHint");
    if (hint) {
      const hintText = hint.querySelector("span") || hint;
      hintText.classList.remove("show");
      void hintText.offsetWidth;      // 强制重排，让动画能重新播放
      hintText.classList.add("show");
    }
  }

  saveView(mode);
}

/** 打开沉浸浏览 */
function openImmersive() {
  setView("immersive");
}

/** 关闭沉浸浏览，回到列表 */
function closeImmersive() {
  setView("list");
}

// 正式开关的两个按钮 + 沉浸视图里的 ✕ 退出按钮
$("btnViewList").addEventListener("click", () => setView("list"));
$("btnViewImmersive").addEventListener("click", () => setView("immersive"));
$("immClose").addEventListener("click", () => setView("list"));

// 手机（有触摸屏）就把提示语换成"上滑/下滑"，电脑仍提示"滚轮/↑↓"
// 只改 <span> 里的文字，不要把 span 本身换掉，否则动画就没了
if ("ontouchstart" in window) {
  const hintSpan = $("immHint") && $("immHint").querySelector("span");
  if (hintSpan) hintSpan.textContent = "上滑看下一条 · 下滑看上一条 · 滑到最后自动回到第一条";
}

/**
 * 找出鼠标/手指下面那个"可以滚动的文字区"（摘要或摘抄正文）
 * 用途：在这类区域上滚动时应该滚文字，而不是翻到下一条新闻
 * @param {EventTarget} target 事件的目标元素
 * @returns {Element|null} 没找到、或内容还没超出（根本不用滚）时返回 null
 */
function scrollableTextUnder(target) {
  const el = target && target.closest
    ? target.closest(".imm-summary, .imm-excerpt")
    : null;
  return el && el.scrollHeight > el.clientHeight ? el : null;
}

// ---- 鼠标滚轮翻页（电脑用）----
// 向下滚 = 看下一条，向上滚 = 看上一条
// wheelCanFlip：现在允不允许翻页；一次滚动手势里只允许翻一次
let wheelCanFlip = true;
let wheelIdleTimer = null;

/**
 * 处理一次滚轮翻页：能翻就翻，翻完上锁；
 * 之后每来一个 wheel 事件都把解锁定时器往后推，
 * 只有滚动真正停下（间隔超过 WHEEL_IDLE_MS）才重新解锁。
 */
function wheelFlip(delta) {
  if (wheelCanFlip) {
    wheelCanFlip = false;      // 翻完立刻上锁
    stepImm(delta);
  }
  // 注意：无论上面有没有翻页，都要重置定时器——这正是"静默检测"的关键
  clearTimeout(wheelIdleTimer);
  wheelIdleTimer = setTimeout(() => { wheelCanFlip = true; }, WHEEL_IDLE_MS);
}

$("immersiveView").addEventListener("wheel", e => {
  // 注意顺序：必须先判断"是不是在滚文字"，再决定要不要 preventDefault。
  // 之前是先 preventDefault 再判断，结果在摘要/摘抄里滚动被浏览器拦掉了，
  // 长摘抄根本滚不动——这是个实打实的 BUG，已修正。
  if (scrollableTextUnder(e.target)) return;   // 让文字区正常滚动

  e.preventDefault();                 // 阻止页面背景跟着滚动
  wheelFlip(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

/* ---------- 阶段 3：手机手指上下滑动翻页 ---------- */

// 一次手势需要记录的几个量
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchMovedFar = false;   // 手指移动是否超过 10px（用来取消误点击）
let touchScrollEl = null;    // 手指落在可滚动文字区时，记录那个元素
let touchScrollTop = 0;      // 按下瞬间该文字区的滚动位置

// 翻页判定门槛
const SWIPE_DISTANCE_RATIO = 0.15;   // 拖动超过屏幕高度的 15% 就翻页
const SWIPE_SPEED = 0.45;            // 或速度够快（像素/毫秒）也翻页
const EDGE_RESIST = 0.25;            // 到首/尾边界时的阻力系数（越小越"拉不动"）

$("immersiveView").addEventListener("touchstart", e => {
  touchMovedFar = false;
  touchScrollEl = null;
  touchActive = false;
  if (e.touches.length !== 1) return;

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();

  // 手指落在可滚动的摘要/摘抄上：这次手势用来滚文字，不翻页
  const sc = scrollableTextUnder(e.target);
  if (sc) {
    touchScrollEl = sc;
    touchScrollTop = sc.scrollTop;
  }
}, { passive: true });

$("immersiveView").addEventListener("touchmove", e => {
  if (e.touches.length !== 1 || !touchStartY) return;

  const dy = e.touches[0].clientY - touchStartY;
  const dx = e.touches[0].clientX - touchStartX;

  // 横向滑动（比如想点按钮）不参与翻页
  if (Math.abs(dy) <= Math.abs(dx)) return;

  // 手指移动超过 10px 就记下来：松手时要取消 click，防止误点开原文
  if (Math.abs(dy) > 10) touchMovedFar = true;

  // 情况一：在可滚动文字区里 —— 手动滚文字
  // （外层设了 touch-action: none，浏览器不帮我们滚，所以自己算 scrollTop）
  if (touchScrollEl) {
    touchScrollEl.scrollTop = touchScrollTop - dy;
    return;
  }

  // 情况二：翻页手势
  e.preventDefault();          // 拦住系统滚动，改由我们处理
  touchActive = true;          // 手势未结束 → 统一锁打开，其他来源不能翻页

  // 跟手位移：到首/尾边界时阻力变大（位移打折），模拟原生手感
  const total = latestNews.length;
  const atStart = immIndex === 0 && dy > 0;        // 第一条还想往下拖
  const atEnd = immIndex === total - 1 && dy < 0;  // 最后一条还想往上拖
  const damped = (atStart || atEnd) ? dy * EDGE_RESIST : dy;

  const card = $("immCard");
  card.classList.remove("imm-snapback");   // 拖动中不能有过渡，否则不跟手
  card.style.transform = `translateY(${damped}px)`;
}, { passive: false });

$("immersiveView").addEventListener("touchend", e => {
  const card = $("immCard");
  const endY = e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
  const dy = endY - touchStartY;
  const wasActive = touchActive;
  const wasScrolling = !!touchScrollEl;

  touchActive = false;         // 手势结束
  touchScrollEl = null;

  if (!wasActive || wasScrolling) {   // 不是翻页手势：直接复位即可
    card.style.transform = "";
    return;
  }

  // ---- 松手判定 ----
  const stage = $("immersiveView").querySelector(".imm-stage");
  const screenH = stage ? stage.clientHeight : window.innerHeight || 800;
  const elapsed = Math.max(Date.now() - touchStartTime, 1);
  const speed = Math.abs(dy) / elapsed;                  // 像素/毫秒
  const farEnough = Math.abs(dy) > screenH * SWIPE_DISTANCE_RATIO;
  const fastEnough = speed > SWIPE_SPEED && Math.abs(dy) > 24;

  if (farEnough || fastEnough) {
    // 满足翻页条件：先清掉位移，再翻页（翻页动画由 CSS 负责）
    card.style.transform = "";
    stepImm(dy < 0 ? 1 : -1);        // 上滑看下一条，下滑看上一条
  } else {
    // 不够：带动画回弹原位
    card.classList.add("imm-snapback");
    card.style.transform = "translateY(0)";
    // 动画结束后把过渡类去掉，避免影响下次拖动
    setTimeout(() => card.classList.remove("imm-snapback"), 260);
  }
});

// 手势被中途取消（来电等）：复位，别把卡片卡在偏移状态
$("immersiveView").addEventListener("touchcancel", () => {
  const card = $("immCard");
  card.classList.add("imm-snapback");
  card.style.transform = "translateY(0)";
  setTimeout(() => card.classList.remove("imm-snapback"), 260);
  touchActive = false;
  touchScrollEl = null;
});

// 坑 3：手指移动超过 10px 后取消本次 click，
// 防止"本来想滑动"结果变成"点开了原文链接"。
// 用捕获阶段（第三个参数 true）抢在链接的默认行为之前拦下来。
$("immersiveView").addEventListener("click", e => {
  if (touchMovedFar) {
    e.preventDefault();
    e.stopPropagation();
    touchMovedFar = false;     // 用掉一次就复位，不影响下一次正常点击
  }
}, true);

// ---- 键盘翻页 + ESC 退出 ----
document.addEventListener("keydown", e => {
  const isOpen = !$("immersiveView").classList.contains("hidden");

  if (e.key === "Escape") {            // ESC 随时可退出，防止被困住
    closeImmersive();
    return;
  }
  if (!isOpen) return;                 // 没打开沉浸浏览时，方向键保持页面默认行为

  // 先判断是不是翻页键，不是就交还给浏览器（不拦任何默认行为）
  let delta = 0;
  if (e.key === "ArrowDown" || e.key === "PageDown") {
    delta = 1;                         // ↓ / PageDown = 看下一条
  } else if (e.key === "ArrowUp" || e.key === "PageUp") {
    delta = -1;                        // ↑ / PageUp   = 看上一条
  } else {
    return;
  }

  // 关键：拦住浏览器自己的滚动，避免"卡片翻页"和"页面滚动"同时发生（双动）
  e.preventDefault();
  stepImm(delta);
});

/**
 * 点击"生成今日简报"按钮时执行的完整流程
 */
$("btnGenerate").addEventListener("click", async () => {
  const btn = $("btnGenerate");
  const loading = $("loading");
  const briefing = $("briefing");
  const empty = $("empty");
  const error = $("error");

  // ---- 进入加载状态 ----
  btn.disabled = true;
  btn.textContent = "生成中…";
  loading.classList.remove("hidden");
  briefing.classList.add("hidden");
  empty.classList.add("hidden");
  error.classList.add("hidden");

  try {
    // ---- 第 1 步：并行抓取所有"允许接入"的源 ----
    // 注意：这里用 getEnabledSources() 而不是直接用 RSS_SOURCES，
    // 它会先拿 AUTHORITATIVE_MEDIA 白名单核对一遍，非权威媒体的源进不来。
    const sources = getEnabledSources();
    const results = await Promise.allSettled(
      sources.map(async source => {
        const items = await fetchRss(source.url);          // rss.js 里的抓取函数
        const media = AUTHORITATIVE_MEDIA[source.publisher] || {};
        // 注意：这里**不做**关键词筛选了。
        // 科技板块改成"多频道池"：先把要闻/国内/财经/滚动的条目合并，
        // 再统一筛科技（见 dedupeAndAssignCategories）。
        // 单源先筛会把财经频道里的科技新闻提前扔掉。
        return items.slice(0, source.maxItems).map(item => ({
          ...item,
          id: makeNewsId(item),                            // 稳定 id（配图定位/缓存用）
          category: source.category,                       // 标记分类（科技池命中后会被改写）
          inTechPool: TECH_POOL_SOURCES.includes(source.name), // 是否属于科技候选池
          poolOnly: source.poolOnly === true,                  // 综合频道：没命中就不进板块
          source: source.name,                             // 频道名，如"中新网要闻"
          publisher: source.publisher,                     // 媒体机构，如"中国新闻社"
          publisherType: media.type || "",                 // 机构性质，如"国家通讯社"
          time: formatTime(item.pubDate),
        }));
      })
    );

    // 收集抓取成功的新闻；记录失败的源名和原因，稍后提示
    const allNews = [];
    const failedSources = [];
    let successCount = 0;   // 成功的源有几个（用来区分"源失败"和"今天没新闻"）
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        successCount++;
        allNews.push(...result.value);
      } else {
        failedSources.push(sources[i].name);
        // 把失败原因记到控制台，方便排查（页面只显示简明中文提示）
        console.warn("源抓取失败 - " + sources[i].name + ":",
                     result.reason?.message || result.reason);
      }
    });

    // 打印每个源各抓到几条（哪个源没数据一眼看出来）
    console.log("[分源] " + sources.map((s, i) =>
      `${s.name} ${results[i].status === "fulfilled" ? results[i].value.length + "条" : "失败"}`
    ).join(" ｜ "));

    // 源停更告警：抓到了条目、但最新一条距今超过 SOURCE_STALE_DAYS 天就提示。
    // 阈值 4 天是为了不误报低频源（中新网生活实测当天 10 条、最新 18:40）；
    // 真正的死源会停更数月，4 天足够把它们筛出来。
    const nowTs = Date.now();
    sources.forEach((s, i) => {
      if (results[i].status !== "fulfilled") return;
      const items = results[i].value || [];
      if (!items.length) return;
      const newest = items.reduce((max, it) => {
        const t = new Date(it.pubDate).getTime();
        return isNaN(t) ? max : Math.max(max, t);
      }, 0);
      if (!newest) return;
      const days = (nowTs - newest) / 86400000;
      if (days > SOURCE_STALE_DAYS) {
        console.warn(`[源告警] ${s.name} 最新条目距今 ${days.toFixed(1)} 天`
          + `（阈值 ${SOURCE_STALE_DAYS} 天），可能是停更源，建议核对`);
      }
    });

    // ---- 第 2 步：时间过滤，只保留"今天 00:00 之后"发布的新闻 ----
    const countBefore = allNews.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);   // 把时间拨到今天零点整
    const todayRaw = allNews.filter(news => {
      const d = new Date(news.pubDate);
      // 没有日期或日期无效的新闻无法证明是今天的，一律排除
      return !isNaN(d.getTime()) && d >= todayStart;
    });
    // 打印过滤前后数量（浏览器按 F12 → Console 可看到这行）
    console.log(`[时间过滤] 过滤前共 ${countBefore} 条，今天 00:00 后保留 ${todayRaw.length} 条`);

    // ---- 第 2.5 步：去重 + 板块互斥 + 科技池归类 ----
    const todayNews = dedupeAndAssignCategories(todayRaw);

    // ---- 第 3 步：按时间从新到旧排序，再挑出列表页要显示的新闻 ----
    todayNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const topNews = buildListNews(todayNews);

    // ---- 第 3 步：给每条新闻生成摘要（AI 预留接口，见 config.js）----
    // 这里遍历的是"今天全部新闻"而不是只前 10 条：
    // 沉浸浏览每个专题各取几条，可能取到前 10 名之外的新闻，
    // 如果只给前 10 条做总结，那些新闻就会显示又长又乱的原始摘要。
    // 总结是本地计算、不联网，多算几条没有负担。
    for (const news of todayNews) {
      // 先把 RSS 原始摘要留一份底稿：万一这个源没提供正文，
      // 「摘抄正文」还能用它兜底，不至于一片空白
      news.rawSummary = news.summary;
      news.summary = await generateSummary(news.title, news.summary);
    }

    // ---- 第 4 步：按分类渲染到四个板块 ----
    // 注意：政治排在第一个（时政要闻优先）。新增/调整板块顺序时，
    // 记得同时改 index.html 里对应的 <section> 和 js/stats.js 里的统计字段。
    const polList = topNews.filter(n => n.category === "政治");
    const techList = topNews.filter(n => n.category === "科技");
    const finList = topNews.filter(n => n.category === "财经");
    const lifeList = topNews.filter(n => n.category === "生活");
    renderCategory("政治", polList);
    renderCategory("科技", techList);
    renderCategory("财经", finList);
    renderCategory("生活", lifeList);

    // ---- 配图：所有新闻自动配图（图库 → 代码生成 → 可选的 AI 升级）----
    // 页面不放占位图标：拿到图就显示，拿不到（file:// 直开无后端）才保持渐变底
    shownNews = topNews;
    fillAllImages(topNews);

    // ---- 阶段1：把这批新闻交给沉浸浏览，并显示临时预览按钮 ----
    // 注意：沉浸浏览用的是"每个专题各取几条"的列表（buildImmersiveList），
    // 而不是列表页那个按时间取前 10 条的 topNews，
    // 这样 科技/财经/生活 三个专题都会出现在沉浸浏览里
    latestNews = buildImmersiveList(todayNews);
    immIndex = 0;              // 从第一条开始
    renderImmersiveCard();

    // ---- 阶段4：显示视图切换开关 ----
    // 如果上次用的是沉浸浏览、且这次确实有新闻，就自动进入沉浸视图，
    // 否则回到列表视图（开关上的高亮也一并同步）
    $("viewSwitch").classList.remove("hidden");
    if (getSavedView() === "immersive" && latestNews.length) {
      openImmersive();
    } else {
      setView("list");
    }

    // ---- 第 5 步：记录今天的分类数据并渲染历史统计图 ----
    // （只有至少一个源连接成功才记录，避免把"全部失败"记成 0 条）
    if (successCount > 0) {
      await recordTodayStats(polList.length, techList.length, finList.length, lifeList.length);
    }
    await renderStats();

    // ---- 展示结果 ----
    briefing.classList.remove("hidden");

    // 部分源失败时给出温和提示（不影响已抓到的新闻展示）
    if (failedSources.length > 0 && todayNews.length > 0) {
      error.textContent = "⚠️ 以下源暂时无法访问：" + failedSources.join("、")
        + "。其余源已正常展示，可稍后重试。";
      error.classList.remove("hidden");
    }

    if (successCount === 0) {
      // 所有源都抓取失败：分情况给出针对性提示
      let msg;
      if (navigator.onLine === false) {
        // 情况一：电脑根本没联网
        msg = "❌ 电脑当前没有联网，无法抓取新闻。"
            + "请先连接网络，再点击按钮重试。";
      } else {
        // 情况二：联网了但全部抓取失败（多为网络屏蔽了接口，或所有源同时故障）
        msg = "❌ 所有新闻源都抓取失败了。可能的原因：\n"
            + "1. 当前网络屏蔽了 rss2json 接口（公司/校园网常见），可换个网络试试；\n"
            + "2. 这些 RSS 源同时不稳定，稍后重试；\n"
            + "3. 长期失败请在 js/config.js 中更换 RSS 源地址。";
      }
      error.textContent = msg;
      error.classList.add("error-detail");   // 启用多行排版样式
      error.classList.remove("hidden");
      briefing.classList.remove("hidden");   // 仍显示空板块，让用户知道结构还在
    } else if (todayNews.length === 0) {
      // 源连接正常，但今天 00:00 后还没新文章（不再是"失败"）
      let msg = "✅ 新闻源连接正常，但今天 00:00 之后还没有新文章发布，晚点再来看看吧。\n"
              + "（提示：本应用只展示今天发布的新闻，昨天的不会出现）";
      if (failedSources.length > 0) {
        msg += "\n另外：以下源暂时无法访问：" + failedSources.join("、");
      }
      error.textContent = msg;
      error.classList.add("error-detail");
      error.classList.remove("hidden");
    } else {
      error.classList.remove("error-detail");
    }
  } catch (err) {
    // 兜底错误（一般不会走到这里）
    error.textContent = "❌ 出现意外错误：" + err.message;
    error.classList.remove("hidden");
    empty.classList.remove("hidden");
  } finally {
    // ---- 恢复按钮状态 ----
    btn.disabled = false;
    btn.textContent = "生成今日简报";
    loading.classList.add("hidden");
  }
});
