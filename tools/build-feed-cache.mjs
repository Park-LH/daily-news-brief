#!/usr/bin/env node
/**
 * 生成 feed-cache.json —— 静态托管（GitHub Pages）的"全量新闻通道"
 *
 * 【为什么需要它】2026-10-31 实测：
 * 静态站没有本地 /api/feed，只能走公共代理：
 *   - rss2json：稳、快（约 1 秒），但**每源只给最新 10 条**（提量参数要付费 key）；
 *   - allorigins：能给全量 30 条，但实测连续 522 / 502 / 408，**并发还会被限流**，靠不住。
 * 每源只有 10 条 → 7 个源共 63 条候选 → 按"只要今天"过滤后常只剩几条 →
 * 四个板块里三个是空的（用户在手机上看到的就是这样）。
 *
 * 【做法】用 GitHub Actions 定时（每小时）在**服务端**直连源站抓取（那里不受浏览器
 * 跨域、也不受公共代理限流），把**全量条目**（每源 30 条）写成仓库里的
 * feed-cache.json。静态页面 fetches 这个同源文件，既快又全，还不用第三方。
 * 页面端见 js/rss.js 的 fetchViaRepoCache()（通道 2）。
 *
 * 用法：node tools/build-feed-cache.mjs [项目根目录]
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const cfgPath = path.join(root, "js", "config.js");
const outPath = path.join(root, "feed-cache.json");

// ---- 1. 复用 js/config.js 里的源列表（同一份配置，避免两边改漏）----
const code = fs.readFileSync(cfgPath, "utf8");
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const sources = vm.runInContext("getEnabledSources()", sandbox);
console.log(`共 ${sources.length} 个启用中的源，开始抓取……`);

// ---- 2. 极简 RSS 解析（只取 title / link / description / pubDate）----
const stripCdata = s => s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
const stripTags = s => s.replace(/<[^>]*>/g, "");
const decodeEntities = s =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
   .replace(/&amp;/g, "&");
const clean = s => decodeEntities(stripTags(stripCdata(s || ""))).trim();
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1] : "";
};

function parseItems(xml) {
  const items = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[0];
    items.push({
      title: clean(pick(block, "title")),
      link: clean(pick(block, "link")),
      summary: clean(pick(block, "description")).slice(0, 3000),
      pubDate: clean(pick(block, "pubDate")),
    });
  }
  return items.filter(i => i.title && i.link);
}

// ---- 3. 逐个抓（串行：别把源站打爆，也避免被限流）----
async function fetchSource(s) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(s.url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; feed-cache-builder)" },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const all = parseItems(await r.text());
    const items = all.slice(0, s.maxItems || 30);
    console.log(`  ok  ${s.name}：${items.length} 条（源站共 ${all.length} 条）`);
    return { url: s.url, name: s.name, category: s.category, ok: true, items };
  } catch (e) {
    console.log(`  fail ${s.name}：${e && e.message ? e.message : e}`);
    return {
      url: s.url, name: s.name, category: s.category, ok: false, items: [],
      error: String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (const s of sources) results.push(await fetchSource(s));

// ---- 4. 写文件 ----
const out = {
  updatedAt: new Date().toISOString(),
  sourceCount: results.length,
  okCount: results.filter(r => r.ok).length,
  itemCount: results.reduce((n, r) => n + r.items.length, 0),
  sources: results,
};
fs.writeFileSync(outPath, JSON.stringify(out), "utf8");
console.log(
  `\n已写入 ${path.relative(root, outPath)}：${out.itemCount} 条`
  + `（${out.okCount}/${out.sourceCount} 个源成功），约 ${Math.round(JSON.stringify(out).length / 1024)} KB`
);
