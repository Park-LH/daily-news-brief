# -*- coding: utf-8 -*-
"""
news_image_factory.py —— 用「代码」给新闻生成配图（不用 AI、不用密钥、零第三方库）
================================================================================
为什么要有这个工具（解决的问题）：
    之前新闻配图只有三种来源：源站正文配图 / 3 张种子素材图 / AI 生成。
    前两者会让整页看起来"配图单一"（同一板块的新闻共用同一张图），
    第三者要有密钥、要十几秒，缺密钥时整条新闻就只剩渐变底。

    本工具用**代码直接画**（生成 SVG），因此：
      · 不需要密钥、不需要联网，毫秒级出图 → 所有新闻都能有配图（100% 覆盖）
      · 画面由「这条新闻的真实内容」决定（分类 + 关键词 + 标题指纹），
        不同新闻画出来的构图/配色/疏密都不一样，不会千篇一律
      · 同一条新闻每次生成的图**完全一致**（确定性哈希，刷新不会变脸）

配图标准（写在 STANDARDS 里，生成后自检，不达标就直接报错）：
    1. 画面里**禁止出现任何文字**（<text> 元素），也不画 Logo/水印/边框/角标
    2. 画布 1200×1200 正方形：页面列表是 1:1、沉浸封面是竖幅，
       方图 + 主体居中 → 两种裁切都不会把主体切掉
    3. 主体画在中心"安全区"内，四周留白 ≥ 8%
    4. 单文件 ≤ 200KB（SVG 通常 2~6KB）
    5. 配色跟随板块色（与 style.css 的分类渐变底同色系，切换时不会突兀）

用法（项目根目录执行）：
    python tools/news_image_factory.py --id n1a2b3c --category 科技 ^
        --keywords "芯片,半导体" --title "我国芯片研发取得新进展"

    图库管理：
    python tools/news_image_factory.py --list              # 列出图库
    python tools/news_image_factory.py --stats             # 图库统计
    python tools/news_image_factory.py --promote n1a2b3c --quality 5   # 标为优秀配图
    python tools/news_image_factory.py --check assets/images/news-library/x.svg

输出（stdout，一行 JSON）：
    {"ok": true, "url": "assets/images/news-library/n1a2b3c.svg", "motif": "circuit", "from": "generated"}
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import random
import shutil
import sys

# ---------------------------------------------------------------------------
# 配图标准（生成后按这里自检；改标准只改这一处）
# ---------------------------------------------------------------------------
STANDARDS = {
    "canvas": 1200,             # 画布边长（正方形）
    "safe_margin_ratio": 0.08,  # 四周留白比例（主体不许画到这个范围之外）
    "max_bytes": 200 * 1024,    # 单文件体积上限
    "forbid_text": True,        # 是否禁止画面里出现文字
}

# ---------------------------------------------------------------------------
# 新闻图库：专门存放"历史生成的优秀配图"的目录与索引
#   注意与 assets/images/gen/ 的区别：
#     gen/       —— 运行时临时产物，已在 .gitignore 里排除，随时可重新生成
#     news-library/ —— 图库，**要进仓库长期保存**，供以后同类新闻直接复用
# ---------------------------------------------------------------------------
LIBRARY_DIR = "assets/images/news-library"
LIBRARY_INDEX = "assets/images/library.json"

# ---------------------------------------------------------------------------
# 板块配色：与 css/style.css 里 .imm-media[data-category=...] 的渐变底同色系，
# 这样"渐变底 → 图片淡入"时不会突然变色。
#   bg1 = 深色底，bg2 = 主色，accent = 主体亮色
# ---------------------------------------------------------------------------
CATEGORY_PALETTES = {
    "政治": {"bg1": "#450a0a", "bg2": "#b91c1c", "accent": "#fca5a5"},
    "科技": {"bg1": "#0c1a4a", "bg2": "#1d4ed8", "accent": "#93c5fd"},
    "财经": {"bg1": "#451a03", "bg2": "#b45309", "accent": "#fcd34d"},
    "生活": {"bg1": "#500724", "bg2": "#be185d", "accent": "#f9a8d4"},
}
DEFAULT_PALETTE = {"bg1": "#111827", "bg2": "#1f2937", "accent": "#94a3b8"}

# ---------------------------------------------------------------------------
# 主题（关键词）→ 构图母题
# 让"这条新闻讲了什么"真正决定画面长什么样：
# 讲芯片画电路、讲卫星画轨道、讲股市画柱状、讲健康画波纹……
# ---------------------------------------------------------------------------
KEYWORD_MOTIFS = [
    (("芯片", "半导体", "电路", "算力", "硬件", "计算机", "服务器", "操作系统"), "circuit"),
    (("卫星", "航天", "火箭", "飞船", "宇宙", "天文", "探月", "空间站"), "orbit"),
    (("机器人", "智能制造", "工厂", "装备"), "cells"),
    (("电池", "充电", "新能源", "光伏", "储能", "电力"), "cells"),
    (("人工智能", "大模型", "算法", "AI", "数据"), "nodes"),
    (("金融", "股市", "基金", "证券", "贸易", "港口", "物流", "消费", "价格", "经济"), "bars"),
    (("会议", "会谈", "访问", "外交", "合作", "签约", "论坛"), "pillars"),
    (("城市", "建设", "规划", "交通", "地铁", "铁路", "桥梁"), "city"),
    (("健康", "医疗", "医生", "疾病", "疫苗", "食品", "养生"), "wave"),
    (("文化", "文物", "展览", "非遗", "博物馆", "考古", "遗址", "艺术"), "arcs"),
    (("旅游", "景区", "山水", "公园", "乡村", "生态", "环境"), "peaks"),
]

# 每个板块的兜底母题（关键词没命中时用），列表里有多个 → 按标题指纹选，仍有变化
CATEGORY_MOTIFS = {
    "政治": ["city", "pillars", "nodes"],
    "科技": ["circuit", "nodes", "orbit"],
    "财经": ["bars", "nodes", "cells"],
    "生活": ["wave", "arcs", "peaks"],
}
DEFAULT_MOTIFS = ["nodes", "wave", "circuit"]


# ===========================================================================
# 基础工具
# ===========================================================================
def project_root():
    """项目根目录（本脚本放在 <root>/tools/ 下）"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fingerprint_of(news_id, title, category, keywords):
    """内容指纹：同样输入永远得到同样的值 → 图片可复现"""
    raw = "|".join([news_id or "", title or "", category or "", keywords or ""])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def pick_motif(category, keywords, title, fp):
    """
    决定画什么：先按**真实关键词**定母题，没命中再按板块 + 标题指纹选。
    这样同类新闻不会都长一个样，而且画面跟新闻内容对得上。
    """
    text = " ".join([keywords or "", title or ""])
    for words, motif in KEYWORD_MOTIFS:
        for w in words:
            if w and w in text:
                return motif
    pool = CATEGORY_MOTIFS.get(category) or DEFAULT_MOTIFS
    return pool[int(fp[:8], 16) % len(pool)]


