/**
 * ============================================================
 * fallbackImage.js —— 纯前端兜底配图（**不依赖任何后端**）
 * ============================================================
 * 为什么要有这个模块（2026-10-26 修复）：
 *   原来"每条新闻必须有图"这条硬要求，是建立在"一定有后端"上的——
 *   三级配图（原图 /api/image、意象图 /api/stock-image、代码生成 /api/code-image）
 *   **全都要走服务端接口**。一旦把站点部署到静态托管（GitHub Pages 等），
 *   这些接口都不存在，四条兜底路全断，页面只剩分类渐变底——
 *   等于"配图不可空缺"这条硬要求在线上直接失效。
 *
 *   所以这里用**纯前端代码**画一张 SVG（data URI）作为最后一级兜底：
 *     - 不发任何网络请求，静态托管、file:// 直开、后端崩溃都能用；
 *     - 同一条新闻每次生成结果完全一致（按 id + 标题做种子）；
 *     - 画面遵守配图标准：无文字 / 水印 / Logo / 边框，主体居中留白；
 *     - 关键词命中时画**现实物品**（芯片 / 硬盘 / 服务器 / 电脑），
 *       与 tools/news_image_factory.py 的实物母题保持一致。
 *
 * 它不是"更好看的图"，而是**保证页面永远不出现空位**的最后一道闸。
 */

/** 兜底图配置 */
const FALLBACK_IMAGE = {
  enabled: true,
  size: 1200,                 // 与配图标准一致：1200×1200 方形
  margin: 0.16,               // 主体留白比例（四周各留 16%，裁切切不到主体）
  // 配色与分类渐变底一致（见 css/style.css 的 data-category 渐变）
  palette: {
    "政治": ["#f87171", "#b91c1c"],
    "科技": ["#60a5fa", "#1d4ed8"],
    "财经": ["#fbbf24", "#b45309"],
    "生活": ["#f472b6", "#be185d"],
  },
  fallbackPalette: ["#94a3b8", "#334155"],
};

/** 32 位字符串哈希（FNV-1a）：本文件要能独立工作，不依赖 aiImage.js 的函数 */
function fallbackHash(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * mulberry32：给同一个种子永远得到同一串"随机数"
 * ——同一条新闻每次生成的图一模一样，不会一刷新就变。
 */
function fallbackRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
   母题：每个函数返回一段 SVG（画在 box 这个安全区内）
   ============================================================ */

/** 芯片实物：封装方块 + 四周引脚 + 表面分区 */
function fbMotifChip(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const size = Math.min(w, h) * 0.78;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const half = size / 2;
  let s = `<rect x="${(cx - half).toFixed(0)}" y="${(cy - half).toFixed(0)}" `
    + `width="${size.toFixed(0)}" height="${size.toFixed(0)}" rx="${(size * 0.08).toFixed(0)}" `
    + `fill="none" stroke="${accent}" stroke-width="7" opacity="0.95"/>`;
  const inner = size * 0.6;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const bx = cx - inner / 2 + (inner / 2) * c + inner * 0.05;
      const by = cy - inner / 2 + (inner / 2) * r + inner * 0.05;
      const bs = inner / 2 - inner * 0.1;
      s += `<rect x="${bx.toFixed(0)}" y="${by.toFixed(0)}" width="${bs.toFixed(0)}" `
        + `height="${bs.toFixed(0)}" rx="${(bs * 0.12).toFixed(0)}" fill="${accent}" `
        + `opacity="${rng().toFixed(2)}"/>`;
    }
  }
  const n = 6, step = size / (n + 1), pin = size * 0.12;
  for (let i = 0; i < n; i++) {
    const off = -half + step * (i + 1);
    s += `<path d="M${(cx + off).toFixed(0)} ${(cy - half).toFixed(0)} v${(-pin).toFixed(0)}" `
      + `stroke="${accent}" stroke-width="5" opacity="0.8"/>`;
    s += `<path d="M${(cx + off).toFixed(0)} ${(cy + half).toFixed(0)} v${pin.toFixed(0)}" `
      + `stroke="${accent}" stroke-width="5" opacity="0.8"/>`;
    s += `<path d="M${(cx - half).toFixed(0)} ${(cy + off).toFixed(0)} h${(-pin).toFixed(0)}" `
      + `stroke="${accent}" stroke-width="5" opacity="0.8"/>`;
    s += `<path d="M${(cx + half).toFixed(0)} ${(cy + off).toFixed(0)} h${pin.toFixed(0)}" `
      + `stroke="${accent}" stroke-width="5" opacity="0.8"/>`;
  }
  return s;
}

