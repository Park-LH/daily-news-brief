/**
 * ============================================================
 * aiImage.js —— 新闻配图：素材库 + 代码生成（保底）+ AI 生成（按真实内容升级）
 * ============================================================
 * 原理（零基础解释）：
 *   新闻配图以前只有"源站正文图 / 3 张种子图 / AI 生成"三种来源，
 *   结果是同一板块的新闻共用同一张图（配图单一），而且 AI 那条通道
 *   一旦缺密钥或超时，这条新闻就只剩一块渐变底。
 *
 *   现在的顺序是（每条新闻都走，保证 100% 有图）：
 *     1. localStorage 缓存（上次已经定过的图）
 *     2. 新闻图库：历史生成的优秀配图，按分类 + 关键词匹配复用
 *     3. 代码生成：调 /api/code-image，由 tools/news_image_factory.py
 *        用代码直接画一张（不用 AI、不用密钥、毫秒级）。
 *        画面由这条新闻的分类 + 关键词 + 标题指纹决定：
 *        讲芯片画电路、讲卫星画轨道、讲股市画柱状……同板块也不会重样。
 *     4. AI 升级（可选）：已有"保底图"后，再拿这条新闻的真实标题 +
 *        摘要 + 关键词让 AI 生成一张，成功就替换保底图并入库复用。
 *
 * 所有图片都受"去装饰"约束：画面里禁止文字、水印、Logo、边框、角标、图标
 * （AI 出图见 AI_IMAGE_RULES；代码出图天然不含文字）。
 */

/** 配图相关配置 */
const AI_IMAGE = {
  enabled: true,                              // 总开关：关掉就完全不生成、也不请求
  libraryUrl: "assets/images/library.json",   // 本地素材库索引
  codeEndpoint: "/api/code-image",            // 代码生成接口（不用密钥，毫秒级）
  endpoint: "/api/ai-image",                  // 后端 AI 生成接口（由 start-server.ps1 提供）
  timeoutMs: 120000,                          // 单张 AI 生成的等待上限（生成通常要十几秒）
  maxConcurrent: 2,                           // 同时最多生成几张，避免一次发出太多请求
  cachePrefix: "aiimg:",                      // localStorage 缓存前缀
  autoAll: true,                              // 所有新闻（各主题/板块）都自动配图，不再留渐变底
  aiUpgrade: true,                            // 有保底图后再让 AI 生成一张更好的替换（失败就用保底图）
};

/**
 * AI 出图的统一约束
 * 作用：保证生成出来的图里不会出现任何"系统图案"，
 * 也不会因为被裁成方图/竖图而把主体切掉。
 */
const AI_IMAGE_RULES =
  "画面要求：写实新闻配图风格，构图简洁，主体居中并留出安全边距，" +
  "柔和自然光，高清细节；" +
  "严禁出现任何文字、字母、数字、水印、Logo、签名、边框、角标、贴纸或图标；" +
  "构图需同时适合方形与竖幅裁切（页面用 object-fit: cover 显示）。";

/* ============================================================
   内部状态
   ============================================================ */

let imageLibraryPromise = null;   // 素材库只加载一次，之后复用
let activeJobs = 0;               // 正在生成的数量
const jobQueue = [];              // 排队等待的生成任务

/* ============================================================
   工具函数
   ============================================================ */