# ===========================================================================
# 各种母题的画法（返回的 SVG 片段都画在"中心安全区"内）
# ===========================================================================
def _safe_box():
    """中心安全区（主体只画在这里面，保证方形/竖幅裁切都切不掉）"""
    m = STANDARDS["canvas"] * STANDARDS["safe_margin_ratio"]
    return (m, m, STANDARDS["canvas"] - m, STANDARDS["canvas"] - m)


def motif_circuit(rng, accent):
    """电路：横竖走线 + 节点（芯片/半导体/硬件类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    parts = []
    for i in range(9):
        y = y0 + (y1 - y0) * (i + 0.5) / 9
        x_end = x0 + (x1 - x0) * rng.uniform(0.45, 1.0)
        parts.append(
            f'<path d="M{x0:.0f} {y:.0f} H{x_end:.0f}" stroke="{accent}" '
            f'stroke-width="{rng.uniform(1.5, 4):.1f}" opacity="{rng.uniform(0.35, 0.8):.2f}"/>'
        )
        parts.append(
            f'<circle cx="{x_end:.0f}" cy="{y:.0f}" r="{rng.uniform(5, 11):.1f}" '
            f'fill="{accent}" opacity="{rng.uniform(0.5, 0.95):.2f}"/>'
        )
    for i in range(5):
        x = x0 + (x1 - x0) * (i + 0.5) / 5
        y_end = y0 + (y1 - y0) * rng.uniform(0.35, 0.9)
        parts.append(
            f'<path d="M{x:.0f} {y0:.0f} V{y_end:.0f}" stroke="{accent}" '
            f'stroke-width="{rng.uniform(1.5, 3.5):.1f}" opacity="{rng.uniform(0.3, 0.6):.2f}"/>'
        )
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = (x1 - x0) * 0.16
    parts.append(
        f'<rect x="{cx - r:.0f}" y="{cy - r:.0f}" width="{2 * r:.0f}" height="{2 * r:.0f}" '
        f'rx="{r * 0.18:.0f}" fill="none" stroke="{accent}" stroke-width="5" opacity="0.9"/>'
    )
    return "".join(parts)


def motif_orbit(rng, accent):
    """轨道：同心椭圆 + 星点（航天/卫星/天文类新闻）"""
    cx = cy = STANDARDS["canvas"] / 2
    parts = []
    base = (STANDARDS["canvas"] * 0.42)
    for i in range(4):
        r = base * (0.35 + 0.2 * i)
        rot = rng.uniform(0, 180)
        parts.append(
            f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{r:.0f}" ry="{r * rng.uniform(0.35, 0.6):.0f}" '
            f'fill="none" stroke="{accent}" stroke-width="{rng.uniform(2, 4.5):.1f}" '
            f'opacity="{rng.uniform(0.35, 0.75):.2f}" transform="rotate({rot:.0f} {cx:.0f} {cy:.0f})"/>'
        )
    parts.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{base * 0.16:.0f}" fill="{accent}" opacity="0.95"/>')
    for _ in range(7):
        a = rng.uniform(0, 2 * math.pi)
        rr = base * rng.uniform(0.45, 1.0)
        parts.append(
            f'<circle cx="{cx + rr * math.cos(a):.0f}" cy="{cy + rr * math.sin(a) * 0.55:.0f}" '
            f'r="{rng.uniform(4, 9):.1f}" fill="{accent}" opacity="{rng.uniform(0.4, 0.9):.2f}"/>'
        )
    return "".join(parts)


def motif_bars(rng, accent):
    """柱状：递增柱 + 趋势线（财经/贸易/消费类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    n = 7
    gap = (x1 - x0) / n
    parts = []
    heights = [rng.uniform(0.25, 0.55)] + [rng.uniform(0.3, 1.0) for _ in range(n - 1)]
    heights[-1] = max(heights[-1], heights[0] * 1.6)   # 最后一根最高 → 有"增长"意味
    pts = []
    for i, h in enumerate(heights):
        bw = gap * 0.5
        bx = x0 + gap * i + (gap - bw) / 2
        bh = (y1 - y0) * h
        by = y1 - bh
        parts.append(
            f'<rect x="{bx:.0f}" y="{by:.0f}" width="{bw:.0f}" height="{bh:.0f}" '
            f'rx="{bw * 0.18:.0f}" fill="{accent}" opacity="{rng.uniform(0.45, 0.9):.2f}"/>'
        )
        pts.append((bx + bw / 2, by))
    parts.append(
        '<polyline points="' + " ".join(f"{p[0]:.0f},{p[1]:.0f}" for p in pts) + '" '
        f'fill="none" stroke="{accent}" stroke-width="4" opacity="0.85"/>'
    )
    parts.append(
        f'<path d="M{x0:.0f} {y1:.0f} H{x1:.0f}" stroke="{accent}" stroke-width="3" opacity="0.5"/>'
    )
    return "".join(parts)