/** 硬盘实物：盘体 + 盘片同心圆 + 磁头臂 + 指示灯 */
function fbMotifDisk(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const bw = w, bh = w * 0.66;
  const by = y0 + (h - bh) / 2;
  let s = `<rect x="${x0.toFixed(0)}" y="${by.toFixed(0)}" width="${bw.toFixed(0)}" `
    + `height="${bh.toFixed(0)}" rx="${(bh * 0.1).toFixed(0)}" fill="none" stroke="${accent}" `
    + `stroke-width="7" opacity="0.95"/>`;
  const cx = x0 + bw * 0.5, cy = by + bh * 0.5, r = bh * 0.36;
  s += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="none" `
    + `stroke="${accent}" stroke-width="5" opacity="0.85"/>`;
  s += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(r * 0.44).toFixed(0)}" `
    + `fill="${accent}" opacity="${(0.2 + rng() * 0.25).toFixed(2)}"/>`;
  s += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(r * 0.14).toFixed(0)}" `
    + `fill="none" stroke="${accent}" stroke-width="4" opacity="0.8"/>`;
  const ax = x0 + bw * 0.92, ay = by + bh * 0.84;
  s += `<path d="M${ax.toFixed(0)} ${ay.toFixed(0)} L${(cx + r * 0.6).toFixed(0)} `
    + `${(cy + r * 0.4).toFixed(0)}" stroke="${accent}" stroke-width="6" opacity="0.9"/>`;
  s += `<circle cx="${(x0 + bw * 0.07).toFixed(0)}" cy="${(by + bh * 0.87).toFixed(0)}" `
    + `r="${(bh * 0.05).toFixed(0)}" fill="${accent}" opacity="${(0.5 + rng() * 0.45).toFixed(2)}"/>`;
  return s;
}

/** 服务器机柜：竖排机架单元 + 硬盘位 + 指示灯 */
function fbMotifServer(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const cw = w * 0.74;
  const bx = x0 + (w - cw) / 2;
  const units = 5;
  const uh = h / (units + 0.6);
  let s = "";
  for (let i = 0; i < units; i++) {
    const uy = y0 + uh * (i + 0.3);
    s += `<rect x="${bx.toFixed(0)}" y="${uy.toFixed(0)}" width="${cw.toFixed(0)}" `
      + `height="${(uh * 0.76).toFixed(0)}" rx="${(uh * 0.1).toFixed(0)}" fill="none" `
      + `stroke="${accent}" stroke-width="5" opacity="${(0.6 + rng() * 0.35).toFixed(2)}"/>`;
    const slots = 3;
    const sw = cw * 0.16;
    for (let k = 0; k < slots; k++) {
      const sx = bx + cw * 0.09 + (cw * 0.82 / slots) * k;
      s += `<rect x="${sx.toFixed(0)}" y="${(uy + uh * 0.18).toFixed(0)}" width="${sw.toFixed(0)}" `
        + `height="${(uh * 0.4).toFixed(0)}" rx="${(sw * 0.14).toFixed(0)}" fill="${accent}" `
        + `opacity="${(0.2 + rng() * 0.35).toFixed(2)}"/>`;
    }
    s += `<circle cx="${(bx + cw * 0.94).toFixed(0)}" cy="${(uy + uh * 0.38).toFixed(0)}" `
      + `r="${(uh * 0.07).toFixed(0)}" fill="${accent}" opacity="${(0.55 + rng() * 0.4).toFixed(2)}"/>`;
  }
  return s;
}