/** 简单的字符串哈希，用来给新闻生成稳定的 id 和缓存键 */
function hashText(text) {
  let hash = 0;
  const str = String(text || "");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * 给一条新闻生成稳定 id（同一条新闻每次刷新都一样）
 * 用途：页面元素靠它定位，缓存也靠它命名
 */
function makeNewsId(news) {
  return "n" + hashText((news.link || "") + "|" + (news.title || ""));
}

/** 把文本压成一句干净的话（去掉换行、多余空格，限制长度） */
function compressText(text, maxLen) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

/**
 * 根据新闻内容拼出 AI 出图的描述词（prompt）
 * 只用标题 + 摘要/正文 + 分类，不掺任何装饰性要求以外的东西
 */
function buildNewsImagePrompt(news) {
  const title = compressText(news.title, 60);
  const body = compressText(news.summary || news.content || "", 160);
  const category = news.category || "综合";

  let prompt = `新闻标题：${title}。`;
  if (body) prompt += `新闻内容：${body}。`;
  prompt += `新闻分类：${category}。`;
  prompt += `请据此生成一张与这条新闻语义相符、风格合适的配图，不要照抄标题文字。`;
  prompt += AI_IMAGE_RULES;
  return prompt;
}

/* ============================================================
   素材库
   ============================================================ */

/** 加载素材库索引（失败就当素材库为空，不影响页面） */
function loadImageLibrary() {
  if (imageLibraryPromise) return imageLibraryPromise;
  imageLibraryPromise = fetch(AI_IMAGE.libraryUrl)
    .then(resp => (resp.ok ? resp.json() : { items: [] }))
    .catch(() => ({ items: [] }));
  return imageLibraryPromise;
}

/**
 * 在素材库里找一条能用的图
 * 匹配规则：同分类 +2 分，命中一个关键词 +1 分，取分最高的那条；
 * 分数相同时优先用质量分（quality）更高的——图库里沉淀的是"优秀配图"。
 */
async function matchImageLibrary(news) {
  const library = await loadImageLibrary();
  const items = Array.isArray(library.items) ? library.items : [];
  const text = `${news.title || ""} ${news.summary || ""}`;

  let best = null;
  let bestScore = 0;
  items.forEach(item => {
    let score = 0;
    if (item.category && item.category === news.category) score += 2;
    (item.keywords || []).forEach(word => {
      if (word && text.includes(word)) score += 1;
    });
    const better =
      score > bestScore ||
      (score === bestScore && score > 0 &&
        (item.quality || 0) > (best ? (best.quality || 0) : -1));
    if (better) {
      bestScore = score;
      best = item;
    }
  });
  return bestScore > 0 ? best : null;
}

/* ============================================================
   本地缓存（避免同一条新闻反复生成）
   ============================================================ */

function imageCacheKey(news) {
  return AI_IMAGE.cachePrefix + hashText(makeNewsId(news) + buildNewsImagePrompt(news));
}

function readImageCache(news) {
  try {
    return localStorage.getItem(imageCacheKey(news)) || "";
  } catch (e) {
    return "";   // 隐私模式下 localStorage 不可用，忽略即可
  }
}

function writeImageCache(news, url) {
  try {
    localStorage.setItem(imageCacheKey(news), url);
  } catch (e) { /* 存不进去也不影响显示 */ }
}

/* ============================================================
   后端生成（带并发控制）
   ============================================================ */

/** 并发闸门：同时最多 AI_IMAGE.maxConcurrent 个生成任务 */
function enqueueImageJob(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeJobs++;
      task().then(resolve, reject).finally(() => {
        activeJobs--;
        const next = jobQueue.shift();
        if (next) next();
      });
    };
    if (activeJobs < AI_IMAGE.maxConcurrent) run();
    else jobQueue.push(run);
  });
}

/** 请求后端生成一张图；返回图片地址，失败返回空字符串 */
async function requestAiImage(news) {
  // 直接双击 index.html（file://）时没有后端，跳过
  if (location.protocol === "file:") return "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_IMAGE.timeoutMs);

  try {
    const resp = await fetch(AI_IMAGE.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: makeNewsId(news),
        category: news.category || "",
        keywords: extractNewsKeywords(news),
        prompt: buildNewsImagePrompt(news),
      }),
      signal: controller.signal,
    });
    const data = await resp.json();
    // 本机没有 AI 生成能力（缺密钥/缺 python）时，别再为每条新闻发一次
    // 白跑的请求——本会话直接关掉 AI 升级，用代码生成的保底图即可。
    if (data && !data.ok &&
        (data.error === "TOKEN_MISSING" || data.error === "PYTHON_NOT_FOUND")) {
      AI_IMAGE.aiUpgrade = false;
      console.log("[AI 配图] 本机未配置生成能力，改用代码生成的保底配图");
    }
    return data && data.ok && data.url ? data.url : "";
  } catch (e) {
    console.warn("[AI 配图] 生成失败（页面不会出现占位图标）：", e.message || e);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求后端"用代码画一张图"：不用 AI、不用密钥、毫秒级返回
 * 画面内容由这条新闻的真实分类 + 关键词 + 标题决定（见 news_image_factory.py）
 * @returns {Promise<string>} 图片地址；失败返回空字符串
 */
async function requestCodeImage(news) {
  // 直接双击 index.html（file://）时没有后端，跳过
  if (location.protocol === "file:") return "";

  try {
    const resp = await fetch(AI_IMAGE.codeEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: makeNewsId(news),
        category: news.category || "",
        keywords: extractNewsKeywords(news),
        title: news.title || "",
      }),
    });
    const data = await resp.json();
    return data && data.ok && data.url ? data.url : "";
  } catch (e) {
    console.warn("[代码配图] 生成失败：", e.message || e);
    return "";
  }
}