def motif_wave(rng, accent):
    """波纹：多层正弦曲线（健康/医疗/生活类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    parts = []
    for k in range(5):
        amp = (y1 - y0) * rng.uniform(0.04, 0.10)
        base_y = y0 + (y1 - y0) * (k + 0.8) / 6
        phase = rng.uniform(0, 2 * math.pi)
        steps = 40
        d = []
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i / steps
            y = base_y + amp * math.sin(phase + i / steps * math.pi * rng.choice([2, 3, 4]))
            d.append(f"{x:.0f} {y:.0f}")
        parts.append(
            f'<polyline points="{" ".join(d)}" fill="none" stroke="{accent}" '
            f'stroke-width="{rng.uniform(2, 5):.1f}" opacity="{rng.uniform(0.35, 0.8):.2f}"/>'
        )
    return "".join(parts)


def motif_city(rng, accent):
    """城市天际线（城市/建设/交通/政务类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    parts = []
    x = x0
    while x < x1 - 20:
        w = rng.uniform(50, 110)
        h = (y1 - y0) * rng.uniform(0.25, 0.8)
        by = y1 - h
        parts.append(
            f'<rect x="{x:.0f}" y="{by:.0f}" width="{w:.0f}" height="{h:.0f}" '
            f'fill="{accent}" opacity="{rng.uniform(0.3, 0.7):.2f}"/>'
        )
        for _ in range(int(h / 45)):
            parts.append(
                f'<rect x="{x + rng.uniform(8, w - 18):.0f}" y="{by + rng.uniform(10, max(12, h - 20)):.0f}" '
                f'width="8" height="8" fill="{accent}" opacity="0.9"/>'
            )
        x += w + rng.uniform(10, 26)
    parts.append(
        f'<path d="M{x0:.0f} {y1:.0f} H{x1:.0f}" stroke="{accent}" stroke-width="4" opacity="0.6"/>'
    )
    return "".join(parts)


