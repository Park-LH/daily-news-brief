/**
 * ============================================================
 * stats.js —— 历史统计：记录每天的简报数据并画图表
 * ============================================================
 * 数据存储方案（双保险）：
 *   优先走后端接口（通过 start-server.bat 启动时可用）：
 *     POST /api/stats  保存数据 → 存到项目 .data/stats.json 文件
 *     GET  /api/stats  读取数据
 *   后端不可用时（如直接双击 index.html 的 file:// 方式），
 *   自动退回浏览器 localStorage，功能不中断。
 *   两边写入同步进行，数据始终有备份。
 */

// 统计图展示最近几天
const STATS_DAYS = 7;

// 三个分类的图表颜色（与页面粉蓝主题搭配）
const STATS_COLORS = {
  "科技": "#3b82f6",   // 蓝
  "财经": "#f59e0b",   // 金黄
  "生活": "#ec4899",   // 粉
};

/**
 * 生成某一天的存储键名，如 "2026-10-13"
 * （前后端约定：年-月-日，月和日不补零，两边保持一致）
 */
function statsDayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 记录今天的分类数据（每次成功生成简报后调用，同一天覆盖更新）
 * 同时写两处：localStorage（本地兜底）+ 后端接口（若有）
 */
async function recordTodayStats(tech, fin, life) {
  const key = statsDayKey(new Date());
  const value = { "科技": tech, "财经": fin, "生活": life, total: tech + fin + life };

  // 1. 本地兜底：无论如何先写 localStorage
  localStorage.setItem("news-stats-" + key, JSON.stringify(value));

  // 2. 后端：只在页面通过 http:// 打开时才尝试
  //    （file:// 方式没有服务器，fetch 相对路径必然失败，直接跳过）
  if (location.protocol === "http:" || location.protocol === "https:") {
    try {
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: key, stats: value }),
      });
    } catch (e) {
      // 后端没响应就静默降级——本地已有数据，不影响使用
    }
  }
}

/**
 * 读取最近 n 天的统计数据
 * 优先从后端读（换浏览器也能看到）；后端不可用则读 localStorage
 * @returns {Array} 每项含 { date, tech, fin, life, total, isToday }
 */
async function loadStatsDays(n) {
  // 先尝试后端
  let remote = null;
  if (location.protocol === "http:" || location.protocol === "https:") {
    try {
      const resp = await fetch("/api/stats");
      if (resp.ok) remote = await resp.json();
    } catch (e) {
      remote = null;   // 后端不可用，走本地
    }
  }

  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = statsDayKey(d);

    // 取数优先级：后端有数据 → 用后端；否则 → 查 localStorage
    let data = null;
    if (remote && remote[key]) {
      data = remote[key];
    } else {
      const saved = localStorage.getItem("news-stats-" + key);
      if (saved) data = JSON.parse(saved);
    }

    days.push({
      date: d,
      tech: data ? (data["科技"] || 0) : 0,
      fin: data ? (data["财经"] || 0) : 0,
      life: data ? (data["生活"] || 0) : 0,
      total: data ? (data.total || 0) : 0,
      isToday: i === 0,
    });
  }
  return days;
}

/**
 * 渲染统计板块：汇总行 + 堆叠柱状图 + 明细表
 */
async function renderStats() {
  const days = await loadStatsDays(STATS_DAYS);
  const card = document.getElementById("statsCard");
  const summary = document.getElementById("statsSummary");
  const bars = document.getElementById("statsBars");
  const tbody = document.getElementById("statsBody");

  // 有几天真实记录过数据
  const recordedDays = days.filter(d => d.total > 0).length;
  if (recordedDays === 0) {
    summary.textContent = "数据从今天开始积累：每次生成简报都会记一笔，连用几天后这里会出现历史统计图。";
  } else {
    const tech = days.reduce((s, d) => s + d.tech, 0);
    const fin = days.reduce((s, d) => s + d.fin, 0);
    const life = days.reduce((s, d) => s + d.life, 0);
    const total = tech + fin + life;
    const avg = (total / STATS_DAYS).toFixed(1);
    summary.textContent = `近 ${STATS_DAYS} 天共 ${total} 条 · 日均 ${avg} 条 · 科技 ${tech} / 财经 ${fin} / 生活 ${life}`;
  }

  // ---- 柱状图：柱子总高按当天合计与最大值的比例，内部按三分类分段 ----
  const max = Math.max(...days.map(d => d.total), 1);
  bars.innerHTML = days.map(day => {
    const h = Math.round(day.total / max * 100);
    const seg = (count, color) =>
      count === 0 ? "" :
      `<div style="height:${(count / day.total) * 100}%;background:${color}"></div>`;
    return `<div class="sbar-col">
      <div class="sbar" style="height:${h}%; opacity:${day.total === 0 ? 0.12 : 1}">
        ${seg(day.tech, STATS_COLORS["科技"])}
        ${seg(day.fin, STATS_COLORS["财经"])}
        ${seg(day.life, STATS_COLORS["生活"])}
      </div>
      <span>${day.isToday ? "今" : day.date.getDate()}</span>
    </div>`;
  }).join("");

  // ---- 明细表：每天一行 ----
  tbody.innerHTML = days.map(day => {
    const label = day.isToday
      ? "今天"
      : day.date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
        + " 周" + "日一二三四五六"[day.date.getDay()];
    const cls = day.isToday ? ' class="today"' : "";
    return `<tr${cls}>
      <td>${label}</td>
      <td>${day.tech}</td>
      <td>${day.fin}</td>
      <td>${day.life}</td>
      <td><b>${day.total}</b></td>
    </tr>`;
  }).join("");

  card.classList.remove("hidden");
}
