/**
 * ============================================================
 * summarize.js —— 自动总结（本地提取式，不需要 AI、不需要联网）
 * ============================================================
 *
 * 【原理（零基础解释）】
 * "提取式摘要"：不去凭空编话，而是从原文里挑出最重要的几句话，
 * 原样拼起来。做法很朴素但很实用：
 *   1. 把正文按句号、问号、感叹号切成一个个句子
 *   2. 给每个句子打分：越靠前分越高、长度适中的加分、含数字/数据的加分
 *   3. 按分数从高到低挑几句，再按原文顺序排好输出
 *
 * 这样做的好处：结果永远来自原文，不会出现 AI 编造内容的问题。
 * 以后想接真正的 AI，只需改 config.js 里的 generateSummary()。
 */

/**
 * 把带 HTML 标签的文本转成纯文字
 * @param {string} html 可能含 <p>、<img> 等标签的文本
 * @returns {string} 纯文字
 */
function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  // 把换行、连续空格压成一个空格，让句子更规整
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * 把一段文字切成句子
 * 用 match 而不是 split，是为了避免在很旧的浏览器上出错
 * @param {string} text 纯文字
 * @returns {Array<string>} 句子数组（太短的碎片会被丢掉）
 */
function splitSentences(text) {
  const arr = (text || "").match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
  return arr
    .map(s => s.trim())
    .filter(s => s.length >= 6);      // 少于 6 个字多半是碎片，丢掉
}

/**
 * 自动总结：生成"一句话摘要"
 * 取原文开头的一到两句话，控制在上限字数内
 *
 * @param {string} text   原文（可以含 HTML）
 * @param {number} maxLen 摘要最多多少个字，默认 90
 * @returns {string} 一句话摘要
 */
function summarizeText(text, maxLen = 90) {
  const clean = htmlToText(text);
  if (!clean) return "";

  const sentences = splitSentences(clean);
  if (!sentences.length) {
    // 没有标点符号可切，就直接截断
    return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
  }

  let out = "";
  for (const s of sentences) {
    // 已经凑够一半长度就不再加了，保证是"一句话"而不是一整段
    if (out.length >= maxLen * 0.5 && out.length > 30) break;

    const next = out ? out + s : s;
    if (next.length > maxLen) {
      if (!out) out = s.slice(0, maxLen) + "…";   // 第一句就超长：截断
      break;
    }
    out = next;
  }
  // 一句话摘要同样做通顺性校对（补"于"等缺失成分），缺成分的半截话读着最难受
  return smoothExcerptPoint(out || clean.slice(0, maxLen));
}

/**
 * 正文摘抄：从整篇文章里挑出几条要点
 *
 * @param {string} text      正文全文（可以含 HTML）
 * @param {number} maxPoints 最多摘几条，默认 4 条
 * @returns {Array<string>} 要点句子数组
 */
function extractKeyPoints(text, maxPoints = 4) {
  const clean = htmlToText(text);
  if (!clean) return [];

  // 看前 40 句：致信 / 讲话 / 报告这类稿子，核心表述（"指出……""强调……"）
  // 常常不在最开头，25 句会把后面真正的要点整段漏掉（2026-10-23 实测教训）
  const sentences = splitSentences(clean).slice(0, 40);
  if (!sentences.length) return [];

  // 逐句打分
  const scored = sentences.map((s, i) => {
    let score = 10 - i * 0.35;                             // 越靠前越重要（但别压得太狠）

    if (s.length >= 18 && s.length <= 90) score += 3;      // 长度适中，信息量足
    if (s.length > 120) score -= 2;                        // 太长多半是铺陈，降权
    if (/\d|%|％|亿|万|元|美元/.test(s)) score += 2;        // 含具体数据

    // 核心表述（致信/讲话/报告里真正的要点就在这些词后面）
    if (/指出|强调|提出|希望|呼吁|重申|倡议|主张|认为|要求|建议/.test(s)) score += 3;
    // 一般动作词
    if (/表示|宣布|发布|推出|将|计划|预计|同比|增长|下降|首次/.test(s)) score += 2;
    // 主张/举措类表述
    if (/坚持|推动|加强|促进|维护|倡导|共同|合作|安全|发展/.test(s)) score += 1;

    return { text: s, index: i, score: score };
  });

  // 按分数取前 N 条，再按原文出现顺序排回去（读起来才通顺）
  const picked = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPoints)
    .sort((a, b) => a.index - b.index);

  return picked
    .map(item => smoothExcerptPoint(item.text))   // 通顺性校对（补"于"等缺失成分）
    .filter(s => s && !isTruncatedPoint(s));      // 半截句子宁可不摘
}

/**
 * 摘抄要点的"通顺性校对"（2026-10-30 新增）
 *
 * 实测问题句（云南退役军人发布会那条的摘抄首句）：
 *   "…高质量发展新闻发布会10月30日在昆明举行。"
 * 主体（新闻发布会）后面直接跟日期，缺了介词"于"，读起来像"发布会"是日期的
 * 修饰语——句子既不顺畅也不准确。规范写法是"…新闻发布会**于**10月30日在昆明举行"。
 *
 * 只处理这一处最典型、也最安全的情况：
 *   <中文主体> + 日期 + （在）+ 地点/范围 + 举行|召开|举办|开幕|闭幕|启动|发布|举行
 * 且日期前面不是"于/在/，/、/（"时才补"于"，避免把本来通顺的句子改坏。
 *
 * @param {string} s 单句
 * @returns {string} 校对后的句子
 */
function smoothExcerptPoint(s) {
  if (!s) return s;
  // 主体（≥2 个汉字）直接接日期，且日期前不是 于/在/，/、/（/: 
  return s.replace(
    /([\u4e00-\u9fa5]{2,})((?:20\d{2}年)?\d{1,2}月\d{1,2}日)/g,
    (m, subj, date, offset, whole) => {
      const prev = whole.slice(Math.max(0, offset - 1), offset);
      // ⚠️ 关键：必须再看**主体词的最后一个字**。"将于"里的"于"本身是汉字，
      // 会被上面的中文主体一起吃掉；只查前一个字会得到"会"→ 误补成"将于于"
      // （2026-10-30 实测就踩了这个坑）。
      const subjTail = subj.slice(-1);
      if (/[于在至从自]/.test(subjTail)) return m;   // 已经有介词，不补
      if (/[于在，,、(（:：]/.test(prev)) return m;   // 前面是介词或停顿标点，不补
      return subj + "于" + date;
    }
  );
}

/**
 * 判断一条要点是不是"被截断的半截句子"
 * 半截句子（以"将自""将于""以及""包括"等悬空成分收尾）读着最难受，
 * 也不符合"摘抄必须完整"的要求——宁可不摘，也不要给读者一句残缺的话。
 */
function isTruncatedPoint(s) {
  if (!s) return true;
  const t = s.trim();
  // 以悬空的连词/介词收尾，说明后面被切掉了
  return /(?:将自|将于|以及|包括|其中|和|与|或|及|、|,|，)$/.test(t);
}

/**
 * 把文本里的特殊字符转成安全字符
 * 用途：新闻标题/摘要里如果带 < > 这类符号，直接插进页面会被当成 HTML 标签，
 *       先转义一下，保证它只是"显示出来"，不会被浏览器执行
 * @param {string} str 原文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