def motif_cells(rng, accent):
    """格子阵：圆角方块阵列（电池/新能源/智能制造类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    n = rng.choice([4, 5])
    gap = (x1 - x0) / n
    parts = []
    for r_i in range(n):
        for c_i in range(n):
            cx = x0 + gap * (c_i + 0.5)
            cy = y0 + gap * (r_i + 0.5)
            s = gap * rng.uniform(0.35, 0.62)
            parts.append(
                f'<rect x="{cx - s / 2:.0f}" y="{cy - s / 2:.0f}" width="{s:.0f}" height="{s:.0f}" '
                f'rx="{s * 0.22:.0f}" fill="none" stroke="{accent}" stroke-width="{rng.uniform(2, 4.5):.1f}" '
                f'opacity="{rng.uniform(0.3, 0.85):.2f}"/>'
            )
    return "".join(parts)


def motif_nodes(rng, accent):
    """节点网络：点与连线（AI/数据/算法类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    pts = [(rng.uniform(x0, x1), rng.uniform(y0, y1)) for _ in range(11)]
    parts = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            dx, dy = pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]
            if math.hypot(dx, dy) < (x1 - x0) * 0.34:
                parts.append(
                    f'<line x1="{pts[i][0]:.0f}" y1="{pts[i][1]:.0f}" x2="{pts[j][0]:.0f}" '
                    f'y2="{pts[j][1]:.0f}" stroke="{accent}" stroke-width="2" '
                    f'opacity="{rng.uniform(0.25, 0.6):.2f}"/>'
                )
    for (px, py) in pts:
        parts.append(
            f'<circle cx="{px:.0f}" cy="{py:.0f}" r="{rng.uniform(6, 15):.1f}" '
            f'fill="{accent}" opacity="{rng.uniform(0.5, 0.95):.2f}"/>'
        )
    return "".join(parts)


