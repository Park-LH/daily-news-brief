/**
 * ============================================================
 * interpret.js —— 新闻解读（本地规则实现：不联网、不编造）
 * ============================================================
 *
 * 【为什么这么做】
 * 用户要的不只是"摘抄原文"，而是**独到的深度解读**，具体三问：
 *   1. 这条新闻跟普通人生活有什么关系？
 *   2. 这件事是怎么来的（来龙去脉）？
 *   3. 文件背后藏着什么？
 *
 * 【最重要的原则：不许编造】
 * 本项目没有接 AI（config.js 里的 generateSummary 是预留接口），
 * 如果让代码"自由发挥"去解读，就等于**凭空编内容**——那比没有解读更糟。
 * 所以这里的每一条解读都必须满足：
 *   - 来自原文的 → 原样引用原文句子当"依据"，摆在结论下面，读者可自查；
 *   - 不是来自原文的 → 明确打上「通用判断」标签，并写清"原文未提及"。
 * 宁可写"原文没有提到"，也绝不编一句"这意味着……"。
 *
 * 【三问分别怎么落地】
 *   ① 与你我有关：用"民生维度词表"（医保/就业/房价/出行/税费…）去正文里命中句子，
 *      命中哪几个维度，就说明这条新闻关乎普通人哪几件事，并给出原句。
 *   ② 来龙去脉：抽含时间线索的句子（年份/月份/近日/此前/自…以来/近年来），
 *      按文中顺序排成脉络；再补一条"直接缘起"（因/为了/随着/根据…）。
 *   ③ 文件背后：先找出书名号《…》里的文件名，再找它的目标/时间表原句；
 *      外加"结构性信号"（首次、试点、征求意见、部署、时间表）给出通用判断。
 *
 * 三问里任何一问在原文中找不到信息，都如实写"原文未提及"，
 * 并给"可以追问的角度"（同样标注为通用判断）。
 */

/* ---------- ① 与你我有关：民生维度词表 ----------
   每条是一个 [维度名, 关键词数组]；命中关键词就说明这条新闻触及该维度。 */
const LIFE_DIMENSIONS = [
  ["就医 / 医保", ["医保", "就医", "医院", "挂号", "药品", "药价", "集采", "疫苗", "门诊", "住院", "看病", "医生"]],
  ["养老 / 社保", ["养老", "社保", "养老金", "退休", "长期护理", "养老保险", "医保目录"]],
  ["就业 / 收入", ["就业", "岗位", "招聘", "工资", "薪酬", "收入", "裁员", "失业", "用工", "最低工资", "劳动者"]],
  ["上学 / 考试", ["入学", "招生", "学费", "中考", "高考", "考试", "双减", "课后", "学区", "教师", "教材", "高校"]],
  ["住房 / 买房", ["买房", "房价", "房贷", "购房", "租房", "租赁", "公积金", "保障房", "限购", "物业", "楼市"]],
  ["出行 / 交通", ["出行", "地铁", "高铁", "航班", "机票", "限行", "公交", "打车", "停车", "油价", "充电", "公路", "铁路"]],
  ["钱袋子 / 税费", ["价格", "涨价", "降价", "收费", "资费", "税费", "个税", "退税", "补贴", "缴费", "费用", "成本", "利率"]],
  ["吃穿 / 消费", ["食品", "食品安全", "菜价", "物价", "消费", "快递", "外卖", "电商", "直播带货", "预制菜", "农产"]],
  // ⚠️ 2026-10-31 修：原来这里放着"网络"这种太泛的词，结果"陆路交通网络"被算成通信，
  //   同一句话被"出行"和"通信"两个维度重复命中。泛词一律换成有辨识度的词。
  ["通信 / 网络", ["网速", "流量", "5G", "6G", "宽带", "套餐", "基站", "通信", "算力", "卫星互联网", "手机资费"]],
  ["育儿 / 生育", ["育儿", "生育", "托育", "产假", "母婴", "幼儿园", "生育补贴"]],
  ["环境 / 天气", ["空气", "污染", "雾霾", "高温", "暴雨", "预警", "限电", "用电", "供水", "节能", "双碳"]],
  ["办事 / 证照", ["办证", "审批", "户籍", "身份证", "社保卡", "政务", "落户", "一网通办", "流程"]],
];

/* ---------- ② 来龙去脉：时间线索 ---------- */
const TIME_HINT_RE = /(19|20)\d{2}年|\d{1,2}月\d{1,2}日|\d{1,2}月(?!份)|今年|去年|明年|上月|本月|本周|近日|日前|此前|当天|当天起|自[^，。]{0,8}起|自[^，。]{0,10}以来|近年来|多年来|日前|阶段性|下一阶段|未来|到(19|20)\d{2}年/;
/* 直接缘起：因为什么、为了什么、依据什么 */
const CAUSE_HINT_RE = /(因为|由于|鉴于|为了|针对|随着|根据|依据|按照|按照.{0,10}要求|受.{0,6}影响|旨在)/;

