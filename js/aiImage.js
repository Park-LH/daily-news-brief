/**
 * ============================================================
 * aiImage.js —— 新闻配图：原图 → 网络意象图 → 工具生成（三级，保证 100% 有图）
 * ============================================================
 * 原理（零基础解释）：
 *   以前的毛病：图库的优先级压在"源站原图"之前，而图库只有 8 条，
 *   于是同一板块的新闻全命中同一张图——看着就像"配图一直没更新"。
 *   同时 AI 那条通道依赖 GPU / 密钥，从来没真正出过图。
 *
 *   2026-10-24 按用户要求重排为三级，**越靠前越"真"**：
 *     1. localStorage 缓存（上次已经定过的图，不再重复下载）
 *     2. **新闻原图**：抓这条新闻文章页正文里的照片（/api/image），
 *        服务器会把图**下载到本地**再返回——不用源站外链，
 *        否则过几天防盗链/失效，页面上就会出现"昨天有图、今天空白"。
 *     3. **网络意象图**：原图拿不到时，按这条新闻的关键词去
 *        Wikimedia Commons（免密钥、CC/公有领域）找一张贴题的照片，
 *        比抽象几何图更贴新闻背景。**需署名**，页面角落会显示来源小字。
 *     4. **工具生成**：调 /api/code-image，由 tools/news_image_factory.py
 *        用代码直接画一张（不用 AI、不用密钥、毫秒级、几乎不会失败）。
 *     5. 图库兜底：以上三级都失败时，才复用历史配图（同一张图本次只给
 *        一条新闻用，不会再出现"多条新闻共用一张"）。
 *
 *   ⚠️ 硬要求：每条新闻必须有图，配图不可空缺。
 *   第 4 级是本地纯代码画图，失败率极低；真失败还有第 5 级兜底。
 *
 * 关于"放弃开源大模型配图"：本地跑 ComfyUI/FLUX 需要 ≥12GB 显存，
 * 本机实测只有 2GB，且该方案已由用户于 2026-10-24 决定放弃，
 * 所以本文件不再保留任何大模型出图通道。
 */

/** 配图相关配置 */
const AI_IMAGE = {
  enabled: true,                              // 总开关：关掉就完全不生成、也不请求
  libraryUrl: "assets/images/library.json",   // 本地素材库索引
  originEndpoint: "/api/image",               // 第一级：文章页正文原图（服务端会落本地）
  stockEndpoint: "/api/stock-image",          // 第二级：网络意象图（Wikimedia Commons）
  codeEndpoint: "/api/code-image",            // 第三级：代码生成（不用密钥，毫秒级）
  originTimeoutMs: 8000,                      // 抓原图的等待上限（抓不到就往下一级走）
  stockTimeoutMs: 12000,                      // 找意象图的等待上限（含下载图的时间）
  cachePrefix: "aiimg2:",                     // localStorage 缓存前缀
  // ↑ v2：2026-10-24 取原图逻辑重写前的缓存里存着"页面公共区"的图
  //   （一部电影的海报被当成多篇文章的原图），升前缀让旧缓存全部作废重取。
  autoAll: true,                              // 所有新闻（各主题/板块）都自动配图，不再留渐变底
};

/**
 * 网络意象图按板块给的"底色词"
 * Commons 是英文为主的图库，直接用中文长标题去搜常常搜不到合适的图，
 * 所以先给一个板块级的英文意象，再拼上标题里的关键词。
 */
const STOCK_CATEGORY_SEED = {
  "政治": "government building",
  "科技": "technology",
  "财经": "finance economy",
  "生活": "city life",
};

/* ============================================================
   内部状态
   ============================================================ */

let imageLibraryPromise = null;   // 素材库只加载一次，之后复用
// 本次会话已经用过的图库图片：防止多条新闻匹配到同一张图
// （以前三条新闻共用 seed-code-pol-001.svg 就是这么来的）
const usedLibraryFiles = new Set();

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