def motif_pillars(rng, accent):
    """立柱：等距竖条（会议/合作/签约类新闻，稳重规整）"""
    x0, y0, x1, y1 = _safe_box()
    n = rng.choice([5, 6, 7])
    gap = (x1 - x0) / n
    parts = []
    for i in range(n):
        w = gap * 0.42
        bx = x0 + gap * i + (gap - w) / 2
        h = (y1 - y0) * rng.uniform(0.45, 0.95)
        parts.append(
            f'<rect x="{bx:.0f}" y="{y1 - h:.0f}" width="{w:.0f}" height="{h:.0f}" rx="{w * 0.3:.0f}" '
            f'fill="{accent}" opacity="{rng.uniform(0.35, 0.8):.2f}"/>'
        )
    return "".join(parts)


def motif_arcs(rng, accent):
    """同心弧：层层展开（文化/文物/展览类新闻）"""
    cx = cy = STANDARDS["canvas"] / 2
    parts = []
    for i in range(6):
        r = STANDARDS["canvas"] * 0.10 * (i + 1)
        a0 = rng.uniform(0, 360)
        a1 = a0 + rng.uniform(70, 200)
        large = 1 if (a1 - a0) > 180 else 0
        x_start = cx + r * math.cos(math.radians(a0))
        y_start = cy + r * math.sin(math.radians(a0))
        x_end = cx + r * math.cos(math.radians(a1))
        y_end = cy + r * math.sin(math.radians(a1))
        parts.append(
            f'<path d="M{x_start:.0f} {y_start:.0f} A{r:.0f} {r:.0f} 0 {large} 1 {x_end:.0f} {y_end:.0f}" '
            f'fill="none" stroke="{accent}" stroke-width="{rng.uniform(3, 7):.1f}" '
            f'opacity="{rng.uniform(0.35, 0.8):.2f}"/>'
        )
    return "".join(parts)


def motif_peaks(rng, accent):
    """山峰：层叠三角（旅游/山水/生态类新闻）"""
    x0, y0, x1, y1 = _safe_box()
    parts = []
    for layer in range(3):
        base_y = y0 + (y1 - y0) * (0.55 + 0.18 * layer)
        top = y0 + (y1 - y0) * (0.18 + 0.12 * layer)
        n = 3 + layer
        step = (x1 - x0) / n
        pts = [(x0, base_y)]
        for i in range(n + 1):
            px = x0 + step * i
            py = base_y if i % 2 == 0 else top + rng.uniform(-20, 40)
            pts.append((px, py))
        pts.append((x1, base_y))
        parts.append(
            '<polygon points="' + " ".join(f"{p[0]:.0f},{p[1]:.0f}" for p in pts) + '" '
            f'fill="{accent}" opacity="{rng.uniform(0.3, 0.6):.2f}"/>'
        )
    return "".join(parts)


MOTIF_DRAWERS = {
    "circuit": motif_circuit,
    "orbit": motif_orbit,
    "bars": motif_bars,
    "wave": motif_wave,
    "city": motif_city,
    "cells": motif_cells,
    "nodes": motif_nodes,
    "pillars": motif_pillars,
    "arcs": motif_arcs,
    "peaks": motif_peaks,
}


