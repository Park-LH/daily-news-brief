/**
 * ============================================================
 * interpret.js —— 新闻解读（本地规则实现：不联网、不编造）
 * ============================================================
 *
 * 【为什么这么做】
 * 用户要的不只是"摘抄原文"，而是**独到的深度解读**。一共八个角度：
 *   1. 这条新闻跟普通人生活有什么关系？
 *   2. 这件事是怎么来的（来龙去脉）？
 *   3. 文件背后藏着什么？
 *   4. 影响评估与利益关联（谁受益、谁承担、规模多大）
 *   5. 另一面是什么（多元视角与对立观点）
 *   6. 接下来会怎么样（趋势预判与机会识别）
 *   7. 专业壁垒的翻译（用大白话说清楚行话）
 *   8. 我该怎么想（价值判断与认知主权）
 *
 * 【最重要的原则：不许编造】
 * 本项目没有接 AI（config.js 里的 generateSummary 是预留接口），
 * 如果让代码"自由发挥"去解读，就等于**凭空编内容**——那比没有解读更糟。
 * 所以这里的每一条解读都必须满足：
 *   - 来自原文的 → 原样引用原文句子当"依据"，摆在结论下面，读者可自查；
 *   - 不是来自原文的 → 明确打上标签，写清这是哪一类话：
 *       「通用判断」= 从文本信号推出的常识性判断
 *       「推演」    = "如果…那么…"的条件式推断，不是事实
 *       「视角」    = 建议你自己去补看的立场，原文里未必有
 *       「术语翻译」= 行话的大白话解释（词典式，与本文无关也能成立）
 * 宁可写"原文没有提到"，也绝不编一句"这意味着……"。
 *
 * 【八个角度分别怎么落地】
 *   ① 与你我有关：用"民生维度词表"（医保/就业/房价/出行/税费…）去正文里命中句子，
 *      命中哪几个维度，就说明这条新闻关乎普通人哪几件事，并给出原句。
 *   ② 来龙去脉：抽含时间线索的句子（年份/月份/近日/此前/自…以来/近年来），
 *      按文中顺序排成脉络；再补一条"直接缘起"（因/为了/随着/根据…）。
 *   ③ 文件背后：先找出书名号《…》里的文件名，再找它的目标/时间表原句；
 *      外加"结构性信号"（首次、试点、征求意见、部署、时间表）给出通用判断。
 *   ④ 影响评估：从原文找"谁受益"（支持/资金/获批…）、"谁承担"（成本/负担/整治…）、
 *      "规模多大"（亿元/%/颗…）；找不到的三方都如实说"原文没点明"。
 *   ⑤ 另一面：**不替原文编造对立观点**。只做两件事——
 *      (a) 把原文自己写的保留/风险表述（但、然而、仍需、瓶颈…）抽出来，这是真依据；
 *      (b) 给一份"还该看哪些立场"的视角清单，标为「视角」，请读者自行去查。
 *   ⑥ 接下来会怎么样：只做**条件式推演**（"若试点顺利，则…"），写清"看点/观察指标"；
 *      绝不用"一定会/必将"。机会识别只提示方向，不承诺收益。
 *   ⑦ 专业壁垒的翻译：命中行话词表（基金/试点/装机容量/审批…）给出大白话对照。
 *   ⑧ 我该怎么想：把原文句子按"事实 / 表态 / 未定"拆开（这是认知主权的基础），
 *      再给几条自我追问，标为「思考提示」。
 *
 * 任何一个角度在原文中找不到信息，都如实写"原文未提及"，
 * 并给"可以追问的角度"（同样标注为非原文）。
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

/* ---------- ④ 影响评估与利益关联 ---------- */
const BENEFIT_WORDS = ["支持", "扶持", "补贴", "专项资金", "基金", "投资", "赋能", "受益",
  "获准", "获批", "入选", "中标", "奖励", "减税", "退税", "让利", "利好", "降低"];
const COST_WORDS = ["成本", "负担", "压力", "涨价", "费用", "受限", "限制", "裁员", "关停",
  "整治", "处罚", "整改", "问责", "风险", "亏损", "下滑", "收紧", "门槛"];
const SCALE_RE = /\d+(?:\.\d+)?\s*(?:万亿元|亿元|万元|亿美元|亿美元|亿千瓦|万千瓦|万公里|万公里|颗|艘|架|台|公里|万吨|吨|%|个百分点|GW|MW|km|km²)/;

