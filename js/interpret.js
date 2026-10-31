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
/* 没有书名号时的兜底：找"制度动作"句（出台了什么、建立了什么机制、印发了什么方案）。
   2026-10-31 新增：原文不点名《…》时，「文件背后」整节会空掉，解读缺一大块。 */
const INSTITUTION_RE = new RegExp(
  "(出台|印发|发布|制定|编制|批准|通过|建立|健全|完善|形成|推出)([^。；]{0,12}?)"
  + "(规划|方案|意见|办法|规定|条例|制度|机制|体系|标准|细则|清单|政策|措施)");

/* 结构性信号 → 通用判断（**必须能指回触发它的原句**，否则不输出） */
const STRUCT_SIGNALS = [
  [/首次|第一次|首型|首个|首艘|首台|首例/, "「首次 / 首个」：通常意味着从 0 到 1 的突破，后续看点在于能否规模化、常态化。"],
  [/试点|示范|先行|试验区/, "「试点 / 示范」：先在局部验证，效果好才可能推广——现在影响面还有限。"],
  [/征求意见|草案|审议|待批|拟/, "「征求意见 / 草案」：尚未定稿，内容和时间都可能改，别当既成事实。"],
  // ⚠️ 2026-10-31 修：下面这三条原来用了太泛的词，实测把"目标设置是怎么样的？"（一句问句）
  // 判成"给了时间表"、"大规模生产的要求"判成"部署推进"、"标准操作流程"判成"监管规范"
  // ——判断本身与原文不符，比没有更糟。一律收紧成有辨识度的搭配。
  // ⚠️ 别再加"期限"这种词：实测"综合考虑交货期限、设备负荷…"被判成"给了时间表"
  [/到(19|20)\d{2}年|力争|目标值|时间表/, "给了明确时间表 / 目标值：这类承诺可以事后对照检查。"],
  [/部署|印发|推进|启动|开工|出台|下发/, "处在「部署 / 推进」阶段：真正的看点是细则、资金和督查。"],
  [/基金|专项资金|补贴|财政|拨款/, "涉及真金白银：资金规模与来源决定它能推多快、铺多广。"],
  [/监管|整治|查处|处罚|规范/, "带监管 / 规范性质：会改变行业合规成本，进而影响价格和从业者。"],
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
/* ⚠️ 2026-10-31 修：上面这个正则会把"为产业**布局**""这种**格局**""某**部门**"
   "物流网建设**部署**"当成机构名（实测输出过"谁来办：为产业布局"这种笑话）。
   命中这些词的一律不算机构——它们不是某个具体单位。 */
const ORG_FALSE_RE = /(布局|格局|全局|结局|局部|部门|总部|内部|外部|全部|大局|局面|时区|部署|公署)/;
/* 机构名前面常带的介词，匹配到后要剥掉（"据中央纪委国家监委" → "中央纪委国家监委"） */
const ORG_PREFIX_RE = /^(据|从|由|与|和|对|在|经|向|被|给)/;
/* 原文直接点名的人群——民生维度没命中时，用它补足"这条跟谁有关" */
const PEOPLE_WORDS = ["居民", "市民", "群众", "农民", "学生", "老人", "职工", "消费者", "患者",
  "青年", "儿童", "女性", "残疾人", "农民工", "毕业生", "家庭", "百姓", "民众"];

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
  // 同上：裸的"目标/要求"会把问句和无关句子也判成信号，收紧
  [/到(19|20)\d{2}年|力争|目标值|时间表/, "给了时间表：可以对照 deadline 检查进度，到点没兑现本身就是信号。"],
  [/部署|印发|推进|启动|开工|筹建|出台/, "处在「部署/启动」：推演是 文件 → 细则 → 资金/责任到人 → 落地。"],
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
// 电头（"中新网银川10月31日电(记者 于晶)…"）是稿件元数据、不是新闻内容。
// 它常同时含"将/要/记者"等字，被当成"表态 / 未定 / 事实"会输出莫名其妙的条目。
// 做事实判断时一律跳过；时间线（起点）仍可用它取日期。
const DATELINE_RE = /\d{1,2}月\d{1,2}日电|电\s*[（(]\s*记者/;

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

/* ---------- 把解析写得"有内容"的三个小工具（2026-10-31 新增）----------
 * 上一版被批评"只有依据、不见解析内容"：每条只给一个标签（如"关乎「通信/网络」"）
 * 加一整句原文，读者看不到**解析本身**。
 * 有了下面这几个工具，解析句里就能带上从原文抠出来的具体片段
 * （谁、多少钱、什么时间、哪个文件），而不是空标签。 */

/**
 * 抠出"关键词前后"的一小段，让解析句带上具体内容。
 *
 * ⚠️ 2026-10-31 修：以前是按字数硬切，切出来常常是"…机制，提前为包银高铁…"
 * 这种**拦腰截断**的半截话，用户看着就是"内容不完整"。
 * 现在切完再往两头**扩到最近的停顿标点**，保证给出的是完整分句；
 * 只有真的被截了才加省略号。
 */
function phraseAround(sentence, word, before = 14, after = 34) {
  const s = String(sentence || "");
  if (!s) return "";
  const i = s.indexOf(word);
  if (i < 0) return coreOf(s, 46);

  let start = Math.max(0, i - before);
  let end = Math.min(s.length, i + String(word).length + after);

  // 往左扩：找到关键词之前最近的停顿标点，从它后面开始（别把词切一半）。
  // 但切完只剩两三个字就不切了——"提前为包银高铁"这种半截读不出意思（2026-10-31 二修）
  const head = s.slice(0, i);
  const p = Math.max(head.lastIndexOf("，"), head.lastIndexOf("、"), head.lastIndexOf("；"),
                     head.lastIndexOf("："), head.lastIndexOf("("), head.lastIndexOf("（"));
  if (p >= 0 && p >= start - 10 && (i - p - 1) >= 6) start = p + 1;

  // 往右扩：找到关键词之后最近的停顿标点，到它为止。
  // 同样要求至少再往下读 10 个字，否则宁可不按标点切，保证片段有足够信息量
  const tail = s.slice(i + String(word).length);
  const q = tail.search(/[，。；、）)]/);
  if (q >= 0) {
    const cand = i + String(word).length + q;
    if (q >= 10 && cand <= end + 10) end = cand;
  }

  return (start > 0 ? "…" : "") + s.slice(start, end) + (end < s.length ? "…" : "");
}

/** 取句子的核心片段（尽量在标点处收尾，别截在半截词上） */
function coreOf(sentence, maxLen = 46) {
  const s = String(sentence || "").trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const last = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf("；"));
  return (last > maxLen * 0.5 ? cut.slice(0, last) : cut) + "…";
}

