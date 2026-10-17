/**
 * ============================================================
 * app.js —— 主逻辑：按钮交互 + 抓取 + 页面渲染
 * ============================================================
 * 点击"生成今日简报"后的完整流程：
 *   1. 并行抓取 config.js 里配置的所有 RSS 源
 *      （某个源失败不影响其他源，页面上会标注）
 *   2. 合并所有新闻，按发布时间从新到旧排序，只保留 MAX_NEWS 条
 *   3. 按"科技 / 财经 / 生活"分类渲染到对应板块
 *   4. 每条新闻调用 generateSummary()（目前直接返回 RSS 摘要，
 *      以后接入 AI 时只改 config.js 里的这个函数即可）
 */

// 小工具：按 id 获取页面元素
const $ = id => document.getElementById(id);

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
 * 渲染单个分类板块
 * @param {string} category 分类名："科技" / "财经" / "生活"
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
        ? `<img class="news-thumb" src="${escapeHtml(img)}" alt="新闻配图"
             loading="lazy"
             onerror="this.outerHTML='<div class=\\'news-thumb news-thumb-fallback\\'>🖼️</div>'">`
        : `<div class="news-thumb news-thumb-fallback">🖼️</div>`}
      <div class="news-body">
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(news.title)}</a>
        <div class="summary">${escapeHtml(news.summary || "（这条新闻没有自带摘要，点击标题查看原文）")}</div>
        <div class="meta">
          <span>来源：${escapeHtml(news.source)}</span>
          ${news.time ? `<span>${escapeHtml(news.time)}</span>` : ""}
        </div>
      </div>
    </article>
  `;
  }).join("");
}

/* ============================================================
   沉浸浏览（抖音式卡片）—— 阶段 1：只负责"把一条新闻画成卡片"
   后面阶段会在此基础上加：上下翻页（阶段2）、手势（阶段3）、
   正式的视图切换开关（阶段4）
   ============================================================ */

/**
 * 组装「沉浸浏览」要看的新闻列表
 *
 * 做法：按 科技 → 财经 → 生活 的顺序，每个专题各取最多
 * IMMERSIVE_MAX_PER_CATEGORY 条，再依次拼起来。
 * 这样三个专题都能刷到，不会出现"只剩一个专题"的情况。
 *
 * @param {Array} sortedNews 已经按时间从新到旧排好序的新闻数组
 * @returns {Array} 沉浸浏览要显示的列表
 */
function buildImmersiveList(sortedNews) {
  const CATEGORY_ORDER = ["科技", "财经", "生活"];   // 沉浸浏览里的专题顺序
  const list = [];

  for (const category of CATEGORY_ORDER) {
    const items = sortedNews
      .filter(news => news.category === category)
      .slice(0, IMMERSIVE_MAX_PER_CATEGORY);
    list.push(...items);
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

  // 分类徽章的颜色：科技蓝、财经橙、生活粉
  const badgeColors = { 科技: "#3b82f6", 财经: "#f59e0b", 生活: "#ec4899" };
  const badgeColor = badgeColors[news.category] || "#4f46e5";

  // 图片地址同样要先过滤，只放行 http/https（见 safeUrl 的说明）
  const cover = safeUrl(news.image);
  const link = safeUrl(news.link);

  card.innerHTML = `
    <!-- 上半屏：封面大图；加载失败或无图时显示 🖼️ 占位 -->
    <div class="imm-media">
      <div class="imm-fallback">🖼️</div>
      ${cover
        ? `<img src="${escapeHtml(cover)}" alt="新闻封面"
             onerror="this.remove()">`   // 图片打不开就把自己删掉，露出占位图标
        : ""}
      <span class="imm-badge" style="background:${badgeColor}">${escapeHtml(news.category)}</span>
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
        <span>来源：${escapeHtml(news.source)}</span>
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
}

