/**
 * ============================================================
 * interpret.js —— 新闻解读（本地规则实现：不联网、不编造）
 * ============================================================
 *
 * 【为什么这么做】
 * 用户要的不只是"摘抄原文"，而是**独到的深度解读**，共八个角度：
 *   1. 与你我有关      2. 来龙去脉        3. 文件背后
 *   4. 影响评估与利益关联                5. 另一面是什么
 *   6. 接下来会怎么样  7. 专业壁垒的翻译  8. 我该怎么想
 *
 * 【两条铁律】
 *
 * 铁律一：不许编造。
 * 代码没有 AI，如果"自由发挥"去解读，就是凭空编内容——比没有解读更糟。
 * 所以每条解读都带标签：
 *   「原文」    = 下面附原句依据，可逐条自查
 *   「通用判断」= 从文本信号推出的常识性判断（同样附触发它的原句）
 *   「推演」    = "若…则…"的条件式推断，不是对未来的承诺（同样附原句）
 *   「术语翻译」= 对词语本身的解释（词典式），与本文无关也成立
 *
 * 铁律二：没有内容就不显示这个角度（2026-10-31 用户批评后重写）。
 * 上一版的毛病：⑤「另一面」永远显示 4 条写死的"视角清单"、
 * ⑥ 永远显示"三个观察点"、⑧ 永远显示 4 条"思考提示"——
 * **通篇模板，跟这条新闻毫无关系，等于没做这个功能**（已记入错题本⑭）。
 * 现在的规定：
 *   - 每个角度都**只能从这篇正文里长出内容**；
 *   - 连"通用判断 / 推演"也必须能指回**触发它的原句**（没有原句就不输出）；
 *   - 某个角度在这篇里找不到任何东西 → **整节不显示**，绝不拿模板凑数；
 *   - 八个角度一个都没有 → 面板如实说"可识别的解读点太少"，并指路原文。
 *
 * 【八个角度各自怎么从正文里长出来】
 *   ① 与你我有关：民生维度词表（医保/就业/房价/出行/税费…）命中正文句子。
 *   ② 来龙去脉：时间线索句 + 日期标签；再加一条"缘起"。
 *   ③ 文件背后：书名号《…》文件名 + 它的目标/时间表原句 + 结构性信号（附原句）。
 *   ④ 影响评估：受益方 / 承担方 / 涉及机构 / 规模数字，全部取自原文句子。
 *   ⑤ 另一面：**不替原文编对立观点**。只抽原文里真实存在的——
 *      不同主体的表态（"某某表示/指出/认为…"）、以及保留/风险表述。
 *   ⑥ 接下来：原文自己写的下一步 / 时间表 / 计划 + 阶段性推演（都附原句）
 *      + 原文提到的关键节点（验收/推广/督查…）。没有就不显示。
 *   ⑦ 术语翻译：命中行话词表才输出。
 *   ⑧ 我该怎么想：把原文拆成「事实 / 表态 / 未定」三类；再基于这篇里
 *      **实际出现的**文件 / 金额 / 时间表 / 机构 / 地区，生成针对它的追问。
 */

/* ---------- ① 与你我有关：民生维度词表 ---------- */
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
  ["办事 / 证照", ["办证", "审批", "户籍", "身份证", "社保卡", "政务", "落户"]],
  ["安全 / 军工", ["导弹", "军售", "军事", "国防", "演习", "部队", "武器", "防空", "冲突", "停火"]],
];

/* ---------- ② 来龙去脉 ---------- */
const TIME_HINT_RE = /(19|20)\d{2}年|\d{1,2}月\d{1,2}日|\d{1,2}月(?!份)|今年|去年|上年|明年|上月|本月|本周|近日|日前|此前|当天|自[^，。]{0,8}起|自[^，。]{0,10}以来|近年来|多年来|阶段性|下一阶段|截至|未来|到(19|20)\d{2}年/;
const CAUSE_HINT_RE = /(因为|由于|鉴于|为了|针对|随着|根据|依据|按照|受.{0,6}影响|旨在)/;