/** 笔记本电脑：屏幕 + 屏幕里的界面元素 + 键盘底座 */
function fbMotifLaptop(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const sh = h * 0.6;
  let s = `<rect x="${x0.toFixed(0)}" y="${y0.toFixed(0)}" width="${w.toFixed(0)}" `
    + `height="${sh.toFixed(0)}" rx="${(w * 0.035).toFixed(0)}" fill="none" stroke="${accent}" `
    + `stroke-width="7" opacity="0.95"/>`;
  const pad = w * 0.09;
  const ix = x0 + pad, iy = y0 + pad, iw = w - pad * 2, ih = sh - pad * 2;
  s += `<rect x="${ix.toFixed(0)}" y="${iy.toFixed(0)}" width="${(iw * 0.44).toFixed(0)}" `
    + `height="${(ih * 0.15).toFixed(0)}" rx="${(ih * 0.05).toFixed(0)}" fill="${accent}" `
    + `opacity="${(0.55 + rng() * 0.35).toFixed(2)}"/>`;
  for (let r = 0; r < 3; r++) {
    s += `<rect x="${ix.toFixed(0)}" y="${(iy + ih * (0.28 + 0.12 * r)).toFixed(0)}" `
      + `width="${(iw * (0.5 + rng() * 0.3)).toFixed(0)}" height="${(ih * 0.06).toFixed(0)}" `
      + `rx="${(ih * 0.03).toFixed(0)}" fill="${accent}" opacity="${(0.22 + rng() * 0.28).toFixed(2)}"/>`;
  }
  const bh0 = ih * 0.3;
  for (let b = 0; b < 4; b++) {
    const bw = iw * 0.11;
    const bx = ix + iw * 0.6 + b * (iw * 0.095);
    const bh = bh0 * (0.4 + rng() * 0.6);
    s += `<rect x="${bx.toFixed(0)}" y="${(iy + ih * 0.92 - bh).toFixed(0)}" width="${bw.toFixed(0)}" `
      + `height="${bh.toFixed(0)}" rx="${(bw * 0.2).toFixed(0)}" fill="${accent}" `
      + `opacity="${(0.3 + rng() * 0.4).toFixed(2)}"/>`;
  }
  const baseTop = y0 + sh + h * 0.06;
  const baseH = h * 0.15;
  const inset = w * 0.06;
  s += `<path d="M${(x0 + inset).toFixed(0)} ${baseTop.toFixed(0)} H${(x0 + w - inset).toFixed(0)} `
    + `L${(x0 + w - inset * 0.25).toFixed(0)} ${(baseTop + baseH).toFixed(0)} `
    + `H${(x0 + inset * 0.25).toFixed(0)} Z" fill="none" stroke="${accent}" `
    + `stroke-width="6" opacity="0.9"/>`;
  return s;
}

/** 柱状图（财经） */
function fbMotifBars(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const n = 5, gap = w * 0.04, bw = (w - gap * (n - 1)) / n;
  let s = "";
  for (let i = 0; i < n; i++) {
    const bh = h * (0.3 + rng() * 0.68);
    const bx = x0 + i * (bw + gap);
    s += `<rect x="${bx.toFixed(0)}" y="${(y0 + h - bh).toFixed(0)}" width="${bw.toFixed(0)}" `
      + `height="${bh.toFixed(0)}" rx="${(bw * 0.18).toFixed(0)}" fill="${accent}" `
      + `opacity="${(0.35 + rng() * 0.45).toFixed(2)}"/>`;
  }
  return s;
}

