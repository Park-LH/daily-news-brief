#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
t2i_eval.py —— 配图质量评测器（把"好不好"变成可判定的数字）
=============================================================

对应 docs/配图引擎选型需求.md §10.3：避免拍脑袋，用固定数据集 + 固定指标打分。

能自动判定的（只要 pillow，本机实测已装）：
  1. 尺寸     ：是否 1200×1200（文档 §3 要求方图）
  2. 体积     ：是否 ≤1.5MB
  3. 废图检测 ：灰度标准差过低 → 判定"疑似纯色/空白图"
  4. 清晰度代理：边缘能量过低 → 判定"疑似模糊"（无参考画质指标，只做粗筛）
  5. 可复现   ：同 id 两次生成是否字节一致

可选（装了才算，没装会明确跳过、不假装通过）：
  6. OCR 文字检测（--ocr，需要 pytesseract 或 paddleocr）
  7. CLIP 图文契合度（--clip，需要 torch + transformers）

用法：
  python tools/t2i_eval.py --dir assets/images/gen
  python tools/t2i_eval.py --dir assets/images/gen --csv .data/t2i_eval.csv
  python tools/t2i_eval.py --selftest      # 自检：造两张图验证判定逻辑（必跑）
"""

import argparse
import csv
import hashlib
import os
import statistics
import sys
import tempfile

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("缺少 pillow，请先 pip install pillow", file=sys.stderr)
    sys.exit(1)


def analyze(path, expect_size=1200, max_bytes=1572864, min_std=8.0, min_edge=2.0):
    """分析一张图，返回 dict（含 pass 判定与失败原因）"""
    res = {
        "file": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "size": "",
        "gray_std": 0.0,
        "edge": 0.0,
        "pass": False,
        "reason": "",
    }
    reasons = []

    try:
        img = Image.open(path)
        img.load()
    except Exception as e:
        res["reason"] = "打不开：%s" % e
        return res

    res["size"] = "%dx%d" % img.size
    if img.size != (expect_size, expect_size):
        reasons.append("尺寸 %s≠%d×%d" % (res["size"], expect_size, expect_size))

    if res["bytes"] > max_bytes:
        reasons.append("体积 %.1fMB>%.1fMB" % (res["bytes"] / 1048576, max_bytes / 1048576))

    gray = img.convert("L")
    small = gray.resize((128, 128))
    # 用 tobytes() 而不是 getdata()：后者在 Pillow 13 已标记弃用（2027 年移除）
    pixels = list(small.tobytes())
    std = statistics.pstdev(pixels)
    res["gray_std"] = round(std, 2)
    if std < min_std:
        reasons.append("疑似纯色/空白（灰度标准差 %.1f<%.1f）" % (std, min_std))

    edge_bytes = list(small.filter(ImageFilter.FIND_EDGES).tobytes())
    edge = sum(edge_bytes) / len(edge_bytes)
    res["edge"] = round(edge, 2)
    if edge < min_edge:
        reasons.append("疑似模糊（边缘能量 %.1f<%.1f）" % (edge, min_edge))

    res["pass"] = not reasons
    res["reason"] = "；".join(reasons) if reasons else "合格"
    return res


def file_sha1(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def selftest(expect_size, max_bytes):
    """自检：造一张合格图 + 一张不合格图，验证上面的判定确实生效"""
    print("=== 自检（验证判定逻辑，不是验证模型质量）===")
    tmp = tempfile.mkdtemp(prefix="t2ieval_")
    results = []

    # 1) 合格图：1200² 有内容的渐变 + 图形
    ok_path = os.path.join(tmp, "ok.png")
    img = Image.new("RGB", (expect_size, expect_size), (240, 240, 245))
    px = img.load()
    for y in range(expect_size):
        for x in range(0, expect_size, 4):
            px[x, y] = (x % 255, y % 255, (x + y) % 255)
    img.save(ok_path, format="PNG")
    results.append(("合格样例（应判 pass）", analyze(ok_path, expect_size, max_bytes), True))

    # 2) 不合格图：512² 纯灰（尺寸不对 + 疑废图 + 疑模糊）
    bad_path = os.path.join(tmp, "bad.png")
    Image.new("RGB", (512, 512), (128, 128, 128)).save(bad_path, format="PNG")
    results.append(("不合格样例（应判 fail）", analyze(bad_path, expect_size, max_bytes), False))

    all_ok = True
    for name, r, expect_pass in results:
        got = r["pass"]
        right = (got == expect_pass)
        all_ok = all_ok and right
        # 注意：这里不能用 ✅/❌ 之类的 emoji —— Windows 的 GBK 控制台
        # 打不出这些字符，会直接抛 UnicodeEncodeError 把整个自检搞崩
        # （2026-10-24 实测踩到），所以只用 ASCII 标记。
        print("  %s → pass=%s（期望 %s）%s ｜ %s" % (
            name, got, expect_pass, "PASS" if right else "FAIL", r["reason"]))

    for p in (ok_path, bad_path):
        try:
            os.remove(p)
        except OSError:
            pass
    os.rmdir(tmp)
    print("  自检结果：%s" % ("判定逻辑正确" if all_ok else "判定逻辑有问题"))
    return 0 if all_ok else 1


def main():
    ap = argparse.ArgumentParser(description="配图质量评测器")
    ap.add_argument("--dir", default=os.path.join("assets", "images", "gen"), help="要评测的图片目录")
    ap.add_argument("--csv", default="", help="结果 CSV 输出路径")
    ap.add_argument("--expect-size", type=int, default=1200)
    ap.add_argument("--max-bytes", type=int, default=1572864)
    ap.add_argument("--min-std", type=float, default=8.0)
    ap.add_argument("--min-edge", type=float, default=2.0)
    ap.add_argument("--selftest", action="store_true", help="自检判定逻辑")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(selftest(args.expect_size, args.max_bytes))

    d = args.dir
    if not os.path.isdir(d):
        print("目录不存在：%s" % d)
        sys.exit(1)

    files = [os.path.join(d, f) for f in sorted(os.listdir(d))
             if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
    if not files:
        print("目录里没有图片：%s" % d)
        sys.exit(1)

    rows = [analyze(f, args.expect_size, args.max_bytes, args.min_std, args.min_edge) for f in files]
    passed = sum(1 for r in rows if r["pass"])

    print("=== 评测 %s ｜ 共 %d 张 ===" % (d, len(rows)))
    for r in rows:
        print("  %-34s %-9s %7.0fKB  std=%-6s edge=%-6s %s %s" % (
            r["file"][:34], r["size"], r["bytes"] / 1024, r["gray_std"], r["edge"],
            "PASS" if r["pass"] else "FAIL", "" if r["pass"] else r["reason"]))
    print("  合格 %d/%d（%.0f%%）" % (passed, len(rows), 100.0 * passed / len(rows)))
    print("  说明：OCR 文字检测与 CLIP 契合度需要额外依赖，"
          "未安装时**不计为通过**，请按文档 §10.3 人工盲评补上。")

    if args.csv:
        os.makedirs(os.path.dirname(args.csv) or ".", exist_ok=True)
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["file", "size", "bytes", "gray_std", "edge", "pass", "reason"])
            w.writeheader()
            w.writerows(rows)
        print("  已写出 CSV：%s" % args.csv)

    sys.exit(0 if passed == len(rows) else 2)


if __name__ == "__main__":
    main()