/* ---------- ③ 文件背后 ---------- */
const DOC_NAME_RE = /《([^》]{2,30})》/g;
const DOC_TYPE_WORDS = ["规划", "方案", "意见", "通知", "办法", "规定", "纲要", "决定",
  "报告", "计划", "细则", "条例", "指南", "标准", "白皮书", "行动", "政策", "措施", "清单", "批复"];
const GOAL_HINT_RE = /(目标|提出|要求|明确|力争|旨在|到(19|20)\d{2}年|意味着|标志|部署|试点|示范|推广|支持|鼓励)/;

/* 结构性信号 → 通用判断（**必须能指回触发它的原句**，否则不输出） */
const STRUCT_SIGNALS = [
  [/首次|第一次|首型|首个|首艘|首台|首例/, "「首次 / 首个」：通常意味着从 0 到 1 的突破，后续看点在于能否规模化、常态化。"],
  [/试点|示范|先行|试验区/, "「试点 / 示范」：先在局部验证，效果好才可能推广——现在影响面还有限。"],
  [/征求意见|草案|审议|待批|拟/, "「征求意见 / 草案」：尚未定稿，内容和时间都可能改，别当既成事实。"],
  [/到(19|20)\d{2}年|力争|目标|时间表/, "给了明确时间表 / 目标值：这类承诺可以事后对照检查。"],
  [/部署|会议|要求|强调|推进|印发/, "处在「部署 / 推进」阶段：真正的看点是细则、资金和督查。"],
  [/基金|专项资金|投资|补贴|亿元|万元|亿美元/, "涉及真金白银：资金规模与来源决定它能推多快、铺多广。"],
  [/监管|规范|整治|查处|处罚|标准/, "带监管 / 规范性质：会改变行业合规成本，进而影响价格和从业者。"],
];

/* ---------- ④ 影响评估与利益关联 ---------- */
const BENEFIT_WORDS = ["支持", "扶持", "补贴", "专项资金", "基金", "投资", "赋能", "受益",
  // ⚠️ 2026-10-31 修：去掉"批准"——"经过审查和批准"是程序，不是受益方
  "获准", "获批", "入选", "中标", "奖励", "减税", "退税", "让利", "利好", "降低"];
const COST_WORDS = ["成本", "负担", "压力", "涨价", "费用", "受限", "限制", "裁员", "关停",
  "整治", "处罚", "整改", "问责", "风险", "亏损", "下滑", "收紧", "门槛", "承担"];
const SCALE_RE = /\d+(?:\.\d+)?\s*(?:万亿元|亿元|万元|亿美元|亿千瓦|万千瓦|万公里|颗|艘|架|台|公里|万吨|吨|%|个百分点|GW|MW)/;
/* 机构 / 责任主体：用来回答"这件事是谁在办" */
const ORG_RE = /[\u4e00-\u9fa5]{2,10}(?:局|部|委|厅|署|市政府|省政府|管委会|集团|公司|大学|研究院|协会|银行|中心|企业)/;

/* ---------- ⑤ 另一面：只抽原文里真实存在的不同声音 ---------- */
/* 表态动词：用来抓"谁说了什么"——不同主体的说法本身就是多元视角 */
const VOICE_RE = /(表示|称|指出|认为|说|强调|呼吁|建议|批评|质疑|回应|介绍|透露|宣布|透露)/;
/* 保留 / 风险表述：分两级，"但/然而"只是转折，只作兜底且跳过首句（避免误抓导语） */
const RESERVE_STRONG_RE = /(风险|挑战|难题|不足|仍需|尚需|有待|瓶颈|制约|警惕|争议|不确定性|短板|薄弱|困难|隐忧|压力|周期极长|投入极大)/;
const RESERVE_WEAK_RE = /(但|然而|不过|却)/;