/**
 * 这个词是不是**长在机构名里**？
 * 实测："中国移动通信集团浙江有限公司…"里的"通信"被当成了"关乎通信/网络"——
 * 其实那只是公司名字。命中词前後出现公司/集团这类后缀时，不算民生话题。
 */
function wordInsideOrg(sentence, word) {
  const i = String(sentence).indexOf(word);
  if (i < 0) return false;
  const win = String(sentence).slice(Math.max(0, i - 10), Math.min(String(sentence).length, i + String(word).length + 10));
  return /(公司|集团|有限公司|分公司|工厂|厂区)/.test(win);
}

/** 抽取"某某表示 / 指出"之后说了什么（让"另一种声音"有内容） */
function quoteAfterVerb(sentence) {
  const m = String(sentence || "").match(/(表示|称|指出|认为|说|强调|呼吁|建议|批评|质疑|回应|介绍|透露|宣布)([^。！？]{0,60})/);
  if (!m) return "";
  const q = m[2].replace(/^[,，:：、]?\s*/, "").replace(/^["""']+/, "").trim();
  return q.length > 4 ? q.slice(0, 56) : "";
}

/* ============================================================
 * ① 与你我有关
 * ============================================================ */
function buildRelation(sentences) {
  const items = [];
  const used = new Set();
  for (const [dim, words] of LIFE_DIMENSIONS) {
    const hit = pickBestSentence(sentences, words, used);
    if (!hit) continue;
    // 找出到底命中了哪个词，把它的上下文抠出来写进解析句——
    // 只写"关乎「X」"等于没解析（2026-10-31 用户批评后修）
    const word = words.find(w => hit.includes(w)) || "";
    // 命中的只是机构名的一部分（如"中国移动通信集团…"里的"通信"）→ 不算
    if (wordInsideOrg(hit, word)) continue;
    const frag = phraseAround(hit, word, 8, 28);
    items.push({
      text: `关乎「${dim}」：原文写到「${frag}」——也就是说，这条新闻跟你在这方面的日常是直接挂钩的。`,
      evidence: hit,
      tag: "原文",
    });
    if (items.length >= 4) break;
  }

  // 民生维度一个都没命中时，再看原文有没有**直接点名人群**
  // （"居民 / 学生 / 消费者…"）——有就列出来，别让这一节空着
  if (items.length === 0) {
    const ps = sentences.find(s => PEOPLE_WORDS.some(w => s.includes(w)));
    if (ps) {
      const w = PEOPLE_WORDS.find(x => ps.includes(x));
      items.push({
        text: `直接点名了「${w}」：${phraseAround(ps, w, 8, 28)}——这件事说的就是这批人。`,
        evidence: ps,
        tag: "原文",
      });
    }
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
  if (causes.length) {
    const cw = (causes[0].match(CAUSE_HINT_RE) || [""])[0];
    items.push({
      text: `缘起：这件事的起因是「${phraseAround(causes[0], cw, 2, 30)}」。`,
      evidence: causes[0],
      tag: "原文",
    });
  }

  // 2026-10-31 改：上限 4 → 6。原先只取 4 条，长新闻的脉络被砍掉一半，
  // 用户看到的就是"不完整的来龙去脉"。
  const timeline = pickByRe(sentences, TIME_HINT_RE, 6, used);
  timeline.forEach((s, i) => {
    // 标出这一步在整条链里的位置：第一条是起点，最后一条是最新进展
    const pos = i === 0 ? "起点" : (i === timeline.length - 1 ? "最新进展" : "中间一步");
    items.push({
      text: `${pos}（${dateLabelOf(s)}）：${coreOf(s, 52)}`,
      evidence: s,
      tag: "原文",
    });
  });

  // 时间线索不足 2 条（很多新闻全文只有一两个时间点）→ 补"这件事本身是什么"，
  // 否则这一节只剩孤零零一条，看起来就像没做完（2026-10-31 修）
  if (timeline.length < 2) {
    const main = sentences.filter(s => !used.has(s)).slice(0, 2);
    main.forEach((s, i) => {
      used.add(s);
      items.push({
        text: i === 0 ? `事情本身：${coreOf(s, 54)}` : `补充背景：${coreOf(s, 54)}`,
        evidence: s,
        tag: "原文",
      });
    });
  }

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
    const base = goal || withName;
    items.push({
      text: goal
        ? `点名文件《${nm}》，它定的要求是：${coreOf(goal, 56)}`
        : `点名文件《${nm}》，但原文只提到名称，没展开具体要求：${coreOf(withName, 56)}`,
      evidence: base,
      tag: "原文",
    });
  }

  // 原文没点名任何《…》文件时，不要就把这一节空掉：
  // 很多新闻谈的是制度/方案/机制但没写书名号，抽这些句子同样"有用且可核查"
  // （2026-10-31 修：此前无书名号 → 整节消失，用户看到的就是解读缺一大块）
  if (items.length === 0) {
    const inst = pickByRe(sentences, INSTITUTION_RE, 3, used);
    inst.forEach(s => {
      const im = s.match(INSTITUTION_RE);
      items.push({
        text: `没有点名具体文件，但写到了这类制度动作：「${phraseAround(s, im ? im[0] : "", 6, 30)}」`,
        evidence: s,
        tag: "原文",
      });
    });
  }

  // 结构性信号：必须能指回触发它的原句，否则就是空模板，不输出
  for (const [re, tip] of STRUCT_SIGNALS) {
    const s = sentences.find(x => !used.has(x) && re.test(x));
    if (!s) continue;
    used.add(s);
    const m = s.match(re);
    items.push({
      // 把触发这句的**具体表述**写进解析，别只给一句通用说明
      text: `${tip} 触发这句的是「${phraseAround(s, m ? m[0] : "", 5, 20)}」。`,
      evidence: s,
      tag: "通用判断",
    });
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
  if (benefit) {
    const w = BENEFIT_WORDS.find(x => benefit.includes(x)) || "";
    items.push({
      text: `谁受益：${phraseAround(benefit, w, 8, 30)}——这是原文点到的受益 / 被扶持一方。`,
      evidence: benefit,
      tag: "原文",
    });
  }

  // ⚠️ "降低企业数智化转型成本"里的"成本"是**受益**，不是承担——
  // 句子里出现"降低/减少/减轻"时，这条不该算进"谁承担"（2026-10-31 修）
  const cost = pickBestSentence(
    sentences.filter(s => !/(降低|较低|减少|减轻|下降|压降)/.test(s)), COST_WORDS, used);
  if (cost) {
    const w = COST_WORDS.find(x => cost.includes(x)) || "";
    items.push({
      text: `谁承担：${phraseAround(cost, w, 8, 30)}——这是原文点到的要出钱 / 受约束的一方。`,
      evidence: cost,
      tag: "原文",
    });
  }

  // 涉及机构 / 责任主体：回答"这件事是谁在办"
  // 机构名要排除两类误命中：
  // ① "布局/格局/部门…"这类词（见 ORG_FALSE_RE 的注释）
  // ② 图片署名句——"中卫市委宣传部供图"里的机构只是图片来源，不是责任主体（2026-10-31 修）
  const orgSent = sentences.find(s => !used.has(s) && ORG_RE.test(s)
    && !ORG_FALSE_RE.test((s.match(ORG_RE) || [""])[0])
    && !/供图|图片来源|（图/.test(s));
  if (orgSent) {
    const om = orgSent.match(ORG_RE);
    // 剥掉"据 / 由 / 从…"这类前缀，否则会输出"据中央纪委国家监委"这种怪名字
    const orgName = om ? om[0].replace(ORG_PREFIX_RE, "") : "（原文提到的机构）";
    used.add(orgSent);
    items.push({
      text: `谁来办：${orgName}——推进责任落在这个主体身上（${coreOf(orgSent, 54)}）。`,
      evidence: orgSent,
      tag: "原文",
    });
  }

  // 规模量级：只取原文真的写了的数字
  // 企业营收 / 销售额这类数字不代表"这件事的规模"，排除掉（2026-10-31 修）
  const scaleSents = sentences
    .filter(s => !used.has(s) && SCALE_RE.test(s) && !/(营业收入|营收|销售额|市值|净利润)/.test(s))
    .slice(0, 2);
  scaleSents.forEach(s => {
    used.add(s);
    const sm = s.match(SCALE_RE);
    items.push({
      text: `规模量级 ${sm ? sm[0] : "（原文数字）"}：${phraseAround(s, sm ? sm[0] : "", 10, 26)}`
        + `——数字越大，牵扯的钱和人也越多，越值得盯后续。`,
      evidence: s,
      tag: "原文",
    });
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
  // 抽出来的是"国家级专项规划""这份报告"这类**文件/事物**而不是人或单位 → 当作没抽到
  // （2026-10-31 修：实测出现过"国家级专项规划的说法"，把文件当成了发言者）
  if (/(规划|纲要|方案|报告|文件|通知|意见|办法|条例)$/.test(who)) return "";
  // 还不短的话，按职务词切："…总经理吴建军" → "吴建军"（2026-10-31 修：
  // 以前只按"的"切，"阿里巴巴千问AI硬件产品总经理吴建军"这种长头衔取不到名字，
  // 整串超长就被丢弃，说话人只能显示成"原文中的一方"）
  if (who.length > 8) {
    const pm = who.match(/(总经理|总监|负责人|局长|部长|主任|教授|董事长|书记|经理|工程师|专家|会长|院士|总裁|主管|老师)([\u4e00-\u9fa5A-Za-z·]{2,8})$/);
    if (pm) who = pm[2];
  }
  return who.length >= 2 && who.length <= 16 ? who : "";
}

function buildOtherSide(sentences) {
  const items = [];
  const used = new Set();

  // (a) 不同主体的表态 —— 不同声音本身就是"另一面"
  const voiceSents = pickByRe(sentences, VOICE_RE, 3, used);
  voiceSents.forEach(s => {
    const who = extractSpeaker(s);
    const said = quoteAfterVerb(s);
    // 只写了个"某某说。"而没说内容的（常见于分段引语的前半句）→ 不输出，
    // 否则条目内容就是一句身份介绍，等于没有解析（2026-10-31 修）
    if (said.length < 10) return;
    items.push({
      // 把"他到底说了什么"写出来，而不是只标一个名字。
      // ⚠️ 文案不要以"原文"开头：渲染时「原文」标签就排在前面，会读成"原文原文…"
      text: said
        ? `${who || "文中的一方"}的说法：${said}`
        : `${who || "文中的一方"}的说法：${coreOf(s, 52)}`,
      evidence: s,
      tag: "原文",
    });
  });

  // (b) 保留 / 风险表述：先强信号，没有再用转折词兜底（并跳过首句，避免误抓导语）
  let reserves = pickByRe(sentences, RESERVE_STRONG_RE, 2, used);
  if (reserves.length === 0) reserves = pickByRe(sentences.slice(1), RESERVE_WEAK_RE, 1, used);
  reserves.forEach(s => {
    const m = s.match(RESERVE_STRONG_RE) || s.match(RESERVE_WEAK_RE);
    items.push({
      text: `自己也留了余地：「${phraseAround(s, m ? m[0] : "", 6, 30)}」——这是它承认的难点 / 不确定性。`,
      evidence: s,
      tag: "原文",
    });
  });

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
  // 2026-10-31 改：2 → 3。原先只取 2 条，长新闻的"下一步"被截断
  const plans = pickByRe(sentences, NEXT_PLAN_RE, 3, used);
  plans.forEach(s => {
    const m = s.match(NEXT_PLAN_RE);
    items.push({
      text: `按原文写的，下一步是「${phraseAround(s, m ? m[0] : "", 6, 30)}」——若如期推进，事情会按这个节点往下走。`,
      evidence: s,
      tag: "推演",
    });
  });

  // (b) 阶段性推演（同样必须指回触发它的原句）
  for (const [re, tip] of NEXT_SIGNALS) {
    const s = sentences.find(x => !used.has(x) && re.test(x));
    if (!s) continue;
    used.add(s);
    const m = s.match(re);
    items.push({
      text: `${tip} 依据是这句里的「${phraseAround(s, m ? m[0] : "", 5, 22)}」。`,
      evidence: s,
      tag: "推演",
    });
    if (items.length >= 5) break;
  }

  // (c) 关键节点：只有原文真的提到 验收/推广/督查… 才提，不写死"三个观察点"
  const nodes = pickByRe(sentences, NODE_RE, 3, used);
  nodes.forEach(s => {
    const m = s.match(NODE_RE);
    items.push({
      text: `接下来可以盯住「${phraseAround(s, m ? m[0] : "", 6, 26)}」——这是原文给出的可验证节点。`,
      evidence: s,
      tag: "推演",
    });
  });

  // (d) 机会识别：只在原文真的谈到产业/岗位/市场时才提示方向
  // 只在**同时**命中 ≥2 个机会词时才提示，避免"精神生活需求"这种单词误报
  const opp = sentences.find(s => !used.has(s)
    && OPPORTUNITY_WORDS.filter(w => s.includes(w)).length >= 2);
  if (opp) {
    const hit = OPPORTUNITY_WORDS.filter(w => opp.includes(w)).slice(0, 3);
    used.add(opp);
    items.push({
      text: `这件事连着「${hit.join("、")}」：${phraseAround(opp, hit[0], 6, 26)}`
        + `——若推进，相关方向的人才和需求可能跟着动，但这是方向提示，不构成任何建议。`,
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

  // 跳过电头句：那是稿件元数据，不是新闻内容（见 DATELINE_RE 注释）
  const cands = sentences.filter(s => !DATELINE_RE.test(s));
  const pool = cands.length ? cands : sentences;

  const facts = pickByRe(pool, FACT_RE, 3, used);
  facts.forEach(s => items.push({
    text: `已经发生的事实：${coreOf(s, 54)}`,
    evidence: s,
    tag: "原文",
  }));

  const stance = pickByRe(pool, STANCE_RE, 1, used);
  if (stance.length) items.push({
    text: `打算做 / 表态（还没发生，别当既成事实）：${coreOf(stance[0], 54)}`,
    evidence: stance[0],
    tag: "原文",
  });

  const pending = pickByRe(pool, PENDING_RE, 1, used);
  if (pending.length) items.push({
    text: `还没定 / 待验证（草案、研究中，或只是预测）：${coreOf(pending[0], 54)}`,
    evidence: pending[0],
    tag: "原文",
  });

  /* ---------- 参考见解 ----------
   * 2026-10-31 用户要求："我该怎么想"不能只给思考提示，要给**参考的见解**。
   * 所以下面是基于**这篇里真实出现的要素**给出的判断，全部标为「参考见解」：
   * 它是一家之言、不是事实，也不是唯一答案，但不再是空问题。 */
  const views = [];
  const docM = full.match(/《([^》]{2,30})》/);
  const moneyM = full.match(SCALE_RE);
  const dateM = full.match(/到(19|20)\d{2}年/);
  const orgM = (full.match(ORG_RE) && !ORG_FALSE_RE.test(full.match(ORG_RE)[0])) ? full.match(ORG_RE) : null;

  if (dateM) {
    views.push(`我的看法：这篇给了 ${dateM[0].replace("到", "")} 这个时间点，这是很值钱的信息——`
      + `承诺只要有明确日期，事后就能对照兑现与否。建议把这个日期记下来，到时回来看一眼。`);
  }
  if (moneyM) {
    views.push(`我的看法：涉及 ${moneyM[0]} 的钱。判断一件事是"真干"还是"表态"，`
      + `最硬的指标就是钱到没到位、谁出——比任何措辞都可靠。`);
  }
  if (docM) {
    views.push(`我的看法：真正的看点是《${docM[1]}》的配套细则。`
      + `文件本身通常只定方向，细则才写清谁出钱、谁执行、什么时候完成；细则不出，影响就落不了地。`);
  }
  if (orgM) {
    const orgName = orgM[0].replace(ORG_PREFIX_RE, "");
    views.push(`我的看法：责任主体指向 ${orgName} 这类部门。想知道进度，`
      + `最直接的办法是盯它的官网/通报，而不是等二手转述。`);
  }
  if (facts.length && stance.length) {
    views.push(`我的看法：这条里「已经发生的」和「打算做的」是两回事——`
      + `已发生部分是硬的、可以核实；「打算做」的部分还要看细则和资金，建议分开看待，别混在一起下结论。`);
  } else if (!facts.length && stance.length) {
    views.push(`我的看法：通篇以"打算做 / 要推动"为主，目前没有既成事实可以核实。`
      + `这种消息先当"方向"看比较稳妥，等细则或资金中的任意一样落实了再认真对待。`);
  }
  if (pending.length) {
    views.push(`我的看法：里面有"研究中 / 有望 / 预测"这类表述，属于还没定的部分。`
      + `这类内容经常被当成既成事实转述，看到时记得打问号。`);
  }
  if (views.length === 0) {
    // 一个具体要素都没识别出来：如实说"可核实的抓手很少"，不给空泛建议
    views.push(`我的看法：这篇里既没有时间表、金额、文件，也没有明确责任部门——`
      + `能被事后验证的抓手很少，建议以原文链接为准，别只信转述。`);
  }
  views.slice(0, 4).forEach(v => items.push({ text: v, evidence: "", tag: "参考见解" }));

  // 针对这篇的具体追问：只用**真的出现**的要素，不用放之四海皆准的问题
  const asks = [];
  if (docM) asks.push(`《${docM[1]}》的配套细则什么时候出、谁负责？`);
  if (moneyM) asks.push(`这笔 ${moneyM[0]} 由谁出、最终谁受益？`);
  if (dateM) asks.push(`到了 ${dateM[0].replace("到", "")} ，我该怎么验证它兑现没兑现？`);
  if (orgM) asks.push(`${orgM[0].replace(ORG_PREFIX_RE, "")} 这类部门的进度，我该去哪儿查？`);
  asks.slice(0, 2).forEach(a => items.push({ text: a, evidence: "", tag: "思考提示" }));

  return {
    items,
    note: items.length
      ? "先把原文分成「事实 / 表态 / 未定」三类；下面标「参考见解」的是我基于这篇给出的判断，"
        + "是一家之言、不是事实也不是唯一答案，你可以不同意。最后两三条留给你自己回答。"
      : "",
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