/**
 * 展开 / 收起「正文摘抄」
 * 从这条新闻的正文全文里挑出几条要点显示出来；
 * 如果这个源没有提供正文，就退回用原始摘要，并提示可打开原文
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
    // ---- 展开：生成要点 ----
    const source = news.content || news.rawSummary || "";
    const points = extractKeyPoints(source, 4);

    panel.innerHTML = points.length
      ? `<div class="imm-excerpt-title">📌 ${escapeHtml(news.category)} · 正文要点（自动摘抄）</div>
         <ul>${points.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
      : `<div class="imm-excerpt-title">📌 ${escapeHtml(news.category)} · 正文要点</div>
         <p class="imm-excerpt-empty">这个新闻源没有提供正文内容，
         点右边「打开原文 ↗」可以看完整文章。</p>`;

    panel.classList.remove("hidden");
    summary.classList.add("hidden");   // 摘抄展开时先收起一句话摘要，省地方
    btn.textContent = "收起摘抄 ✕";

    // 关键：给卡片加上"摘抄模式"，CSS 会把封面图收起、文字区放满整屏，
    // 摘抄区域因此拿到最大高度（见 style.css 的 .excerpt-open）
    $("immCard").classList.add("excerpt-open");
  } else {
    // ---- 收起：恢复显示一句话摘要 ----
    panel.classList.add("hidden");
    summary.classList.remove("hidden");
    btn.textContent = "📄 摘抄正文";
    $("immCard").classList.remove("excerpt-open");
  }
}

// 用事件委托绑定按钮：因为卡片每次翻页都会重新生成，
// 直接绑在按钮上会失效，绑在不变的父容器 #immCard 上最稳
$("immCard").addEventListener("click", e => {
  if (e.target.closest("#immExcerptBtn")) toggleExcerpt();
});

/* ---------- 阶段 2：上下翻页 ---------- */

// 翻页锁：鼠标滚轮一滚会连续触发几十次事件，
// 用它限制成"一次滚动只翻一条"，避免唰地跳到最后一条
let immLock = false;

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

/**
 * 翻页（供滚轮和方向键调用）
 * @param {number} delta 1 = 下一条，-1 = 上一条
 */