/* ---------- ⑤ 另一面（只抽原文自己的保留表述 + 给视角清单）---------- */
// 分两级：强信号是明确的风险/不足表述；弱信号（但/然而/不过/却）只是转折，
// 只在没有强信号时才用——否则会把导语里的一句"但…"当成风险（2026-10-31 实测误命中）
const RESERVE_STRONG_RE = /(风险|挑战|难题|不足|仍需|尚需|有待|瓶颈|制约|警惕|争议|不确定性|短板|薄弱|困难|隐忧|压力)/;
const RESERVE_WEAK_RE = /(但|然而|不过|却)/;

/* ---------- ⑥ 接下来会怎么样（只做条件式推演）---------- */
// ⚠️ 推演文案不要以"原文"开头：渲染时标签「推演」就排在文字前面，
// 再来一个"原文"会读成"推演原文给了时间表…"（2026-10-31 实测读感问题）
const NEXT_SIGNALS = [
  [/试点|示范|先行|试验区/, "处在「试点」阶段：推演路径是 试点 → 验收/评估 → 推广，现在只在第 1 步；没推广前，影响面按试点范围算。"],
  [/征求意见|草案|审议|拟|待批/, "还是「征求意见/草案」：推演是 稿子 → 修改 → 正式发布，现在的内容都可能改，别据此下决心。"],
  [/目标|到(19|20)\d{2}年|力争|时间表/, "给了时间表：推演是 对照 deadline 检查进度，到点没兑现本身就是信号。"],
  [/部署|印发|要求|推进|启动|开工/, "处在「部署/启动」：推演是 文件 → 细则 → 资金/责任到人 → 落地，细则没出前落不了地。"],
  [/建成|完成|投产|开通|获批|突破/, "说的是「已完成」：推演是 看后续运行数据（用起来怎么样、有没有达到设计目标）。"],
];
const OPPORTUNITY_WORDS = ["产业", "岗位", "人才", "招聘", "就业", "企业", "市场", "赛道",
  "创业", "投资", "订单", "产能", "需求", "培训"];

/* ---------- ⑦ 专业壁垒的翻译（行话 → 大白话）---------- */
const TERM_GLOSSARY = [
  ["基金 / 专项资金", ["基金", "专项资金"], "政府先出一部分钱，撬动社会资本一起投；不是白给，通常要看回报和落地。"],
  ["试点 / 示范", ["试点", "示范", "先行"], "先在小范围试，效果好再推广；没推广前跟大多数人关系不大。"],
  ["行动方案 / 规划", ["行动方案", "规划", "纲要", "意见", "通知"], "一份「要干成什么样、分几步、谁负责」的官样文件，真正的影响看后面的细则。"],
  ["装机容量", ["装机容量", "装机"], "发电设备满负荷能发多少电，是「能力」，不等于实际发出来的电量。"],
  ["在轨卫星", ["在轨"], "已经发射并在天上正常工作的卫星。"],
  ["审批 / 备案 / 核准", ["审批", "备案", "核准", "批复"], "做之前得先报上去、等同意；这一步常常是真正的门槛和时间成本。"],
  ["标准 / 规范", ["标准", "规范"], "统一的规矩。定了标准＝行业有了硬门槛，不合标准就进不了场。"],
  ["监管 / 整治", ["监管", "整治", "查处"], "要开始查、开始罚了；对守规矩的是好事，对靠灰色空间赚钱的是成本。"],
  ["补贴 / 退税", ["补贴", "退税", "减税"], "政府把钱给回你（或减少你交的钱）；通常有条件和期限，不是长期的。"],
  ["产业链 / 生态", ["产业链", "生态", "集群"], "从原料到成品再到服务的一整串环节；说「生态」往往意味着想吸引一批企业聚过来。"],
  ["算力", ["算力"], "能处理数据的能力，可以理解为「数字时代的发电量」。"],
  ["同比 / 环比", ["同比", "环比"], "同比＝跟去年同期比（去掉季节影响）；环比＝跟上个月比（看短期变化）。"],
  ["双碳 / 碳达峰 / 碳中和", ["双碳", "碳达峰", "碳中和"], "碳排放先到顶（达峰）、再靠减排和吸收抵消到净零（中和）。"],
  ["并网 / 上网电价", ["并网", "上网电价"], "发电接进电网＝并网；上网电价＝电网收购这电的价格，决定项目赚不赚钱。"],
  ["集采", ["集采", "带量采购"], "国家统一大批量采购，用「量大」换「价低」，药价常因此下降。"],
  ["卡脖子 / 自主可控", ["卡脖子", "自主可控", "国产化"], "关键环节捏在别人手里＝卡脖子；自己做、不受制于人＝自主可控。"],
  ["赋能 / 抓手 / 底座 / 闭环", ["赋能", "抓手", "底座", "闭环"], "公文常用词：赋能＝帮它变强；抓手＝具体下手的地方；底座＝底层基础；闭环＝从开头到结尾都能管上。"],
];

