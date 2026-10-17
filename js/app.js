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

  list.innerHTML = newsList.map(news => `
    <article class="news-item">
      ${news.image
        ? `<img class="news-thumb" src="${news.image}" alt="新闻配图"
             loading="lazy"
             onerror="this.outerHTML='<div class=\\'news-thumb news-thumb-fallback\\'>🖼️</div>'">`
        : `<div class="news-thumb news-thumb-fallback">🖼️</div>`}
      <div class="news-body">
        <a href="${news.link}" target="_blank" rel="noopener">${news.title}</a>
        <div class="summary">${news.summary || "（这条新闻没有自带摘要，点击标题查看原文）"}</div>
        <div class="meta">
          <span>来源：${news.source}</span>
          ${news.time ? `<span>${news.time}</span>` : ""}
        </div>
      </div>
    </article>
  `).join("");
}

/* ============================================================
   沉浸浏览（抖音式卡片）—— 阶段 1：只负责"把一条新闻画成卡片"
   后面阶段会在此基础上加：上下翻页（阶段2）、手势（阶段3）、
   正式的视图切换开关（阶段4）
   ============================================================ */

/**
 * 把当前这条新闻（latestNews[immIndex]）画成一张全屏卡片
 */
function renderImmersiveCard() {
  const card = $("immCard");

  // 还没生成新闻：显示一句提示，避免空白
  if (!latestNews.length) {
    $("immCounter").textContent = "第 0 / 0 条";
    card.innerHTML = '<div class="imm-empty-card">还没有新闻，请先回到列表页生成今日简报</div>';
    return;
  }

  const news = latestNews[immIndex];

  // 顶部显示"第 N / M 条"
  $("immCounter").textContent = `第 ${immIndex + 1} / ${latestNews.length} 条`;

  // 分类徽章的颜色：科技蓝、财经橙、生活粉
  const badgeColors = { 科技: "#3b82f6", 财经: "#f59e0b", 生活: "#ec4899" };
  const badgeColor = badgeColors[news.category] || "#4f46e5";

  card.innerHTML = `
    <!-- 上半屏：封面大图；加载失败或无图时显示 🖼️ 占位 -->
    <div class="imm-media">
      <div class="imm-fallback">🖼️</div>
      ${news.image
        ? `<img src="${news.image}" alt="新闻封面"
             onerror="this.remove()">`   // 图片打不开就把自己删掉，露出占位图标
        : ""}
      <span class="imm-badge" style="background:${badgeColor}">${news.category}</span>
    </div>

    <!-- 下半屏：标题 + 摘要 + 来源时间 + 打开原文按钮 -->
    <div class="imm-info">
      <h3 class="imm-title">${news.title}</h3>
      <p class="imm-summary">${news.summary || "（这条新闻没有自带摘要，点下方按钮查看原文）"}</p>
      <div class="imm-meta">
        <span>来源：${news.source}</span>
        ${news.time ? `<span>${news.time}</span>` : ""}
      </div>
      <a class="imm-open" href="${news.link}" target="_blank" rel="noopener">
        打开原文 ↗
      </a>
    </div>
  `;
}

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

/** 打开沉浸浏览 */
function openImmersive() {
  renderImmersiveCard();
  $("immersiveView").classList.remove("hidden");
  document.body.style.overflow = "hidden";   // 锁住背景滚动，只让卡片动

  // 重新播放"操作提示"的淡出动画
  const hint = $("immHint");
  hint.classList.remove("show");
  void hint.offsetWidth;
  hint.classList.add("show");
}

/** 关闭沉浸浏览，回到列表 */
function closeImmersive() {
  $("immersiveView").classList.add("hidden");
  document.body.style.overflow = "";         // 恢复背景滚动
}

// 阶段 1 的临时入口 + 退出按钮（阶段 4 会换成正式开关）
$("btnPreviewImm").addEventListener("click", openImmersive);
$("immClose").addEventListener("click", closeImmersive);

// ---- 鼠标滚轮翻页（电脑用）----
// 向下滚 = 看下一条，向上滚 = 看上一条
$("immersiveView").addEventListener("wheel", e => {
  e.preventDefault();                 // 阻止页面背景跟着滚动

  // 例外：如果鼠标停在摘要文字上、且摘要内容超出可滚动，就让它正常滚文字
  if (e.target.closest(".imm-summary")
      && e.target.scrollHeight > e.target.clientHeight) return;

  stepImm(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

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
    for (const news of topNews) {
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
    latestNews = topNews;      // 沉浸浏览按顺序显示这批新闻
    immIndex = 0;              // 从第一条开始
    renderImmersiveCard();
    $("btnPreviewImm").classList.remove("hidden");

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
