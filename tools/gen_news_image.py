# -*- coding: utf-8 -*-
"""
gen_news_image.py —— 给缺图的新闻生成一张干净的 AI 配图
============================================================
原理（零基础解释）：
    浏览器里的 JS 不能直接调用 AI 图片生成（需要密钥），
    所以由本脚本代劳：
      1. 调用 CodeBuddy 内置的多模态生成脚本 buddy-cloud.py 出图
      2. 把生成的图片下载到 assets/images/gen/ 下（服务器可直接访问）
      3. 把这条记录写进素材库索引 assets/images/library.json，下次直接用

用法（在项目根目录执行）：
    python tools/gen_news_image.py ^
        --id n1a2b3c --category 科技 --keywords "芯片,研发" ^
        --prompt "新闻标题：……

也可以只传 --prompt-file，从文件里读 prompt（避免命令行太长）。

密钥：
    优先用 --token，其次读环境变量 BUDDY_CLOUD_TOKEN。
    没有密钥时不报错退出，而是输出 {"ok":false,...}，前端会保持干净空位。

输出（stdout，一行 JSON）：
    {"ok": true, "url": "assets/images/gen/n1a2b3c.png", "from": "generated"}
    {"ok": false, "error": "TOKEN_MISSING", "message": "..."}
"""

import argparse
import json
import os
import subprocess
import sys
import datetime

# 生成的图统一按这个宽高比描述（页面用 object-fit: cover 裁切显示）
# 列表缩略图是 1:1，沉浸封面是竖幅，所以要求主体居中、四周留白
SIZE_HINT = "竖幅或方形构图均可，主体居中，四周留出安全边距"