function stepImm(delta) {
  if (immLock || !latestNews.length) return;
  immLock = true;
  setTimeout(() => { immLock = false; }, 320);   // 320 毫秒内不重复翻页
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

  if (isImmersive) renderImmersiveCard();

  $("immersiveView").classList.toggle("hidden", !isImmersive);
  document.body.style.overflow = isImmersive ? "hidden" : "";  // 沉浸时锁住背景滚动

  // 开关上的高亮跟着当前视图走
  $("btnViewList").classList.toggle("active", !isImmersive);
  $("btnViewImmersive").classList.toggle("active", isImmersive);

  // 打开沉浸浏览时重新播放"操作提示"（几秒后自动淡出）
  // 注意：.show 必须加在里面的 <span> 上，CSS 里动画是 .imm-hint span.show，
  // 以前加在外层 div 上，提示根本不显示（已修正）
  if (isImmersive) {
    const hint = $("immHint");
    if (hint) {
      const hintText = hint.querySelector("span") || hint;
      hintText.classList.remove("show");
      void hint.offsetWidth;          // 强制重排，让动画能重新播放
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
$("immersiveView").addEventListener("wheel", e => {
  // 注意顺序：必须先判断"是不是在滚文字"，再决定要不要 preventDefault。
  // 之前是先 preventDefault 再判断，结果在摘要/摘抄里滚动被浏览器拦掉了，
  // 长摘抄根本滚不动——这是个实打实的 BUG，已修正。
  if (scrollableTextUnder(e.target)) return;   // 让文字区正常滚动

  e.preventDefault();                 // 阻止页面背景跟着滚动
  stepImm(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

/* ---------- 阶段 3：手机手指上下滑动翻页 ---------- */

// 记录手指按下时的位置，用来判断滑动方向和距离
let touchStartX = 0;
let touchStartY = 0;
let touchActive = false;   // 本次滑动是否由我们处理（否则不翻页）

$("immersiveView").addEventListener("touchstart", e => {
  if (e.touches.length !== 1) { touchActive = false; return; }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchActive = false;
}, { passive: true });

$("immersiveView").addEventListener("touchmove", e => {
  if (e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - touchStartY;
  const dx = e.touches[0].clientX - touchStartX;

  // 滑动距离太小、或者是横着滑的：不管（避免误触翻页）
  if (Math.abs(dy) < 10 || Math.abs(dy) <= Math.abs(dx)) return;

  // 手指落在可滚动的文字区里：让它正常滚文字
  if (scrollableTextUnder(e.target)) return;

  e.preventDefault();      // 拦住系统默认的页面滚动，改由我们翻页
  touchActive = true;

  // 跟手效果：手指移动时卡片跟着位移一点（0.45 是阻尼系数，手感更自然）
  $("immCard").style.transform = `translateY(${dy * 0.45}px)`;
}, { passive: false });

$("immersiveView").addEventListener("touchend", e => {
  // 松手先把位移复位（下一步要么翻页、要么弹回原位）
  $("immCard").style.transform = "";

  if (!touchActive) return;
  touchActive = false;

  const endY = e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
  const dy = endY - touchStartY;

  // 手指上滑（dy 为负）= 看下一条；下滑 = 看上一条。超过 45 像素才算一次翻页
  if (Math.abs(dy) > 45) stepImm(dy < 0 ? 1 : -1);
});

// 手指滑动被中途取消（比如来电）：同样复位，避免卡片卡在偏移状态
$("immersiveView").addEventListener("touchcancel", () => {
  $("immCard").style.transform = "";
  touchActive = false;
});

// ---- 键盘翻页 + ESC 退出 ----
document.addEventListener("keydown", e => {
  const isOpen = !$("immersiveView").classList.contains("hidden");

  if (e.key === "Escape") {            // ESC 随时可退出，防止被困住
    closeImmersive();
    return;
  }
  if (!isOpen) return;                 // 没打开沉浸浏览时，方向键保持页面默认行为

  if (e.key === "ArrowDown" || e.key === "PageDown") {
    e.preventDefault();
    stepImm(1);                        // ↓ 看下一条
  } else if (e.key === "ArrowUp" || e.key === "PageUp") {
    e.preventDefault();
    stepImm(-1);                       // ↑ 看上一条
  }
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
    // ---- 第 1 步：并行抓取所有源（Promise.allSettled 保证单个失败不影响整体）----
    const results = await Promise.allSettled(
      RSS_SOURCES.map(async source => {
        const items = await fetchRss(source.url);          // rss.js 里的抓取函数
        return items.slice(0, source.maxItems).map(item => ({
          ...item,
          category: source.category,                       // 标记分类
          source: source.name,                             // 标记来源名
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
        failedSources.push(RSS_SOURCES[i].name);
        // 把失败原因记到控制台，方便排查（页面只显示简明中文提示）
        console.warn("源抓取失败 - " + RSS_SOURCES[i].name + ":",
                     result.reason?.message || result.reason);
      }
    });

    // ---- 第 2 步：时间过滤，只保留"今天 00:00 之后"发布的新闻 ----
    const countBefore = allNews.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);   // 把时间拨到今天零点整
    const todayNews = allNews.filter(news => {
      const d = new Date(news.pubDate);
      // 没有日期或日期无效的新闻无法证明是今天的，一律排除
      return !isNaN(d.getTime()) && d >= todayStart;
    });
    // 打印过滤前后数量（浏览器按 F12 → Console 可看到这行）
    console.log(`[时间过滤] 过滤前共 ${countBefore} 条，今天 00:00 后保留 ${todayNews.length} 条`);

    // ---- 第 3 步：按时间从新到旧排序，最多保留 MAX_NEWS 条 ----
    todayNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const topNews = todayNews.slice(0, MAX_NEWS);

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

    // ---- 第 4 步：按分类渲染到三个板块 ----
    const techList = topNews.filter(n => n.category === "科技");
    const finList = topNews.filter(n => n.category === "财经");
    const lifeList = topNews.filter(n => n.category === "生活");
    renderCategory("科技", techList);
    renderCategory("财经", finList);
    renderCategory("生活", lifeList);

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
      await recordTodayStats(techList.length, finList.length, lifeList.length);
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