/* ---------- ⑥ 接下来会怎么样 ---------- */
const NEXT_SIGNALS = [
  [/试点|示范|先行|试验区/, "处在「试点」阶段：推演路径是 试点 → 验收/评估 → 推广，现在只在第 1 步。"],
  [/征求意见|草案|审议|待批/, "还是「征求意见/草案」：推演是 稿子 → 修改 → 正式发布，内容都可能改。"],
  [/到(19|20)\d{2}年|力争|目标|时间表/, "给了时间表：可以对照 deadline 检查进度，到点没兑现本身就是信号。"],
  [/部署|印发|要求|推进|启动|开工|筹建/, "处在「部署/启动」：推演是 文件 → 细则 → 资金/责任到人 → 落地。"],
  [/建成|完成|投产|开通|获批|突破/, "说的是「已完成」：推演是 看后续运行数据（用起来怎么样、达没达到设计目标）。"],
];
/* 原文自己写的下一步 / 计划 */
// ⚠️ 2026-10-31 修：原来这里放着裸的"未来"和"将"，结果"上海世博会则进一步变成世界共同讨论
// 城市的未来"这种陈述句也被当成"下一步计划"。现在只认明确的未来动作表述。
const NEXT_PLAN_RE = /(下一步|接下来|计划于|计划将|计划在|预计|年底前|年内|即将|有望|加快推进|分阶段|将于|将在|陆续|拟(?:于|建|设|投))/;
/* 关键节点：验收 / 推广 / 督查 / 评估 —— 有原文才提，不写死"三个观察点" */
const NODE_RE = /(细则|验收|评估|督查|督导|推广|落实|专项资金|责任单位|时间表|分期|二期|第一阶段)/;
// ⚠️ 2026-10-31 修：去掉"需求"这类泛词（实测"精神生活需求"被误当成机会信号）
const OPPORTUNITY_WORDS = ["产业", "岗位", "人才", "招聘", "就业", "市场", "赛道", "订单", "产能", "培训"];

/* ---------- ⑦ 专业壁垒的翻译（行话 → 大白话）---------- */
const TERM_GLOSSARY = [
  ["基金 / 专项资金", ["基金", "专项资金"], "政府先出一部分钱，撬动社会资本一起投；不是白给，通常要看回报和落地。"],
  ["试点 / 示范", ["试点", "示范", "先行"], "先在小范围试，效果好再推广；没推广前跟大多数人关系不大。"],
  // ⚠️ 2026-10-31 修：keys 里原来有裸的"规划"和"意见"，结果"城市规划专家"
  // 也会被当成政策文件。泛词一律收紧成有辨识度的搭配。
  ["行动方案 / 规划", ["行动方案", "规划纲要", "纲要", "通知"], "一份「要干成什么样、分几步、谁负责」的官样文件，真正的影响看后面的细则。"],
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
  ["军售 / 对外军售", ["军售", "对外军售"], "一国把武器卖给另一国；通常要走本国审批程序，且常附带政治条件。"],
  ["赋能 / 抓手 / 底座 / 闭环", ["赋能", "抓手", "底座", "闭环"], "公文常用词：赋能＝帮它变强；抓手＝具体下手的地方；底座＝底层基础；闭环＝从开头到结尾都能管上。"],
];

/* ---------- ⑧ 我该怎么想：事实 / 表态 / 未定 ---------- */
const FACT_RE = /(已|已经|完成|建成|投产|开通|获批|突破|达到|累计|数据显示|目前|现有|落地|批准)/;
const STANCE_RE = /(将|要|力争|旨在|推动|支持|强调|部署|要求|鼓励|规划|期待|相信|拟打造)/;
// ⚠️ 2026-10-31 修：去掉裸的"计划"——"综合计划部"这种机构名会被误判成"还没定"
const PENDING_RE = /(拟|征求意见|草案|待批|有待|研究(?:中|制定)?|探索|考虑|争取|计划于|计划将|有望|可能|预测)/;