# ===========================================================================
# 组装整张 SVG
# ===========================================================================
def build_svg(category, motif, fp):
    """按板块配色 + 母题 + 指纹，拼出一张完整 SVG（同一 fp 结果永远一致）"""
    pal = CATEGORY_PALETTES.get(category) or DEFAULT_PALETTE
    rng = random.Random(fp)          # 以指纹为种子 → 确定性
    size = STANDARDS["canvas"]

    # 光晕位置也由指纹决定：不同新闻的光感不同，但同一条新闻恒定
    gx = rng.uniform(0.15, 0.85) * size
    gy = rng.uniform(0.10, 0.60) * size

    body = MOTIF_DRAWERS.get(motif, motif_nodes)(rng, pal["accent"])

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" role="img" aria-label="新闻配图">'
        "<defs>"
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="{pal["bg2"]}"/>'
        f'<stop offset="100%" stop-color="{pal["bg1"]}"/>'
        "</linearGradient>"
        f'<radialGradient id="glow" cx="{gx / size:.2f}" cy="{gy / size:.2f}" r="0.75">'
        f'<stop offset="0%" stop-color="{pal["accent"]}" stop-opacity="0.35"/>'
        f'<stop offset="100%" stop-color="{pal["accent"]}" stop-opacity="0"/>'
        "</radialGradient>"
        f'<radialGradient id="vig" cx="0.5" cy="0.5" r="0.75">'
        f'<stop offset="55%" stop-color="#000000" stop-opacity="0"/>'
        f'<stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>'
        "</radialGradient>"
        "</defs>"
        f'<rect width="{size}" height="{size}" fill="url(#bg)"/>'
        f'<rect width="{size}" height="{size}" fill="url(#glow)"/>'
        f"{body}"
        f'<rect width="{size}" height="{size}" fill="url(#vig)"/>'
        "</svg>"
    )


def check_standards(svg_text):
    """按 STANDARDS 自检；返回 (是否达标, 说明列表)"""
    problems = []
    if STANDARDS["forbid_text"] and ("<text" in svg_text or "<tspan" in svg_text):
        problems.append("画面里出现了文字元素（<text>）")
    if f'viewBox="0 0 {STANDARDS["canvas"]} {STANDARDS["canvas"]}"' not in svg_text:
        problems.append("画布不是 1200×1200 正方形，方图/竖幅裁切可能切掉主体")
    if len(svg_text.encode("utf-8")) > STANDARDS["max_bytes"]:
        problems.append("文件体积超过上限")
    return (len(problems) == 0), problems


# ===========================================================================
# 新闻图库（保存历史生成的优秀配图，供以后复用）
# ===========================================================================
def load_library(root):
    path = os.path.join(root, LIBRARY_INDEX.replace("/", os.sep))
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 2, "items": []}