def find_script(cli_path=None):
    """确定 buddy-cloud.py 的位置（优先用项目自带的 tools/buddy-cloud.py）"""
    candidates = [
        cli_path,
        os.environ.get("BUDDY_CLOUD_SKILL"),
        os.path.join(project_root(), "tools", "buddy-cloud.py"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return None


def project_root():
    """项目根目录（本脚本放在 <root>/tools/ 下）"""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_library(root):
    path = os.path.join(root, "assets", "images", "library.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 1, "items": []}


def save_library(root, library):
    path = os.path.join(root, "assets", "images", "library.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def add_to_library(root, item):
    """把新生成的图登记进素材库，下次遇到同类新闻可直接复用"""
    library = load_library(root)
    items = library.setdefault("items", [])
    # 同一条新闻只保留一条记录
    items[:] = [x for x in items if x.get("id") != item.get("id")]
    items.append(item)
    library["version"] = 1
    save_library(root, library)


def generate_image_url(prompt, token, skill_script, python_exe):
    """调用生成服务，返回图片地址；失败抛异常"""
    cmd = [python_exe, skill_script, "image", prompt]
    if token:
        cmd += ["--token", token]

    proc = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=600,
    )
    stdout = (proc.stdout or "").strip()

    # 脚本的进度日志在 stderr，结果 JSON 在 stdout
    if proc.returncode != 0 and not stdout:
        raise RuntimeError((proc.stderr or "").strip()[-500:] or "生成脚本执行失败")

    try:
        data = json.loads(stdout)
    except Exception:
        raise RuntimeError("无法解析生成脚本的输出：" + stdout[:300])

    if data.get("error"):
        raise RuntimeError(data.get("message") or data.get("error"))

    # 生成服务返回的地址可能是字符串，也可能是地址数组，这里统一成字符串
    url = data.get("result_url") or data.get("url") or data.get("result_urls")
    if isinstance(url, list):
        url = url[0] if url else None
    if isinstance(url, str) and url.strip().startswith("["):
        try:
            parsed = json.loads(url)
            url = parsed[0] if isinstance(parsed, list) and parsed else url
        except Exception:
            pass
    if not url:
        raise RuntimeError("生成结果里没有图片地址：" + stdout[:300])
    return url


def ensure_pillow():
    """确保 Pillow 可用；没有就自动安装"""
    try:
        import PIL
        return PIL
    except ImportError:
        import subprocess, sys
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "Pillow", "-q"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        import PIL
        return PIL


def remove_bottom_watermark(src, ratio=0.08):
    """
    裁掉图片底部一小条，去除 AI 生成服务常加在右下角的"AI 生成"水印。
    ratio=0.08 表示裁掉底部 8%，对新闻配图来说通常不影响主体。
    """
    try:
        ensure_pillow()
        from PIL import Image
        img = Image.open(src)
        w, h = img.size
        crop_h = max(1, int(h * ratio))
        img.crop((0, 0, w, h - crop_h)).save(src, "PNG")
    except Exception:
        # 裁剪失败也不影响使用，最多只是水印还在
        pass


def download(url, dest):
    """把图片下载到本地；requests 不可用时退回标准库"""
    try:
        import requests
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        content = resp.content
    except ImportError:
        from urllib.request import urlopen
        with urlopen(url, timeout=120) as r:
            content = r.read()

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(content)

    # 下载完成后裁剪底部水印带（生成服务多数会加"AI 生成"角标）
    remove_bottom_watermark(dest)


def fail(error, message):
    print(json.dumps({"ok": False, "error": error, "message": message},
                     ensure_ascii=False))
    sys.exit(0)      # 退出码 0：这是"业务失败"，不让服务器把它当崩溃


def main():
    parser = argparse.ArgumentParser(description="为新闻生成 AI 配图")
    parser.add_argument("--id", required=True, help="新闻 id，用作文件名")
    parser.add_argument("--category", default="综合", help="新闻分类")
    parser.add_argument("--keywords", default="", help="关键词，逗号分隔")
    parser.add_argument("--prompt", default="", help="图片描述词")
    parser.add_argument("--prompt-file", default="", help="从文件读取描述词")
    parser.add_argument("--token", default="", help="生成服务密钥")
    parser.add_argument("--skill", default="", help="buddy-cloud.py 路径")
    parser.add_argument("--python", default=sys.executable, help="python 解释器")
    args = parser.parse_args()

    root = project_root()

    # prompt 也可以从文件读（内容长、含引号时更稳）
    prompt = args.prompt
    if args.prompt_file and os.path.isfile(args.prompt_file):
        with open(args.prompt_file, "r", encoding="utf-8") as f:
            prompt = f.read().strip()
    if not prompt:
        fail("EMPTY_PROMPT", "缺少图片描述词（--prompt 或 --prompt-file）")

    # 主体居中 + 四周留白，保证裁成方图/竖图都不会切掉主体
    full_prompt = prompt
    if SIZE_HINT not in prompt:
        full_prompt = prompt + SIZE_HINT + "。"

    # 已经生成过就直接复用（幂等）
    out_rel = os.path.join("assets", "images", "gen", args.id + ".png").replace("\\", "/")
    out_abs = os.path.join(root, out_rel)
    if os.path.isfile(out_abs):
        print(json.dumps({"ok": True, "url": out_rel, "from": "cached"},
                         ensure_ascii=False))
        return

    token = args.token or os.environ.get("BUDDY_CLOUD_TOKEN", "")
    if not token:
        fail("TOKEN_MISSING",
             "未配置生成服务密钥（设置环境变量 BUDDY_CLOUD_TOKEN，或用 --token 传入）")

    skill_script = find_script(args.skill)
    if not skill_script:
        fail("SKILL_NOT_FOUND",
             "找不到图片生成脚本 buddy-cloud.py，可用 --skill 指定路径")

    try:
        url = generate_image_url(full_prompt, token, skill_script, args.python)
        download(url, out_abs)
    except subprocess.TimeoutExpired:
        fail("TIMEOUT", "生成超时（超过 10 分钟）")
    except Exception as exc:
        fail("GENERATION_FAILED", str(exc))

    add_to_library(root, {
        "id": args.id,
        "category": args.category,
        "keywords": [k for k in args.keywords.split(",") if k],
        "file": out_rel,
        "prompt": full_prompt[:200],
        "source": "ai",
        "createdAt": datetime.date.today().isoformat(),
    })

    print(json.dumps({"ok": True, "url": out_rel, "from": "generated"},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