/**
 * 取解读素材：优先文章页正文，其次 RSS 摘要
 */
function interpretSource(news) {
  if (!news) return { text: "", fromFullText: false };
  const body = String(news.content || "");
  const fromFullText = news.contentFromSummary === false && body.length > 0;
  return { text: fromFullText ? body : (body || String(news.rawSummary || news.summary || "")), fromFullText };
}

/**
 * 把素材切成句子
 */
function interpretSentences(text) {
  return (typeof splitSentences === "function" ? splitSentences(text) : String(text || "").split(/[。！？]/))
    .map(s => String(s).replace(/\s+/g, " ").trim())
    .filter(s => s.length >= 8);
}

/**
 * 挑出**最合适**的一句：命中关键词、一句只用一次、信息量更足的优先
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
 * 按正则挑句子（可排除已用过的）
 */
function pickByRe(sentences, re, limit, used) {
  const out = [];
  for (const s of sentences) {
    if (out.length >= limit) break;
    if (used && used.has(s)) continue;
    if (re.test(s)) { out.push(s); if (used) used.add(s); }
  }
  return out;
}

/* ============================================================
 * ① 与你我有关
 * ============================================================ */
function buildRelation(sentences) {
  const items = [];
  const used = new Set();
  for (const [dim, words] of LIFE_DIMENSIONS) {
    const hit = pickBestSentence(sentences, words, used);
    if (hit) items.push({ text: `关乎「${dim}」`, evidence: hit, tag: "原文" });
    if (items.length >= 4) break;
  }
  return { items, note: "" };
}

/* ============================================================
 * ② 来龙去脉
 * ============================================================ */
function dateLabelOf(sentence) {
  const m = sentence.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/)
    || sentence.match(/(\d{1,2})月\s*(\d{1,2})日/)
    || sentence.match(/(20\d{2})年\s*(\d{1,2})月/)
    || sentence.match(/(20\d{2})年/);
  if (m) return m[0];
  if (/近日|日前|本周|当天/.test(sentence)) return "近日";
  if (/此前/.test(sentence)) return "此前";
  if (/截至/.test(sentence)) return "截至";
  if (/近年来|多年来/.test(sentence)) return "近年来";
  if (/今年/.test(sentence)) return "今年";
  if (/去年|上年/.test(sentence)) return "去年";
  return "背景";
}

function buildOrigin(sentences) {
  const items = [];
  const used = new Set();

  const causes = pickByRe(sentences, CAUSE_HINT_RE, 1, used);
  if (causes.length) items.push({ text: "缘起：原文给出的起因 / 依据", evidence: causes[0], tag: "原文" });

  const timeline = pickByRe(sentences, TIME_HINT_RE, 4, used);
  timeline.forEach(s => items.push({ text: dateLabelOf(s), evidence: s, tag: "原文" }));

  return { items, note: "" };
}

/* ============================================================
 * ③ 文件背后
 * ============================================================ */