/** 缓存键：只按新闻 id（不掺描述词，换图逻辑变了也不会误命中旧图） */
function imageCacheKey(news) {
  return AI_IMAGE.cachePrefix + makeNewsId(news);
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
   配图三级来源：原图 → 网络意象图 → 代码生成
   ============================================================ */

/**
 * 第一级：抓这条新闻**文章页正文里的照片**（/api/image）
 *
 * 服务端会把图下载到本地再返回地址——不用源站外链，
 * 否则过几天防盗链或链接失效，页面上就会出现"昨天有图、今天空白"。
 *
 * @returns {Promise<{url:string, credit:string}|null>} 拿不到返回 null
 */
async function requestOriginImage(news) {
  // 直接双击 index.html（file://）时没有后端，跳过
  if (location.protocol === "file:") return null;

  // 优先复用 app.js 里已有的取图函数（自带超时、文章页校验、每条只请求一次）。
  // 注意取的是 originImage（文章页里那张真照片），不能用 news.image——
  // 它可能已经被本文件的兜底图填过了，会误判成"拿到原图"。
  if (typeof fetchArticleImage === "function") {
    if (news.originImage === undefined) await fetchArticleImage(news);
    const u = news.originImage || "";
    return u ? { url: u, credit: news.imageCredit || "" } : null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_IMAGE.originTimeoutMs);
  try {
    const resp = await fetch(
      `${AI_IMAGE.originEndpoint}?url=${encodeURIComponent(news.link || "")}`,
      { signal: controller.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.ok && data.image) {
      return { url: data.image, credit: data.credit || "" };
    }
    return null;
  } catch (e) {
    return null;                 // 超时/失败都静默往下一级走
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 第二级：去 Wikimedia Commons 找一张贴题的"意象图"（/api/stock-image）
 *
 * 关键词策略：先用「板块意象词 + 标题关键词」搜，
 * 搜不到（Commons 以英文为主，中文长标题常常搜空）就退成只用板块意象词再试一次。
 *
 * @returns {Promise<{url:string, credit:Object}|null>}
 */
async function requestStockImage(news) {
  if (location.protocol === "file:") return null;

  const seed = STOCK_CATEGORY_SEED[news.category] || "news";
  const words = extractNewsKeywords(news).slice(0, 2).join(" ");
  // 顺序有讲究：Commons 里中英混搜基本搜不到东西（实测 "technology 芯片" → 0 结果），
  // 所以先按**中文关键词**搜（更贴题），搜不到再退回板块意象词（几乎一定有结果）。
  const queries = words ? [words, seed] : [seed];

  for (const q of queries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_IMAGE.stockTimeoutMs);
    try {
      const resp = await fetch(
        `${AI_IMAGE.stockEndpoint}?q=${encodeURIComponent(q)}`
        + `&id=${encodeURIComponent(news.id || makeNewsId(news))}`,
        { signal: controller.signal });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.ok && data.url) {
        return { url: data.url, credit: data.credit || null };
      }
    } catch (e) {
      // 换下一组关键词再试
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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
 * 顺序：本地缓存 → **新闻原图** → **网络意象图** → **代码生成** → 图库兜底
 * 硬要求：每条新闻都必须有图，前三级拿不到就兜底，不留下空位。
 * @returns {Promise<string>} 图片地址；极端情况下拿不到才返回空字符串
 */
async function ensureNewsImage(news) {
  if (!AI_IMAGE.enabled || !news) return "";
  if (!news.id) news.id = makeNewsId(news);
  if (news.imageRequested) return news.image || "";   // 同一条只走一次流程
  news.imageRequested = true;

  // 1. 本地缓存（上次已经定过的图，不再重复下载）
  const cached = readImageCache(news);
  if (cached) return applyNewsImage(news, cached, "cache");

  // ---- 两阶段：先保证"有图"，再争取"更好的图" ----
  // 为什么分两阶段：服务端是单线程，抓原图 / 找意象图都要走外网，
  // 十几条新闻排队下来可能要几十秒。如果死等，这段时间页面就是空的
  // ——那就违反了"配图不可空缺"。所以先用**毫秒级的代码生成**兜住，
  // 再异步去换更好的图；拿到原图/意象图就自动替换（最终图仍是优先级最高的那张）。
  const codeUrl = await requestCodeImage(news);
  if (codeUrl) applyNewsImage(news, codeUrl, "code");

  upgradeNewsImage(news);          // 异步升级，不阻塞
  return news.image || "";
}

/**
 * 异步把配图升级为"更真的图"：新闻原图 → 网络意象图
 * 拿到就替换掉阶段一的保底图；都拿不到就保留保底图（页面始终有图）。
 */
async function upgradeNewsImage(news) {
  // 2. 新闻原图：文章页正文里的照片（最"真"，服务端已落到本地）
  const origin = await requestOriginImage(news);
  if (origin && origin.url) {
    console.log(`[配图升级] ${(news.title || "").slice(0, 14)}… → 原图`);
    applyNewsImage(news, origin.url, "origin", origin.credit);
    return;
  }

  // 3. 网络意象图：贴题的照片（Wikimedia Commons，需署名）
  const stock = await requestStockImage(news);
  if (stock && stock.url) {
    console.log(`[配图升级] ${(news.title || "").slice(0, 14)}… → 意象图（无原图）`);
    applyNewsImage(news, stock.url, "stock", stock.credit);
    return;
  }

  // 都拿不到：保留阶段一的保底图，或者退而复用图库（同一张图只给一条新闻用）
  if (!news.image) {
    const hit = await matchImageLibrary(news);
    if (hit && hit.file && !usedLibraryFiles.has(hit.file)) {
      usedLibraryFiles.add(hit.file);
      news.imageKind = hit.kind || hit.source || "";
      applyNewsImage(news, hit.file, "library");
      return;
    }
    console.warn("[配图] 三级都失败且无图库可用：", news.title);
  }
}

/**
 * 把图片地址写到新闻对象上，并更新页面上对应的位置
 * @param {Object} news 新闻对象
 * @param {string} url  图片地址
 * @param {string} from 来源标记：cache / origin / stock / code / library
 * @param {string|Object} [credit] 图片来源（原图给来源名，网络图给 {source,author,license}）
 */
function applyNewsImage(news, url, from, credit) {
  const safe = safeUrl(url);
  if (!safe) return "";

  news.image = safe;
  news.imageFrom = from;
  news.imageCredit = credit || "";
  writeImageCache(news, safe);

  const creditText = formatImageCredit(credit);
  const creditHtml = creditText
    ? `<span class="img-credit" title="${escapeHtml(creditText)}">${escapeHtml(creditText)}</span>`
    : "";

  // 页面上所有挂着这条新闻 id 的位置都换成真图（列表缩略图 / 沉浸封面）
  // 只有 AI 生成的图才加 .ai-cleaned（用 CSS 裁掉底部可能存在的服务水印）；
  // 代码生成的图是我们自己画的，没有水印，不需要裁，裁了反而破坏居中的构图。
  const isAi = from === "ai" || (from === "library" && news.imageKind !== "code");
  document.querySelectorAll(`[data-news-id="${news.id}"]`).forEach(box => {
    if (box.classList.contains("imm-media")) {
      const cls = isAi ? "ai-cleaned" : "";
      box.innerHTML = `<img class="imm-cover ${cls}" src="${escapeHtml(safe)}" alt="新闻封面">`
        + creditHtml;
      // 沉浸封面默认是 opacity:0，加载完加 .loaded 才淡入（见 style.css）。
      // 少了这一步，图已经换上去了但**看不见**——页面像是没配图。
      const im = box.querySelector("img");
      if (im) {
        const show = () => im.classList.add("loaded");
        if (im.complete) show(); else im.onload = show;
      }
    } else if (box.classList.contains("news-thumb-empty")) {
      const wrap = document.createElement("div");
      wrap.className = "news-thumb-wrap";
      const img = document.createElement("img");
      img.src = safe;
      img.alt = "新闻配图";
      img.loading = "lazy";
      if (isAi) img.className = "ai-cleaned";
      // 列表缩略图只有 86×86，塞不下一行署名小字（会糊住画面），
      // 所以署名只在大图（沉浸卡片）上显示，列表里用 title 提示。
      if (creditText) img.title = creditText;
      wrap.appendChild(img);
      box.replaceWith(wrap);
    }
  });

  return safe;
}

/**
 * 把来源信息拼成一行小字
 * 为什么要有它：Wikimedia Commons 的图多为 CC BY-SA 一类许可，
 * **要求署名**——不标注就是侵权。所以网络图必须带上来源、作者、许可。
 * @param {string|Object} credit
 * @returns {string} 例如「图：Wikimedia Commons · Mister rf · CC BY-SA 4.0」
 */
function formatImageCredit(credit) {
  if (!credit) return "";
  if (typeof credit === "string") return "图：" + credit;
  const parts = ["图：" + (credit.source || "")];
  if (credit.author) parts.push(compressText(credit.author, 24));
  if (credit.license) parts.push(credit.license);
  return parts.filter(Boolean).join(" · ");
}

/**
 * 给一批新闻自动配图（列表页 / 沉浸页都在生成后调用一次即可）
 *
 * "所有主题都自动配图"（AI_IMAGE.autoAll）：
 *   遍历整批新闻——已经有源站真图的不动（真图优先），
 *   其余一律走 ensureNewsImage()，由"原图 → 网络意象图 → 代码生成"三级保证拿到一张图，
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