/* ---------- ⑧ 我该怎么想：事实 / 表态 / 未定 ---------- */
const FACT_RE = /(已|已经|完成|建成|投产|开通|获批|突破|达到|累计|数据显示|据|目前|现有|落地)/;
const STANCE_RE = /(将|要|力争|旨在|推动|支持|强调|部署|要求|鼓励|规划|期待|相信)/;
const PENDING_RE = /(拟|征求意见|草案|待|研究|探索|考虑|争取|计划|有望|或|可能)/;
const THINK_PROMPTS = [
  "这条事跟我所在的城市/行业有关吗？什么时候轮到我这里？",
  "承诺的事有没有「谁负责 + 什么时候 + 不兑现怎么办」？三样缺一样，多半只是表态。",
  "我看到的是「已经发生的」、「打算做的」，还是「还在研究的」？",
  "如果我是被影响的那个人，我会为它高兴还是发愁？",
];

/**
 * ④ 影响评估与利益关联：谁受益、谁承担、规模多大
 */
function buildImpact(sentences) {
  const items = [];
  const used = new Set();

  const benefit = pickBestSentence(sentences, BENEFIT_WORDS, used);
  if (benefit) items.push({ text: "受益方（原文点到的一方）", evidence: benefit, tag: "原文" });

  const cost = pickBestSentence(sentences, COST_WORDS, used);
  if (cost) items.push({ text: "承担成本 / 受约束的一方（原文点到的）", evidence: cost, tag: "原文" });

  const scale = sentences.filter(s => SCALE_RE.test(s)).slice(0, 2);
  scale.forEach(s => {
    if (used.has(s)) return;
    used.add(s);
    const m = s.match(SCALE_RE);
    items.push({ text: `规模量级：${m ? m[0] : "（原文数字）"}`, evidence: s, tag: "原文" });
  });

  if (items.length === 0) {
    return {
      items: [],
      note: "原文没有点明谁受益、谁承担成本，也没有给出可衡量规模的数字。",
      generic: [
        "追问：这笔钱 / 这项政策由谁出？最终落到谁头上？",
        "追问：受益的是哪一类主体（企业 / 地方 / 特定人群），是普遍还是少数？",
      ],
    };
  }
  return {
    items,
    note: "下面只是原文点到的相关方，不代表全部——没被点名的一方（例如普通消费者、被监管方）原文没写。",
    generic: [
      "追问：还有谁会被波及，但原文没提？",
      "追问：收益和成本是不是落在同一批人身上？",
    ],
  };
}

/**
 * ⑤ 另一面是什么（多元视角与对立观点）
 *
 * ⚠️ 这里**绝不替原文编造对立观点**（那等于造谣）。
 * 只做两件事：把原文自己写的保留/风险表述抽出来（真依据）+
 * 给一份"还该看哪些立场"的视角清单（标为「视角」，请读者自己去查）。
 */
function buildOtherSide(sentences, category) {
  const items = [];
  const used = new Set();

  // (a) 原文自己提到的保留 / 风险表述（先找强信号，没有再用转折词）
  let reserves = sentences.filter(s => RESERVE_STRONG_RE.test(s)).slice(0, 2);
  if (reserves.length === 0) {
    // 用转折词兜底时跳过第 1 句：导语里的"但…"常常只是引出主题，不是风险
    reserves = sentences.slice(1).filter(s => RESERVE_WEAK_RE.test(s)).slice(0, 1);
  }
  reserves.forEach(s => {
    used.add(s);
    // ⚠️ 文案不要以"原文"开头：渲染时「原文」标签就排在前面，会读成"原文原文…"
    items.push({ text: "自己写到的保留 / 风险表述", evidence: s, tag: "原文" });
  });

  // (b) 视角清单：看一件事至少还该听谁说
  const views = [
    "发布方的目标（他们想办成什么）",
    "执行方的成本（谁去干、钱和时间从哪来）",
    "被影响方的感受（普通人 / 被监管者是受益还是添麻烦）",
    "另一条路（不这么干会怎样，有没有别的做法）",
  ];
  views.forEach(v => items.push({ text: `还该听听这一面：${v}`, evidence: "", tag: "视角" }));

  return {
    items,
    note: reserves.length
      ? "上面带「原文」的是文章自己写的保留意见；带「视角」的是建议你自己去补看的立场，原文里未必有，需要另行查证。"
      : "原文没有给出任何保留或风险表述。带「视角」的是建议你自己去补看的立场，需要另行查证——不要把它们当成原文的观点。",
    generic: [],
  };
}