function buildBehind(sentences) {
  const items = [];
  const used = new Set();
  const full = sentences.join(" ");

  const names = [];
  let m;
  DOC_NAME_RE.lastIndex = 0;
  while ((m = DOC_NAME_RE.exec(full)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  const docNames = names.filter(n => DOC_TYPE_WORDS.some(w => n.includes(w)));
  let picked = docNames.length ? docNames : names;
  // 去重：《注册报告》是《上海世博会注册报告》的子串，别当成两个文件（2026-10-31 修）。
  // 用下标比较而不是 o !== n，否则同名字符串会把自己也过滤掉。
  picked = picked.filter((n, i) => !picked.some((o, j) => i !== j && o.includes(n)));
  const pickedNames = picked.slice(0, 3);

  for (const nm of pickedNames) {
    const withName = sentences.find(s => s.includes(nm)) || "";
    const goal = sentences.find(s => s.includes(nm) && GOAL_HINT_RE.test(s))
      || (GOAL_HINT_RE.test(withName) ? withName : "");
    if (!withName && !goal) continue;
    used.add(withName);
    if (goal) used.add(goal);
    items.push({
      text: `点名文件《${nm}》${goal ? "：原文写明了它的要求 / 目标" : "：原文只提到名称，没展开内容"}`,
      evidence: goal || withName,
      tag: "原文",
    });
  }

  // 结构性信号：必须能指回触发它的原句，否则就是空模板，不输出
  for (const [re, tip] of STRUCT_SIGNALS) {
    const s = sentences.find(x => !used.has(x) && re.test(x));
    if (!s) continue;
    used.add(s);
    items.push({ text: tip, evidence: s, tag: "通用判断" });
    if (items.length >= 6) break;
  }

  return { items, note: "" };
}

/* ============================================================
 * ④ 影响评估与利益关联
 * ============================================================ */
function buildImpact(sentences) {
  const items = [];
  const used = new Set();

  const benefit = pickBestSentence(sentences, BENEFIT_WORDS, used);
  if (benefit) items.push({ text: "受益方（原文点到的一方）", evidence: benefit, tag: "原文" });

  const cost = pickBestSentence(sentences, COST_WORDS, used);
  if (cost) items.push({ text: "承担成本 / 受约束的一方", evidence: cost, tag: "原文" });

  // 涉及机构 / 责任主体：回答"这件事是谁在办"
  const orgSent = sentences.find(s => !used.has(s) && ORG_RE.test(s));
  if (orgSent) {
    const om = orgSent.match(ORG_RE);
    used.add(orgSent);
    items.push({ text: `涉及主体：${om ? om[0] : "（原文提到的机构）"}`, evidence: orgSent, tag: "原文" });
  }

  // 规模量级：只取原文真的写了的数字
  const scaleSents = sentences.filter(s => !used.has(s) && SCALE_RE.test(s)).slice(0, 2);
  scaleSents.forEach(s => {
    used.add(s);
    const sm = s.match(SCALE_RE);
    items.push({ text: `规模量级：${sm ? sm[0] : "（原文数字）"}`, evidence: s, tag: "原文" });
  });

  return { items, note: "" };
}

/* ============================================================
 * ⑤ 另一面是什么（多元视角）
 *
 * ⚠️ 绝不替原文编造对立观点。只抽原文里真实存在的：
 *   (a) 不同主体的表态（"某某表示 / 指出 / 认为…"）
 *   (b) 保留 / 风险表述
 * 抽不到 → 整节不显示（由 buildInterpretation 过滤）
 * ============================================================ */
function extractSpeaker(sentence) {
  const m = sentence.match(/([\u4e00-\u9fa5A-Za-z·、，]{2,40}?)(表示|称|指出|认为|说|强调|呼吁|建议|批评|质疑|回应|介绍|透露|宣布)/);
  if (!m) return "";
  let who = m[1];
  // 取最后一个逗号 / 顿号之后："上海市…专家，曾任上海世博局…的王思政" → 去掉头衔前缀
  const parts = who.split(/[，,]/);
  who = parts[parts.length - 1];
  // 再取最后一个"的"之后："曾任上海世博局副巡视员兼综合计划部部长的王思政" → "王思政"
  if (who.includes("的")) {
    const seg = who.split("的");
    const tail = seg[seg.length - 1];
    if (tail.length >= 2) who = tail;
  }
  who = who.replace(/^(据|而|同时|此外|另外|其中|对此|并)/, "").trim();
  return who.length >= 2 && who.length <= 12 ? who : "";
}

function buildOtherSide(sentences) {
  const items = [];
  const used = new Set();

  // (a) 不同主体的表态 —— 不同声音本身就是"另一面"
  const voiceSents = pickByRe(sentences, VOICE_RE, 3, used);
  voiceSents.forEach(s => {
    const who = extractSpeaker(s);
    items.push({
      text: who ? `另一种声音：${who}的说法` : "另一种声音：原文中不同主体的表态",
      evidence: s,
      tag: "原文",
    });
  });

  // (b) 保留 / 风险表述：先强信号，没有再用转折词兜底（并跳过首句，避免误抓导语）
  let reserves = pickByRe(sentences, RESERVE_STRONG_RE, 2, used);
  if (reserves.length === 0) reserves = pickByRe(sentences.slice(1), RESERVE_WEAK_RE, 1, used);
  reserves.forEach(s => items.push({ text: "自己写到的保留 / 风险表述", evidence: s, tag: "原文" }));

  return { items, note: "" };
}

/* ============================================================
 * ⑥ 接下来会怎么样（趋势预判与机会识别）
 * 只做条件式推演，且每条都必须能指回原文；没有就不显示
 * ============================================================ */
function buildNext(sentences) {
  const items = [];
  const used = new Set();

  // (a) 原文自己写的下一步 / 计划 / 时间表
  const plans = pickByRe(sentences, NEXT_PLAN_RE, 2, used);
  plans.forEach(s => items.push({ text: "原文写明的下一步 / 时间表：若如期推进，则按这个节点走", evidence: s, tag: "推演" }));

  // (b) 阶段性推演（同样必须指回触发它的原句）
  for (const [re, tip] of NEXT_SIGNALS) {
    const s = sentences.find(x => !used.has(x) && re.test(x));
    if (!s) continue;
    used.add(s);
    items.push({ text: tip, evidence: s, tag: "推演" });
    if (items.length >= 5) break;
  }

  // (c) 关键节点：只有原文真的提到 验收/推广/督查… 才提，不写死"三个观察点"
  const nodes = pickByRe(sentences, NODE_RE, 2, used);
  nodes.forEach(s => items.push({ text: "接下来该盯的节点（原文提到的）", evidence: s, tag: "推演" }));

  // (d) 机会识别：只在原文真的谈到产业/岗位/市场时才提示方向
  // 只在**同时**命中 ≥2 个机会词时才提示，避免"精神生活需求"这种单词误报
  const opp = sentences.find(s => !used.has(s)
    && OPPORTUNITY_WORDS.filter(w => s.includes(w)).length >= 2);
  if (opp) {
    const hit = OPPORTUNITY_WORDS.filter(w => opp.includes(w)).slice(0, 3);
    used.add(opp);
    items.push({
      text: `涉及「${hit.join("、")}」：若推进，相关方向与岗位需求可能随之变化——仅为方向提示，不构成建议`,
      evidence: opp,
      tag: "推演",
    });
  }

  return {
    items,
    note: items.length ? "以上都是条件式推演（若…则…），不是对未来的承诺；每条都附了原文触发句。" : "",
  };
}

/* ============================================================
 * ⑦ 专业壁垒的翻译
 * ============================================================ */
function buildPlainWords(sentences) {
  const full = sentences.join(" ");
  const items = [];
  for (const [name, keys, plain] of TERM_GLOSSARY) {
    if (keys.some(k => full.includes(k))) {
      items.push({ text: `${name} → ${plain}`, evidence: "", tag: "术语翻译" });
    }
    if (items.length >= 6) break;
  }
  return { items, note: "" };
}

/* ============================================================
 * ⑧ 我该怎么想（价值判断与认知主权）
 * 先把原文拆成 事实 / 表态 / 未定；再按**这篇里实际出现的**要素追问
 * ============================================================ */
function buildHowToThink(sentences) {
  const items = [];
  const used = new Set();
  const full = sentences.join(" ");

  const facts = pickByRe(sentences, FACT_RE, 2, used);
  facts.forEach(s => items.push({ text: "【已经发生的事实】", evidence: s, tag: "原文" }));

  const stance = pickByRe(sentences, STANCE_RE, 1, used);
  if (stance.length) items.push({ text: "【打算做 / 表态】（还没发生，别当既成事实）", evidence: stance[0], tag: "原文" });

  const pending = pickByRe(sentences, PENDING_RE, 1, used);
  if (pending.length) items.push({ text: "【还没定 / 待验证】（草案、研究中，或只是预测）", evidence: pending[0], tag: "原文" });

  // 针对这篇的具体追问：只用这篇里**真的出现**的要素，不用通用问题
  const asks = [];
  const docM = full.match(/《([^》]{2,30})》/);
  if (docM) asks.push(`原文提到的《${docM[1]}》，配套细则什么时候出、谁负责？`);
  const moneyM = full.match(SCALE_RE);
  if (moneyM) asks.push(`这笔 ${moneyM[0]} 由谁出、最终谁受益？`);
  const dateM = full.match(/到(19|20)\d{2}年/);
  if (dateM) asks.push(`到了 ${dateM[0].replace("到", "")} ，我该怎么验证它兑现没兑现？`);
  const orgM = full.match(ORG_RE);
  if (orgM) asks.push(`落实责任在 ${orgM[0]} 这类部门身上，进度去哪儿查？`);
  asks.slice(0, 3).forEach(a => items.push({ text: a, evidence: "", tag: "思考提示" }));

  return {
    items,
    note: items.length ? "先把原文分成「事实 / 表态 / 未定」三类，再问自己下面几条——判断留给你，代码不下结论。" : "",
  };
}

/**
 * 生成一条新闻的完整解读
 *
 * ⚠️ 铁律二：**没有内容就不显示这个角度**。
 * 这里会把没有任何条目的小节整个丢掉，绝不拿模板凑数。
 *
 * @param {Object} news 新闻对象
 * @returns {Object} { ok, fromFullText, sections: [{key,title,items,note}] }
 */
function buildInterpretation(news) {
  const src = interpretSource(news);
  const sentences = interpretSentences(src.text);
  if (!sentences.length) return { ok: false, fromFullText: src.fromFullText, sections: [] };

  const category = (news && news.category) || "政治";
  const all = [
    { key: "relation", title: "🧭 与你我有关", build: () => buildRelation(sentences) },
    { key: "origin", title: "🕰️ 来龙去脉", build: () => buildOrigin(sentences) },
    { key: "behind", title: "📜 文件背后", build: () => buildBehind(sentences) },
    { key: "impact", title: "⚖️ 影响评估与利益关联", build: () => buildImpact(sentences) },
    { key: "otherside", title: "🔄 另一面是什么", build: () => buildOtherSide(sentences) },
    { key: "next", title: "🔮 接下来会怎么样", build: () => buildNext(sentences) },
    { key: "plain", title: "🔤 专业壁垒的翻译", build: () => buildPlainWords(sentences) },
    { key: "think", title: "🤔 我该怎么想", build: () => buildHowToThink(sentences, category) },
  ];

  const sections = [];
  for (const s of all) {
    let r;
    try {
      r = s.build();
    } catch (e) {
      // ⚠️ 2026-10-31 教训：一开始这里静默吞掉异常，结果我自己写错一行代码
      // （docNames 未定义）导致"文件背后"整节消失，页面上却看不出任何异常。
      // 单个角度出错不能让整个面板挂掉，但**必须打日志**，不能悄悄过去。
      console.warn(`[新闻解读] 角度「${s.title}」生成失败：`, e && e.message);
      r = { items: [] };
    }
    if (r.items && r.items.length > 0) {
      sections.push({ key: s.key, title: s.title, items: r.items, note: r.note || "" });
    }
  }

  return { ok: sections.length > 0, fromFullText: src.fromFullText, sections };
}
