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
      <a href="${news.link}" target="_blank" rel="noopener">${news.title}</a>
      <div class="summary">${news.summary || "（这条新闻没有自带摘要，点击标题查看原文）"}</div>
      <div class="meta">
        <span>来源：${news.source}</span>
        ${news.time ? `<span>${news.time}</span>` : ""}
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

    // 收集抓取成功的新闻；记录失败的源名，稍后提示
    const allNews = [];
    const failedSources = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        allNews.push(...result.value);
      } else {
        failedSources.push(RSS_SOURCES[i].name);
      }
    });

    // ---- 第 2 步：按时间从新到旧排序，最多保留 MAX_NEWS 条 ----
    allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const topNews = allNews.slice(0, MAX_NEWS);

    // ---- 第 3 步：给每条新闻生成摘要（AI 预留接口，见 config.js）----
    for (const news of topNews) {
      news.summary = await generateSummary(news.title, news.summary);
    }

    // ---- 第 4 步：按分类渲染到三个板块 ----
    renderCategory("科技", topNews.filter(n => n.category === "科技"));
    renderCategory("财经", topNews.filter(n => n.category === "财经"));
    renderCategory("生活", topNews.filter(n => n.category === "生活"));

    // ---- 展示结果 ----
    briefing.classList.remove("hidden");

    // 部分源失败时给出温和提示（不影响已抓到的新闻展示）
    if (failedSources.length > 0) {
      error.textContent = "⚠️ 以下源暂时无法访问：" + failedSources.join("、")
        + "。其余源已正常展示，可稍后重试。";
      error.classList.remove("hidden");
    }
    if (allNews.length === 0) {
      error.textContent = "❌ 所有源都抓取失败了。请检查网络连接后重试；"
        + "若长期失败，可在 js/config.js 中更换 RSS 源地址。";
      error.classList.remove("hidden");
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