/**
 * ⑥ 接下来会怎么样（趋势预判与机会识别）
 *
 * ⚠️ 只做**条件式推演**（"若…则…"），绝不用"一定会/必将"。
 * 机会识别只提示方向，不承诺任何收益。
 */
function buildNext(sentences) {
  const items = [];
  const full = sentences.join(" ");

  let predicted = 0;
  for (const [re, tip] of NEXT_SIGNALS) {
    if (re.test(full)) {
      items.push({ text: tip, evidence: "", tag: "推演" });
      predicted += 1;
      if (predicted >= 2) break;
    }
  }

  // 观察指标：下一步该盯着什么看（通用判断）
  items.push({
    text: "接着该盯的三个观察点：① 有没有出实施细则 ② 钱和责任到没到位 ③ 有没有验收 / 督查 / 通报",
    evidence: "",
    tag: "推演",
  });

  // 机会识别：只在原文真的提到产业/岗位等词时才提示，避免空谈
  const hit = OPPORTUNITY_WORDS.filter(w => full.includes(w));
  if (hit.length >= 2) {
    items.push({
      text: `提到了「${hit.slice(0, 3).join("、")}」：若这件事推进，相关方向与岗位需求可能随之变化——仅为方向提示，不构成任何建议`,
      evidence: "",
      tag: "推演",
    });
  }

  return {
    items,
    note: predicted
      ? "以上都是条件式推演（若…则…），不是对未来的承诺；实际情况取决于细则、资金和执行力度。"
      : "原文没有明显的阶段性信号，下面是通用的观察方式，属条件式推演，不是对未来的承诺。",
    generic: [],
  };
}

/**
 * ⑦ 专业壁垒的翻译（行话 → 大白话）
 * 词典式解释：与本文无关也能成立，所以不算"关于本文的编造"。
 */
function buildPlainWords(sentences) {
  const full = sentences.join(" ");
  const items = [];
  for (const [name, keys, plain] of TERM_GLOSSARY) {
    if (keys.some(k => full.includes(k))) {
      items.push({ text: `${name} → ${plain}`, evidence: "", tag: "术语翻译" });
    }
    if (items.length >= 6) break;
  }
  if (items.length === 0) {
    return {
      items: [],
      note: "这条新闻里没有命中常见行话词表，应该可以直接读懂。",
      generic: ["遇到看不懂的词，先看它是不是「谁给谁钱 / 谁管谁 / 谁先谁后」这三类关系之一"],
    };
  }
  return {
    items,
    note: "以上是对词语本身的解释（词典式），不是对这条新闻的结论。",
    generic: [],
  };
}

/**
 * ⑧ 我该怎么想（价值判断与认知主权）
 * 先把原文拆成"事实 / 表态 / 未定"三类——这是独立判断的基础。
 */
function buildHowToThink(sentences) {
  const items = [];
  const used = new Set();

  const fact = pickBestSentence(sentences, ["已", "完成", "建成", "获批", "数据显示", "达到", "累计"], used);
  const fact2 = sentences.find(s => FACT_RE.test(s) && !used.has(s));
  if (fact) items.push({ text: "【已经发生的事实】", evidence: fact, tag: "原文" });
  if (fact2) { used.add(fact2); items.push({ text: "【已经发生的事实】", evidence: fact2, tag: "原文" }); }

  const stance = sentences.find(s => STANCE_RE.test(s) && !used.has(s));
  if (stance) {
    used.add(stance);
    items.push({ text: "【打算做 / 表态】（还没发生，别当既成事实）", evidence: stance, tag: "原文" });
  }

  const pending = sentences.find(s => PENDING_RE.test(s) && !used.has(s));
  if (pending) {
    used.add(pending);
    items.push({ text: "【还没定 / 待验证】（草案、研究中，或只是预测）", evidence: pending, tag: "原文" });
  }

  THINK_PROMPTS.forEach(p => items.push({ text: p, evidence: "", tag: "思考提示" }));

  return {
    items,
    note: "先把原文拆成「事实 / 表态 / 未定」三类，再问自己下面几条——判断留给你自己做，代码不下结论。",
    generic: [],
  };
}

/**
 * 生成一条新闻的完整解读（八个角度）
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
      Object.assign({ key: "impact", title: "⚖️ 影响评估与利益关联" }, buildImpact(sentences)),
      Object.assign({ key: "otherside", title: "🔄 另一面是什么" }, buildOtherSide(sentences, category)),
      Object.assign({ key: "next", title: "🔮 接下来会怎么样" }, buildNext(sentences)),
      Object.assign({ key: "plain", title: "🔤 专业壁垒的翻译" }, buildPlainWords(sentences)),
      Object.assign({ key: "think", title: "🤔 我该怎么想" }, buildHowToThink(sentences)),
    ],
  };
}
