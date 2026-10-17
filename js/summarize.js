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
  return out || clean.slice(0, maxLen);
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

  // 只看前 25 句：新闻的重点一般在开头，也避免文章太长时算得慢
  const sentences = splitSentences(clean).slice(0, 25);
  if (!sentences.length) return [];

  // 逐句打分
  const scored = sentences.map((s, i) => {
    let score = 10 - i * 0.6;                              // 越靠前越重要

    if (s.length >= 18 && s.length <= 90) score += 3;      // 长度适中，信息量足
    if (/\d|%|％|亿|万|元|美元/.test(s)) score += 2;        // 含具体数据
    if (/表示|称|宣布|发布|推出|将|计划|预计|同比|增长|下降|首次/.test(s)) {
      score += 2;                                          // 含关键动作词
    }
    return { text: s, index: i, score: score };
  });

  // 按分数取前 N 条，再按原文出现顺序排回去（读起来才通顺）
  const picked = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPoints)
    .sort((a, b) => a.index - b.index);

  return picked.map(item => item.text);
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