/** 波纹（生活 / 气象 / 医疗） */
function fbMotifWave(rng, accent, box) {
  const { x0, y0, w, h } = box;
  let s = "";
  for (let k = 0; k < 3; k++) {
    const baseY = y0 + h * (0.34 + k * 0.17);
    const amp = h * (0.08 + rng() * 0.06);
    const d = `M${x0.toFixed(0)} ${baseY.toFixed(0)} `
      + `C${(x0 + w * 0.28).toFixed(0)} ${(baseY - amp).toFixed(0)} `
      + `${(x0 + w * 0.62).toFixed(0)} ${(baseY + amp).toFixed(0)} `
      + `${(x0 + w).toFixed(0)} ${baseY.toFixed(0)}`;
    s += `<path d="${d}" fill="none" stroke="${accent}" stroke-width="${(6 + k).toFixed(0)}" `
      + `opacity="${(0.45 + rng() * 0.4).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return s;
}

/** 轨道（航天 / 卫星） */
function fbMotifOrbit(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  const r = Math.min(w, h) * 0.26;
  let s = `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" `
    + `fill="${accent}" opacity="${(0.4 + rng() * 0.3).toFixed(2)}"/>`;
  for (let k = 0; k < 2; k++) {
    const rx = Math.min(w, h) * (0.44 + k * 0.08);
    const ry = rx * (0.38 + rng() * 0.12);
    s += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" `
      + `ry="${ry.toFixed(0)}" fill="none" stroke="${accent}" stroke-width="5" `
      + `opacity="${(0.5 + rng() * 0.35).toFixed(2)}" `
      + `transform="rotate(${(k * 42 - 21).toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
  }
  s += `<circle cx="${(cx + r * 1.5).toFixed(0)}" cy="${(cy - r * 0.7).toFixed(0)}" `
    + `r="${(r * 0.16).toFixed(0)}" fill="${accent}" opacity="${(0.6 + rng() * 0.35).toFixed(2)}"/>`;
  return s;
}

/**
 * 节点网络（通用科技）
 * 2026-10-27 加密：原来是 6 个**纯随机**点、连线还要掷骰子跳过 45%，
 * 实际只画出 3~4 个点和零星几条线，看着像"几个散落的点"。
 * 现在改成：3×4 抖动网格布点（12 个，分布均匀不结块）
 * + 每个点连到最近的 2 个邻居（保证一定成网）
 * + 近距离的点再按概率补边 → 密度明显提高。
 */
function fbMotifNodes(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const cols = 3, rows = 4;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rng() - 0.5) * (w / cols) * 0.45;
      const jy = (rng() - 0.5) * (h / rows) * 0.45;
      pts.push([x0 + (w / cols) * (c + 0.5) + jx, y0 + (h / rows) * (r + 0.5) + jy]);
    }
  }
  const n = pts.length;
  const dist2 = (i, j) => (pts[i][0] - pts[j][0]) * (pts[i][0] - pts[j][0])
                        + (pts[i][1] - pts[j][1]) * (pts[i][1] - pts[j][1]);
  const ekey = (i, j) => (i < j ? (i + "-" + j) : (j + "-" + i));
  const edges = new Set();
  // 每个点连到最近的 2 个邻居 → 不会出现孤立点
  for (let i = 0; i < n; i++) {
    const near = [];
    for (let j = 0; j < n; j++) { if (j !== i) near.push([j, dist2(i, j)]); }
    near.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < 2 && k < near.length; k++) edges.add(ekey(i, near[k][0]));
  }
  // 近距离再补一些边，把网织密
  const nearLimit = (w * 0.32) * (w * 0.32);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist2(i, j) < nearLimit && rng() < 0.45) edges.add(ekey(i, j));
    }
  }
  let s = "";
  edges.forEach(k => {
    const pair = k.split("-");
    const i = Number(pair[0]), j = Number(pair[1]);
    s += `<path d="M${pts[i][0].toFixed(0)} ${pts[i][1].toFixed(0)} `
      + `L${pts[j][0].toFixed(0)} ${pts[j][1].toFixed(0)}" stroke="${accent}" `
      + `stroke-width="3" opacity="${(0.28 + rng() * 0.3).toFixed(2)}"/>`;
  });
  for (let i = 0; i < n; i++) {
    const r = Math.min(w, h) * (0.032 + rng() * 0.02);
    s += `<circle cx="${pts[i][0].toFixed(0)}" cy="${pts[i][1].toFixed(0)}" r="${r.toFixed(0)}" `
      + `fill="${accent}" opacity="${(0.45 + rng() * 0.45).toFixed(2)}"/>`;
  }
  return s;
}

/**
 * 城市天际线（政治 / 城市）
 * 2026-10-27 改形：原来只是"几个高矮不同的空心矩形"，和财经的柱状图
 * **视觉上几乎分不出来**（用户二审指出）。现在给每栋楼加上
 * ① 屋顶线（比楼体略宽的屋檐横线）② 两列窗户 ③ 一条地面线，
 * 一眼就能看出是"楼房"而不是"柱子"。
 */