/* ---------- ③ 文件背后：文件名 + 结构性信号 ---------- */
const DOC_NAME_RE = /《([^》]{2,30})》/g;
const DOC_TYPE_WORDS = ["规划", "方案", "意见", "通知", "办法", "规定", "纲要", "决定",
  "报告", "计划", "细则", "条例", "指南", "标准", "白皮书", "行动", "政策", "措施", "清单", "批复", "函"];
const GOAL_HINT_RE = /(目标|提出|要求|明确|力争|旨在|到(19|20)\d{2}年|将|意味着|标志|部署|试点|示范|推广|支持|鼓励)/;

/* 结构性信号 → 通用判断（都标注"通用判断"，不冒充原文结论） */
const STRUCT_SIGNALS = [
  [/首次|第一次|首型|首个|首艘|首台|首例/, "「首次 / 首个」：这类表述通常意味着从 0 到 1 的突破，后续看点在于能否规模化、常态化。"],
  [/试点|示范|先行|试验区/, "「试点 / 示范」：先在局部验证，效果好才可能推广——影响面现在还有限，但值得跟踪。"],
  [/征求意见|草案|审议|待批|拟/, "「征求意见 / 草案」：尚未定稿，内容和时间都可能调整，别当既成事实。"],
  [/目标|到(19|20)\d{2}年|力争|年限|时间表/, "给出了明确时间表 / 目标值：这类承诺可以事后对照检查，是判断执行力度的抓手。"],
  [/部署|会议|要求|强调|推进|印发/, "处于「部署 / 推进」阶段：真正的看点是从文件到落地的细则、资金和督查。"],
  [/基金|资金|投资|补贴|专项资金|亿元|万元/, "涉及真金白银：资金规模与来源决定了这件事能推多快、铺多广。"],
  [/监管|规范|整治|查处|处罚|标准/, "带有监管 / 规范性质：通常会改变行业的合规成本，进而影响价格和从业者。"],
];

/* 找不到信息时给的"追问角度"（明确标注为通用判断） */
const GENERIC_ANGLES = {
  "政治": ["会不会出具体执行细则（谁办、怎么办、什么时候办）", "涉及范围是全国，还是部分地区 / 部分行业", "有没有配套资金、督查或时间表"],
  "科技": ["这项技术离商用还差几步（试验 → 试点 → 规模应用）", "会改变哪些岗位、哪些产品的价格", "有没有标准、牌照或安全监管跟上"],
  "财经": ["价格 / 费率 / 补贴具体怎么变、什么时候执行", "对上下游行业和就业会怎么传导", "有没有配套的风险提示或监管措施"],
  "生活": ["在你所在城市什么时候落地、细则是什么", "享受 / 办理的条件和门槛", "要不要自己主动申请（很多福利不申请就没有）"],
};

/**
 * 取解读素材：优先文章页正文，其次 RSS 摘要
 * @param {Object} news
 * @returns {{ text: string, fromFullText: boolean }}
 */
function interpretSource(news) {
  if (!news) return { text: "", fromFullText: false };
  const body = String(news.content || "");
  const fromFullText = news.contentFromSummary === false && body.length > 0;
  return { text: fromFullText ? body : (body || String(news.rawSummary || news.summary || "")), fromFullText };
}

/**
 * 把素材切成句子（复用 summarize.js 的 splitSentences，保持切法一致）
 */
function interpretSentences(text) {
  return (typeof splitSentences === "function" ? splitSentences(text) : String(text || "").split(/[。！？]/))
    .map(s => String(s).replace(/\s+/g, " ").trim())
    .filter(s => s.length >= 8);
}

/**
 * 从句子里挑出**最合适**的一句：
 * - 命中任意关键词；
 * - 一句话只服务一个维度（used 集合去重，避免"陆路交通网络"同时算出行和通信）；
 * - 同等条件下挑信息量更足的（用长度近似，超过 90 字不再加分，避免选到超长句）。
 */
function pickBestSentence(sentences, words, used) {
  let best = "";
  let bestScore = -1;
  for (const s of sentences) {
    if (used.has(s)) continue;
    if (!words.some(w => s.includes(w))) continue;
    const score = Math.min(s.length, 90);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best) used.add(best);
  return best;
}

/**
 * ① 与你我有关
 */
function buildRelation(sentences, category) {
  const items = [];
  const used = new Set();          // 一句只用一次，避免多个维度重复引用同一句
  for (const [dim, words] of LIFE_DIMENSIONS) {
    const hit = pickBestSentence(sentences, words, used);
    if (hit) items.push({ text: `关乎「${dim}」`, evidence: hit, tag: "原文" });
    if (items.length >= 4) break;
  }
  if (items.length === 0) {
    return {
      items: [],
      note: "原文没有直接写到与普通人的生活相关的具体内容。",
      generic: (GENERIC_ANGLES[category] || GENERIC_ANGLES["政治"]).map(a => `可以从这个角度追问：${a}`),
    };
  }
  return { items, note: "", generic: [] };
}

