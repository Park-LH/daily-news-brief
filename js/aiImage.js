/**
 * ============================================================
 * aiImage.js —— 新闻配图处理：去装饰 + 素材库 + AI 生成补图
 * ============================================================
 * 原理（零基础解释）：
 *   有些新闻的 RSS 里不带配图，或者配图链接已经失效。
 *   以前的做法是塞一个 🖼️ 占位图标，那属于"系统自己加的图案"。
 *   现在的处理顺序是：
 *     1. 先查本地素材库（assets/images/library.json）
 *     2. 素材库没有，就请求后端 /api/ai-image，
 *        由后端调用 AI 图片生成，按这条新闻的标题和正文现生成一张
 *     3. 生成失败也不能放占位图/装饰，只留一块干净的空位
 *
 * 生成的图片同样受"去装饰"约束：prompt 里明确禁止
 * 文字、水印、Logo、边框、角标、图标（见 AI_IMAGE_RULES）。
 */

/** 配图相关配置 */
const AI_IMAGE = {
  enabled: true,                              // 总开关：关掉就完全不生成、也不请求
  libraryUrl: "assets/images/library.json",   // 本地素材库索引
  endpoint: "/api/ai-image",                  // 后端生成接口（由 start-server.ps1 提供）
  timeoutMs: 120000,                          // 单张生成的等待上限（生成通常要十几秒）
  maxConcurrent: 2,                           // 同时最多生成几张，避免一次发出太多请求
  cachePrefix: "aiimg:",                      // localStorage 缓存前缀
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
 * 匹配规则：同分类 +2 分，命中一个关键词 +1 分，取分最高的那条
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
    if (score > bestScore) {
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
    return data && data.ok && data.url ? data.url : "";
  } catch (e) {
    console.warn("[AI 配图] 生成失败（页面不会出现占位图标）：", e.message || e);
    return "";
  } finally {
    clearTimeout(timer);
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
 * 顺序：本地缓存 → 素材库 → AI 生成
 * @returns {Promise<string>} 图片地址；拿不到就返回空字符串（页面保持干净空位）
 */
async function ensureNewsImage(news) {
  if (!AI_IMAGE.enabled || !news) return "";
  if (!news.id) news.id = makeNewsId(news);
  if (news.imageRequested) return news.image || "";   // 同一条只走一次流程
  news.imageRequested = true;

  // 1. 本地缓存（上次生成过）
  const cached = readImageCache(news);
  if (cached) return applyNewsImage(news, cached, "cache");

  // 2. 素材库
  const hit = await matchImageLibrary(news);
  if (hit && hit.file) return applyNewsImage(news, hit.file, "library");

  // 3. AI 生成
  const url = await enqueueImageJob(() => requestAiImage(news));
  return url ? applyNewsImage(news, url, "ai") : "";
}

/**
 * 把图片地址写到新闻对象上，并更新页面上对应的位置
 * @param {Object} news 新闻对象
 * @param {string} url  图片地址
 * @param {string} from 来源标记：cache / library / ai
 */
function applyNewsImage(news, url, from) {
  const safe = safeUrl(url);
  if (!safe) return "";

  news.image = safe;
  news.imageFrom = from;
  writeImageCache(news, safe);

  // 页面上所有挂着这条新闻 id 的位置都换成真图（列表缩略图 / 沉浸封面）
  // 这里给 AI 生成的图加一个专门包装/类名，后续用 CSS 裁掉图片底部
  // 可能存在的 AI 服务水印，保证用户看到的简报图是"干净"的。
  const isAi = from === "ai" || from === "library";
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
 * 批量给"缺图"的新闻补图（页面加载完调用一次即可）
 * @param {Array} newsList 新闻数组
 */
function fillMissingImages(newsList) {
  if (!AI_IMAGE.enabled || !Array.isArray(newsList)) return;
  newsList.forEach(news => {
    if (!news || safeUrl(news.image)) return;   // 本来就有图的不动
    ensureNewsImage(news);                       // 异步，不阻塞页面渲染
  });
}