def save_library(root, library):
    path = os.path.join(root, LIBRARY_INDEX.replace("/", os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def upsert_library_item(root, item):
    """登记/更新一条图库记录（同一 id 只保留一条）"""
    library = load_library(root)
    items = library.setdefault("items", [])
    items[:] = [x for x in items if x.get("id") != item.get("id")]
    items.append(item)
    library["version"] = 2
    save_library(root, library)


def library_stats(root):
    library = load_library(root)
    items = library.get("items", [])
    stat = {"total": len(items), "byCategory": {}, "byKind": {}, "byQuality": {}, "excellent": 0}
    for it in items:
        stat["byCategory"][it.get("category", "未知")] = stat["byCategory"].get(it.get("category", "未知"), 0) + 1
        stat["byKind"][it.get("kind", it.get("source", "未知"))] = stat["byKind"].get(it.get("kind", it.get("source", "未知")), 0) + 1
        q = str(it.get("quality", "-"))
        stat["byQuality"][q] = stat["byQuality"].get(q, 0) + 1
        if (it.get("quality") or 0) >= 4:
            stat["excellent"] += 1
    return stat


# ===========================================================================
# 输出
# ===========================================================================
def ok(**kw):
    print(json.dumps(kw, ensure_ascii=False))


def fail(error, message):
    print(json.dumps({"ok": False, "error": error, "message": message}, ensure_ascii=False))
    sys.exit(0)


# ===========================================================================
# 命令行
# ===========================================================================
def main():
    parser = argparse.ArgumentParser(description="用代码为新闻生成配图并管理新闻图库")
    parser.add_argument("--id", help="新闻 id，用作文件名")
    parser.add_argument("--category", default="综合", help="新闻分类：政治/科技/财经/生活")
    parser.add_argument("--keywords", default="", help="关键词，逗号分隔")
    parser.add_argument("--title", default="", help="新闻标题（决定画面构图）")
    parser.add_argument("--summary", default="", help="新闻摘要（参与指纹）")
    parser.add_argument("--list", action="store_true", help="列出图库")
    parser.add_argument("--stats", action="store_true", help="图库统计")
    parser.add_argument("--promote", metavar="ID", help="把指定 id 的图标为优秀配图（沉淀进图库）")
    parser.add_argument("--quality", type=int, default=4, help="与 --promote 同用：质量分 1~5")
    parser.add_argument("--check", metavar="FILE", help="校验某张图是否符合配图标准")
    args = parser.parse_args()

    root = project_root()

    # ---- 图库查看 ----
    if args.stats:
        ok(ok=True, **library_stats(root))
        return
    if args.list:
        lib = load_library(root)
        ok(ok=True, count=len(lib.get("items", [])), items=lib.get("items", []))
        return

    # ---- 单图标准校验 ----
    if args.check:
        path = args.check if os.path.isabs(args.check) else os.path.join(root, args.check)
        if not os.path.isfile(path):
            fail("FILE_NOT_FOUND", "找不到文件：" + args.check)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        passed, problems = check_standards(text)
        ok(ok=passed, file=args.check, bytes=len(text.encode("utf-8")), problems=problems)
        return

    # ---- 标记为优秀配图 ----
    if args.promote:
        lib = load_library(root)
        hit = next((x for x in lib.get("items", []) if x.get("id") == args.promote), None)
        if not hit:
            fail("NOT_FOUND", "图库里没有 id=" + args.promote)
        hit["quality"] = max(1, min(5, args.quality))
        hit["promotedAt"] = datetime.date.today().isoformat()
        upsert_library_item(root, hit)

        # 沉淀：把临时目录（assets/images/gen，不进仓库）里的图复制到图库目录（进仓库）
        src = os.path.join(root, hit.get("file", "").replace("/", os.sep))
        if os.path.isfile(src) and os.sep + "gen" + os.sep in src:
            dest_dir = os.path.join(root, LIBRARY_DIR.replace("/", os.sep))
            os.makedirs(dest_dir, exist_ok=True)
            ext = os.path.splitext(src)[1] or ".png"
            dest = os.path.join(dest_dir, hit["id"] + ext)
            shutil.copyfile(src, dest)
            hit["file"] = (LIBRARY_DIR + "/" + hit["id"] + ext).replace("\\", "/")
            upsert_library_item(root, hit)
        ok(ok=True, id=args.promote, quality=hit["quality"], file=hit["file"])
        return

    # ---- 生成 ----
    if not args.id:
        fail("MISSING_ID", "缺少 --id（新闻 id）")

    category = args.category or "综合"
    fp = fingerprint_of(args.id, args.title, category, args.keywords)
    motif = pick_motif(category, args.keywords, args.title, fp)
    svg = build_svg(category, motif, fp)

    passed, problems = check_standards(svg)
    if not passed:
        fail("STANDARD_VIOLATION", "生成的图不符合配图标准：" + "；".join(problems))

    rel = (LIBRARY_DIR + "/" + args.id + ".svg").replace("\\", "/")
    abs_path = os.path.join(root, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(svg)

    upsert_library_item(root, {
        "id": args.id,
        "category": category,
        "keywords": [k for k in (args.keywords or "").split(",") if k],
        "file": rel,
        "kind": "code",
        "source": "code",
        "motif": motif,
        "fingerprint": fp,
        "prompt": "",
        "quality": 3,                 # 代码生成的默认分；人工 --promote 可升到 4~5
        "usageCount": 0,
        "title": (args.title or "")[:60],
        "createdAt": datetime.date.today().isoformat(),
    })

    # 注意：from 是 Python 关键字，不能写成 ok(from=...)，所以这里用字典传参
    ok(**{
        "ok": True,
        "url": rel,
        "motif": motif,
        "fingerprint": fp,
        "from": "generated",
        "bytes": len(svg.encode("utf-8")),
    })


if __name__ == "__main__":
    main()