/**
 * 从一句话里读出时间标签（用来给"脉络"做小标题）
 * 读不出具体日期时退回"近日 / 此前 / 近年来 / 背景"这类笼统标签——
 * 不猜、不脑补，读不出就老实写"背景"。
 */
function dateLabelOf(sentence) {
  const m = sentence.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/)
    || sentence.match(/(\d{1,2})月\s*(\d{1,2})日/)
    || sentence.match(/(20\d{2})年\s*(\d{1,2})月/)
    || sentence.match(/(20\d{2})年/);
  if (m) return m[0];
  if (/近日|日前|本周|当天/.test(sentence)) return "近日";
  if (/此前/.test(sentence)) return "此前";
  if (/近年来|多年来/.test(sentence)) return "近年来";
  if (/今年/.test(sentence)) return "今年";
  if (/去年/.test(sentence)) return "去年";
  return "背景";
}

/**
 * ② 来龙去脉
 */
function buildOrigin(sentences) {
  const items = [];
  // 直接缘起：为什么会发生
  const causes = sentences.filter(s => CAUSE_HINT_RE.test(s)).slice(0, 1);
  if (causes.length) {
    items.push({ text: "缘起：原文给出的起因 / 依据", evidence: causes[0], tag: "原文" });
  }
  // 时间线：按文中出现顺序（新闻稿通常也按这个顺序铺陈），每条标出时间
  const timeline = sentences.filter(s => TIME_HINT_RE.test(s)).slice(0, 4);
  timeline.forEach(s => {
    items.push({ text: dateLabelOf(s), evidence: s, tag: "原文" });
  });
  if (items.length <= 1) {
    return {
      items,
      note: "原文没有交代清楚这件事的时间线／背景。",
      generic: ["想弄清来龙去脉，可看原文开头的电头时间与「此前 / 自…以来」这类回溯表述"],
    };
  }
  return { items, note: "", generic: [] };
}

/**
 * ③ 文件背后
 */
function buildBehind(sentences) {
  const items = [];
  const full = sentences.join(" ");

  // 文件名（书名号里的），优先取像"文件"的那些
  const names = [];
  let m;
  DOC_NAME_RE.lastIndex = 0;
  while ((m = DOC_NAME_RE.exec(full)) !== null) {
    const nm = m[1];
    if (!names.includes(nm)) names.push(nm);
  }
  const docNames = names.filter(n => DOC_TYPE_WORDS.some(w => n.includes(w)));
  const pickedNames = (docNames.length ? docNames : names).slice(0, 3);

  for (const nm of pickedNames) {
    const withName = sentences.find(s => s.includes(nm)) || "";
    const goal = sentences.find(s => s.includes(nm) && GOAL_HINT_RE.test(s))
      || sentences.find(s => GOAL_HINT_RE.test(s) && Math.abs(sentences.indexOf(s) - sentences.indexOf(withName)) <= 2)
      || "";
    items.push({
      text: `点名文件《${nm}》${goal ? "：原文写明了它的要求 / 目标" : "：原文只提到名称，没展开内容"}`,
      evidence: goal || withName,
      tag: "原文",
      doc: nm,
    });
  }

  // 结构性信号 → 通用判断
  const signals = [];
  for (const [re, tip] of STRUCT_SIGNALS) {
    if (re.test(full)) signals.push(tip);
    if (signals.length >= 3) break;
  }
  signals.forEach(tip => items.push({ text: tip, evidence: "", tag: "通用判断" }));

  if (pickedNames.length === 0 && signals.length === 0) {
    return {
      items: [],
      note: "这条新闻没有点名具体文件，也没有明显的结构性信号。",
      generic: ["可追问：这件事有没有对应的红头文件？谁签发？有没有试点名单和时间表？"],
    };
  }
  if (pickedNames.length === 0) {
    return { items, note: "原文没有点名具体文件，以下是从文本信号读出的判断。", generic: [] };
  }
  return { items, note: "", generic: [] };
}

/**
 * 生成一条新闻的完整解读（三问）
 *
 * @param {Object} news 新闻对象
 * @returns {Object} { ok, fromFullText, sections: [{key,title,items,note,generic}] }
 */
function buildInterpretation(news) {
  const src = interpretSource(news);
  const sentences = interpretSentences(src.text);
  if (!sentences.length) {
    return { ok: false, fromFullText: src.fromFullText, sections: [] };
  }
  const category = (news && news.category) || "政治";
  return {
    ok: true,
    fromFullText: src.fromFullText,
    sections: [
      Object.assign({ key: "relation", title: "🧭 与你我有关" }, buildRelation(sentences, category)),
      Object.assign({ key: "origin", title: "🕰️ 来龙去脉" }, buildOrigin(sentences)),
      Object.assign({ key: "behind", title: "📜 文件背后" }, buildBehind(sentences)),
    ],
  };
}
