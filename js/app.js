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