function fbMotifCity(rng, accent, box) {
  const { x0, y0, w, h } = box;
  const n = 5;
  const gap = w * 0.035;
  const bw = (w - gap * (n - 1)) / n;
  let s = "";
  for (let i = 0; i < n; i++) {
    const bh = h * (0.34 + rng() * 0.6);
    const bx = x0 + i * (bw + gap);
    const by = y0 + h - bh;
    // 楼体
    s += `<rect x="${bx.toFixed(0)}" y="${by.toFixed(0)}" width="${bw.toFixed(0)}" `
      + `height="${bh.toFixed(0)}" rx="${(bw * 0.05).toFixed(0)}" fill="none" `
      + `stroke="${accent}" stroke-width="5" opacity="${(0.55 + rng() * 0.35).toFixed(2)}"/>`;
    // 屋顶线（屋檐）：比楼体略宽的一条横线
    const eave = bw * 0.16;
    s += `<path d="M${(bx - eave).toFixed(0)} ${by.toFixed(0)} `
      + `H${(bx + bw + eave).toFixed(0)}" stroke="${accent}" stroke-width="5" `
      + `opacity="0.8" stroke-linecap="round"/>`;
    // 窗户：两列 × 若干行的小方块
    const rows = Math.max(2, Math.floor(bh / (bw * 0.6)));
    const wSize = bw * 0.2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 2; c++) {
        const wx = bx + bw * (0.24 + c * 0.42);
        const wy = by + bh * 0.14 + r * (bh * 0.72 / rows);
        s += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="${wSize.toFixed(0)}" `
          + `height="${(wSize * 0.8).toFixed(0)}" fill="${accent}" `
          + `opacity="${(0.3 + rng() * 0.35).toFixed(2)}"/>`;
      }
    }
  }
  // 地面线：让楼"立"在地上
  s += `<path d="M${x0.toFixed(0)} ${(y0 + h).toFixed(0)} H${(x0 + w).toFixed(0)}" `
    + `stroke="${accent}" stroke-width="5" opacity="0.7" stroke-linecap="round"/>`;
  return s;
}

const FB_MOTIFS = {
  chip: fbMotifChip,
  disk: fbMotifDisk,
  server: fbMotifServer,
  laptop: fbMotifLaptop,
  bars: fbMotifBars,
  wave: fbMotifWave,
  orbit: fbMotifOrbit,
  nodes: fbMotifNodes,
  city: fbMotifCity,
};

/** 关键词 → 母题（与 news_image_factory.py 的实物母题保持一致：优先画实物） */
const FB_KEYWORD_MOTIFS = [
  [["服务器", "机柜", "机房", "算力中心", "集群", "数据中心"], "server"],
  [["存储", "硬盘", "固态", "磁盘", "闪存", "内存", "云存储"], "disk"],
  [["人工智能", "AI", "大模型", "算法", "深度学习", "机器学习", "软件", "操作系统", "程序", "算力", "数字"], "laptop"],
  [["芯片", "半导体", "晶圆", "集成电路", "处理器", "光刻"], "chip"],
  [["卫星", "航天", "火箭", "飞船", "宇宙", "探月", "空间站"], "orbit"],
  [["股市", "证券", "基金", "银行", "交易所", "消费", "零售", "电商", "经济", "增长", "数据"], "bars"],
  [["台风", "暴雨", "洪水", "地震", "天气", "气象", "医疗", "健康", "医院", "疫苗"], "wave"],
  [["城市", "地铁", "高铁", "机场", "港口", "大桥", "建筑", "住房"], "city"],
];

/** 各分类的兜底母题（关键词没命中时用它） */
const FB_CATEGORY_MOTIF = {
  "政治": "city",
  "科技": "nodes",
  "财经": "bars",
  "生活": "wave",
};

/** 按新闻内容选一个母题 */
function fallbackMotifOf(news) {
  const text = String((news && news.title) || "") + " " + String((news && news.summary) || "");
  for (const pair of FB_KEYWORD_MOTIFS) {
    for (const w of pair[0]) {
      if (text.indexOf(w) >= 0) return pair[1];
    }
  }
  return FB_CATEGORY_MOTIF[(news && news.category) || ""] || "nodes";
}

/**
 * 生成一张兜底配图（SVG 的 data URI）
 * @param {Object} news 新闻对象（用得到 title / category / summary / id）
 * @returns {string} data URI；关掉开关或出异常时返回空字符串
 */
function clientFallbackImage(news) {
  if (!FALLBACK_IMAGE.enabled) return "";
  try {
    const S = FALLBACK_IMAGE.size;
    const seedStr = String((news && (news.id || news.link || news.title)) || "news");
    const seed = fallbackHash(seedStr + "|" + String((news && news.title) || ""));
    const rng = fallbackRng(seed);

    const pal = FALLBACK_IMAGE.palette[(news && news.category) || ""]
      || FALLBACK_IMAGE.fallbackPalette;
    const accent = pal[1];

    const m = FALLBACK_IMAGE.margin;
    const box = { x0: S * m, y0: S * m, w: S * (1 - 2 * m), h: S * (1 - 2 * m) };
    const motif = fallbackMotifOf(news);
    const drawer = FB_MOTIFS[motif] || FB_MOTIFS.nodes;
    const body = drawer(rng, accent, box);

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" `
      + `viewBox="0 0 ${S} ${S}">`
      + `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`
      + `<stop offset="0" stop-color="${pal[0]}"/>`
      + `<stop offset="1" stop-color="${pal[1]}"/>`
      + `</linearGradient></defs>`
      + `<rect width="${S}" height="${S}" fill="url(#bg)"/>`
      + body
      + `</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  } catch (e) {
    return "";
  }
}

/**
 * 图片加载**看门狗**：给 <img> 挂一个"加载超时"保险。
 *
 * 背景（2026-10-29 实测）：本地服务端是单线程的，被耗时的抓图 / 生成图任务占住时，
 * 图片请求会排队卡住几分钟——浏览器里这张图一直是 pending（complete=false），
 * 不触发 error、也不触发 load，页面看起来就是"图像一直空白"。
 * onerror 兜底图对这种情况**无效**（压根没走到"失败"那一步），所以需要看门狗：
 *   ① 15 秒还没加载完 → 强制重新请求一次（顺便把 lazy 改成立即加载）；
 *   ② 重试后再等两轮（共约 45 秒）仍未完成 → 调 coverImageError 换成现画的兜底图，
 *      绝不留永久空白。给两轮宽限是因为重试的请求可能排在服务端正在处理的
 *      耗时任务后面，45 秒内真图大概率能到——宁可多等，不轻易用兜底图顶替真图。
 * 正常毫秒级加载完成的图完全不受影响（load/error 一到定时器就被清掉）。
 * 同一张图只挂一次（dataset.watchdog 防重）。
 */
function armImageWatchdog(img, timeoutMs) {
  if (!img || img.dataset.watchdog) return;
  img.dataset.watchdog = "1";
  const wait = timeoutMs || 15000;
  let ticks = 0;
  const timer = setInterval(() => {
    // 加载完成（或已换成兜底图）就收摊
    if ((img.complete && img.naturalWidth > 0) || img.dataset.fbApplied) {
      clearInterval(timer);
      return;
    }
    ticks += 1;
    if (ticks === 1) {
      // 第一阶段：强制重试一次。lazy 的图在视口外不会发起请求，
      // 这里改成 eager 主动要一次；对"请求发出但服务端忙"的图相当于重排到队尾
      img.loading = "eager";
      img.src = img.src;
    } else if (ticks >= 3) {
      // 第二阶段：重试后仍不出图就认输，换兜底图
      clearInterval(timer);
      if (typeof coverImageError === "function") coverImageError(img);
    }
  }, wait);
  img.addEventListener("load", () => clearInterval(timer), { once: true });
  img.addEventListener("error", () => clearInterval(timer), { once: true });
}

/**
 * 图片加载失败时的兜底（供 <img onerror> 与 applyNewsImage 用）
 * 作用：任何一张图挂了（图库里指向已被 .gitignore 的 svg、缓存里的旧地址、
 * 文件被清掉……），都不会留下破图或空白，而是换成现画的一张。
 * @param {HTMLImageElement} img
 * @param {Object} [news] 能拿到新闻对象时画得更贴题
 */
function coverImageError(img, news) {
  if (!img || img.dataset.fbApplied) return;
  let target = news;
  if (!target && img.closest) {
    const box = img.closest("[data-news-id]");
    const id = box ? box.getAttribute("data-news-id") : "";
    if (id && typeof latestNews !== "undefined" && Array.isArray(latestNews)) {
      target = latestNews.find(n => n && n.id === id) || null;
    }
    if (!target && id) target = { id, title: "", category: "" };
  }
  const fb = target ? clientFallbackImage(target) : "";
  if (!fb) { img.remove(); return; }
  img.dataset.fbApplied = "1";
  img.src = fb;
  // 沉浸封面默认 opacity:0，要 .loaded 才淡入；换图后必须补上，
  // 否则图换好了但**看不见**（见 css/style.css 的 .imm-cover）
  img.classList.add("loaded");
}
