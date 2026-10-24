#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_gpu_env.py —— 文生图（质量档）运行环境预检
=================================================

买好显卡、装完驱动之后，先跑这个脚本，确认环境真的达标再往下装 ComfyUI，
免得装到一半才发现 Python 版本不对 / 显存不够 / 磁盘塞不下模型。

  python tools/check_gpu_env.py
  python tools/check_gpu_env.py --comfy-url http://127.0.0.1:8188

检查项：
  1. NVIDIA 显卡与显存（质量档门槛：>= 12GB）
  2. 驱动版本（能跑 nvidia-smi 就说明驱动装好了）
  3. Python 版本（3.10 / 3.11 才行；3.13 装不上 torch 的官方 wheel）
  4. torch + CUDA 是否可用
  5. 磁盘剩余空间（FLUX.1-schnell fp16 约 24GB，建议留 60GB 以上）
  6. 内存（建议 >= 16GB，模型加载与 CPU 卸载都要用）
  7. ComfyUI 是否可达（--comfy-url）

依赖：只用标准库；requests 可选（用于第 7 项）
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys

MIN_VRAM_GB = 12        # FLUX.1-schnell fp16 的门槛（文档 §10.1 T4）
RECOMMEND_VRAM_GB = 16  # 留余量，后续还能上更大的模型
MIN_DISK_GB = 60        # 模型 ~24GB + ComfyUI + 缓存
MIN_RAM_GB = 16

results = []


def record(name, ok, detail, level="required"):
    """level: required（不过就没法跑） / advisory（建议）"""
    results.append({"name": name, "ok": ok, "detail": detail, "level": level})


def check_gpu():
    smi = shutil.which("nvidia-smi")
    if not smi:
        record("NVIDIA 显卡", False, "找不到 nvidia-smi：没装驱动，或这张卡不是 NVIDIA")
        return
    try:
        out = subprocess.run(
            [smi, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=20)
    except Exception as e:
        record("NVIDIA 显卡", False, "nvidia-smi 执行失败：%s" % e)
        return
    if out.returncode != 0 or not out.stdout.strip():
        record("NVIDIA 显卡", False, "nvidia-smi 无输出（驱动可能没装好）")
        return

    for line in out.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        name = parts[0] if parts else "未知"
        vram = parts[1] if len(parts) > 1 else "?"
        drv = parts[2] if len(parts) > 2 else "?"
        try:
            vram_gb = float(vram.lower().replace("mib", "").replace("gb", "").strip()) / 1024
        except ValueError:
            vram_gb = 0
        ok = vram_gb >= MIN_VRAM_GB
        record("NVIDIA 显卡", ok,
               "%s ｜ 显存 %.1fGB ｜ 驱动 %s（门槛 %dGB，建议 %dGB）"
               % (name, vram_gb, drv, MIN_VRAM_GB, RECOMMEND_VRAM_GB))
        record("驱动版本", True, drv + "（能跑 nvidia-smi 就说明驱动正常；建议保持厂商最新版）")


def check_python():
    v = sys.version_info
    ver = "%d.%d.%d" % (v.major, v.minor, v.micro)
    good = (v.major, v.minor) in ((3, 10), (3, 11))
    record("Python 版本", good,
           ver + ("（可用）" if good else "（建议 3.10 或 3.11：3.13 装不上 torch 官方 wheel）"))


def check_torch():
    try:
        import torch
    except Exception:
        record("torch + CUDA", False, "未安装 torch（装法见 docs/配图引擎选型需求.md §15.3）")
        return
    cuda = torch.cuda.is_available()
    detail = "torch %s ｜ CUDA 可用=%s" % (torch.__version__, cuda)
    if cuda:
        detail += " ｜ %s ｜ CUDA %s" % (torch.cuda.get_device_name(0), torch.version.cuda)
    record("torch + CUDA", cuda, detail)


def check_disk():
    try:
        usage = shutil.disk_usage(os.getcwd())
        free_gb = usage.free / (1024 ** 3)
        ok = free_gb >= MIN_DISK_GB
        record("磁盘空间", ok, "当前盘可用 %.1fGB（建议 >= %dGB 放模型）" % (free_gb, MIN_DISK_GB))
    except Exception as e:
        record("磁盘空间", False, "读不到：%s" % e)


def check_ram():
    if platform.system() != "Windows":
        record("内存", True, "非 Windows，跳过（建议 >= %dGB）" % MIN_RAM_GB, level="advisory")
        return
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)"],
            capture_output=True, text=True, timeout=20)
        gb = float(out.stdout.strip())
        ok = gb >= MIN_RAM_GB
        record("内存", ok, "%.1fGB（建议 >= %dGB）" % (gb, MIN_RAM_GB), level="advisory")
    except Exception as e:
        record("内存", False, "读不到：%s" % e, level="advisory")


def check_comfy(url):
    try:
        import requests
    except ImportError:
        record("ComfyUI 可达", False, "没装 requests，跳过检查", level="advisory")
        return
    try:
        r = requests.get(url.rstrip("/") + "/system_stats", timeout=5)
        record("ComfyUI 可达", r.status_code == 200,
               "%s → HTTP %s" % (url, r.status_code), level="advisory")
    except Exception as e:
        record("ComfyUI 可达", False, "%s 连不上：%s（ComfyUI 没启动？）" % (url, type(e).__name__),
               level="advisory")


def main():
    ap = argparse.ArgumentParser(description="文生图环境预检")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    args = ap.parse_args()

    check_gpu()
    check_python()
    check_torch()
    check_disk()
    check_ram()
    check_comfy(args.comfy_url)

    print("=== 文生图环境预检 ===")
    failed_required = 0
    for r in results:
        mark = "PASS" if r["ok"] else ("FAIL" if r["level"] == "required" else "WARN")
        print("  [%s] %-12s %s" % (mark, r["name"], r["detail"]))
        if not r["ok"] and r["level"] == "required":
            failed_required += 1

    print("---")
    if failed_required:
        print("  有 %d 项硬性不达标 → 现在还跑不了质量档，先按上面提示补齐" % failed_required)
        print("  （本机若为 2GB 显存的笔记本，说明这台机器不适合，需另配机器，见文档 §15）")
        sys.exit(1)
    # 注意：输出里不要写 emoji —— Windows 的 GBK 控制台打不出会直接抛异常（错题本 ③）
    print("  硬性项全部达标（够跑；出图质量还要按文档 §11 阶段 B 实测）")
    sys.exit(0)


if __name__ == "__main__":
    main()