/** 从标题里挑几个关键词，用于写进素材库索引（方便以后复用） */
function extractNewsKeywords(news) {
  const stopWords = ["的", "了", "在", "和", "与", "是", "将", "为", "对", "等", "中新网", "中新社"];
  return String(news.title || "")
    .replace(/[，。、；：！？（）《》“”"'()【】]/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 2 && !stopWords.includes(word))
    .slice(0, 6);
}

/* ============================================================
   对外主流程
   ============================================================ */

/**
 * 给一条新闻定下配图地址，并同步更新页面
 * 顺序：本地缓存 → 素材库 → 代码生成（保底） → AI 升级（可选，异步替换）
 * @returns {Promise<string>} 图片地址；拿不到就返回空字符串（页面保持干净空位）
 */
async function ensureNewsImage(news) {
  if (!AI_IMAGE.enabled || !news) return "";
  if (!news.id) news.id = makeNewsId(news);
  if (news.imageRequested) return news.image || "";   // 同一条只走一次流程
  news.imageRequested = true;

  // 1. 本地缓存（上次已经定过的图）
  const cached = readImageCache(news);
  if (cached) return applyNewsImage(news, cached, "cache");

  // 2. 新闻图库：历史生成的优秀配图，按分类 + 关键词复用
  const hit = await matchImageLibrary(news);
  if (hit && hit.file) {
    news.imageKind = hit.kind || hit.source || "";   // code / ai：决定要不要裁水印
    applyNewsImage(news, hit.file, "library");
  } else {
    // 3. 代码生成：不用密钥、毫秒级，保证这条新闻一定有图（不会留渐变底）
    const codeUrl = await requestCodeImage(news);
    if (codeUrl) applyNewsImage(news, codeUrl, "code");
  }

  // 4. AI 升级：已有保底图后，再按这条新闻的真实内容生成一张更好的图替换。
  //    失败也没关系——保底图已经在页面上，不会退回空位。
  if (AI_IMAGE.aiUpgrade && news.image) {
    enqueueImageJob(async () => {
      const aiUrl = await requestAiImage(news);
      if (aiUrl) applyNewsImage(news, aiUrl, "ai");
    });
  }

  return news.image || "";
}

/**
 * 把图片地址写到新闻对象上，并更新页面上对应的位置
 * @param {Object} news 新闻对象
 * @param {string} url  图片地址
 * @param {string} from 来源标记：cache / library / code / ai
 */
function applyNewsImage(news, url, from) {
  const safe = safeUrl(url);
  if (!safe) return "";

  news.image = safe;
  news.imageFrom = from;
  writeImageCache(news, safe);

  // 页面上所有挂着这条新闻 id 的位置都换成真图（列表缩略图 / 沉浸封面）
  // 只有 AI 生成的图才加 .ai-cleaned（用 CSS 裁掉底部可能存在的服务水印）；
  // 代码生成的图是我们自己画的，没有水印，不需要裁，裁了反而破坏居中的构图。
  const isAi = from === "ai" || (from === "library" && news.imageKind !== "code");
  document.querySelectorAll(`[data-news-id="${news.id}"]`).forEach(box => {
    if (box.classList.contains("imm-media")) {
      const cls = isAi ? "ai-cleaned" : "";
      box.innerHTML = `<img class="${cls}" src="${escapeHtml(safe)}" alt="新闻封面">`;
    } else if (box.classList.contains("news-thumb-empty")) {
      const wrap = document.createElement("div");
      wrap.className = "news-thumb-wrap";
      const img = document.createElement("img");
      img.src = safe;
      img.alt = "新闻配图";
      img.loading = "lazy";
      if (isAi) img.className = "ai-cleaned";
      wrap.appendChild(img);
      box.replaceWith(wrap);
    }
  });

  return safe;
}

/**
 * 给一批新闻自动配图（列表页 / 沉浸页都在生成后调用一次即可）
 *
 * "所有主题都自动配图"（AI_IMAGE.autoAll）：
 *   遍历整批新闻——已经有源站真图的不动（真图优先），
 *   其余一律走 ensureNewsImage()，由"图库 → 代码生成"保证拿到一张图，
 *   所以任何主题的新闻都不会再出现空白渐变底。
 *
 * @param {Array} newsList 新闻数组
 */
function fillAllImages(newsList) {
  if (!AI_IMAGE.enabled || !Array.isArray(newsList)) return;
  newsList.forEach(news => {
    if (!news || safeUrl(news.image)) return;   // 已有源站真图的不覆盖
    ensureNewsImage(news);                       // 异步，不阻塞页面渲染
  });
}

/** 兼容旧调用名（app.js 里原来叫 fillMissingImages） */
function fillMissingImages(newsList) {
  fillAllImages(newsList);
}
