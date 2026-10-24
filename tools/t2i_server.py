#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
t2i_server.py —— 文生图（Text-to-Image）独立服务
=================================================

为什么要单独一个进程：
  质量档引擎（ComfyUI + FLUX.1-schnell）吃显存、启动慢、偶尔会崩。
  让它跟新闻服务（start-server.ps1）挤在一个进程里，一次 OOM 就会把整个简报拖挂。
  所以按 docs/配图引擎选型需求.md §6 的要求做成**独立常驻进程 + HTTP 接口**：
  它挂了，新闻服务照常出简报，前端自动退回代码生成的保底图。

接口契约（与 js/aiImage.js 现有调用**完全一致**，前端零改动）：
  POST /api/ai-image
      入：{"id":"n1a2b3c","category":"科技","keywords":["芯片"],"prompt":"……"}
      出：{"ok":true,"url":"assets/images/gen/n1a2b3c.png","from":"t2i","meta":{……}}
      出：{"ok":false,"error":"CIRCUIT_OPEN","message":"……"}
      ⚠️ 失败也返回 HTTP 200（沿用项目既有约定）：前端按 ok 字段判断，
         不会把 HTTP 错误当成页面崩溃。
  GET  /health
      出：{"ok":true,"dry_run":false,"circuit":"closed","comfy":true,"queue":0}

两种模式：
  · normal  ：真的调 ComfyUI（需要 ≥12GB 显存的机器，见文档 §2 的本机实测结论）
  · dry-run ：不连 ComfyUI，用 Pillow 画一张**确定性**占位图，
              用来在没有 GPU 的机器上验证「契约 / 队列 / 缓存 / 熔断 / 后处理」。

依赖：标准库 + requests + pillow（**不需要 torch**）
"""

import argparse
import io
import json
import os
import sys
import threading
import time
import uuid
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import requests
except ImportError:  # pragma: no cover
    print("缺少 requests，请先 pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover
    print("缺少 pillow，请先 pip install pillow", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT_DIR = os.path.join("assets", "images", "gen")

# 负向提示：与文档 §4 一致，重点是"画面里不许有文字/水印/Logo"，
# 以及"不许画出可识别的真人肖像"（时政新闻用象征意象代替）。
NEGATIVE_PROMPT = (
    "text, letters, words, numbers, watermark, logo, signature, frame, border, "
    "UI, chart, arrow, lowres, blurry, jpeg artifacts, deformed hands, extra limbs, "
    "realistic human face, portrait of a real person"
)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def log(msg, log_file=None):
    line = "[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line, flush=True)
    if log_file:
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass


def stable_seed(text):
    """同一个新闻 id 永远得到同一个 seed —— 保证结果可复现（文档 §7）"""
    return zlib.crc32(str(text).encode("utf-8")) % (2 ** 32)


def safe_id(raw):
    """只保留安全字符，防止路径穿越（沿用服务端的既有约定）"""
    keep = [c for c in str(raw or "") if c.isalnum() or c in "_-"]
    return "".join(keep)[:64] or ("news%s" % stable_seed(str(raw)))


def replace_placeholders(node, mapping):
    """递归替换工作流 JSON 里的占位符（$$PROMPT$$ 等）"""
    if isinstance(node, dict):
        return {k: replace_placeholders(v, mapping) for k, v in node.items()}
    if isinstance(node, list):
        return [replace_placeholders(v, mapping) for v in node]
    if isinstance(node, str):
        for key, val in mapping.items():
            node = node.replace(key, str(val))
        return node
    return node


def find_leftover_placeholders(node, found=None):
    found = found if found is not None else []
    if isinstance(node, dict):
        for v in node.values():
            find_leftover_placeholders(v, found)
    elif isinstance(node, list):
        for v in node:
            find_leftover_placeholders(v, found)
    elif isinstance(node, str) and "$$" in node:
        found.append(node)
    return found


# ---------------------------------------------------------------------------
# 熔断：连续失败到阈值就"跳闸"，当天不再拖累页面
# ---------------------------------------------------------------------------
class CircuitBreaker:
    def __init__(self, threshold=3, cooldown=600):
        self.threshold = threshold
        self.cooldown = cooldown
        self.fails = 0
        self.opened_at = 0.0
        self.lock = threading.Lock()

    def state(self):
        with self.lock:
            if self.opened_at and (time.time() - self.opened_at) < self.cooldown:
                return "open"
            if self.opened_at:
                self.opened_at = 0.0
                self.fails = 0
            return "closed"

    def record(self, ok):
        with self.lock:
            if ok:
                self.fails = 0
                self.opened_at = 0.0
            else:
                self.fails += 1
                if self.fails >= self.threshold:
                    self.opened_at = time.time()


# ---------------------------------------------------------------------------
# 出图：ComfyUI 通道
# ---------------------------------------------------------------------------
class ComfyBackend:
    """调用 ComfyUI 的 HTTP API（/prompt → /history → /view）

    工作流 JSON 需要你自己从 ComfyUI 导出（"Save API Format"），
    里面放 $$PROMPT$$ / $$NEGATIVE$$ / $$SEED$$ / $$WIDTH$$ / $$HEIGHT$$ 占位符，
    做法见 docs/workflows/README.md —— 不在这里硬编码节点图，
    因为 ComfyUI 的节点结构随版本变，写死容易出假工作流。
    """

    def __init__(self, base_url, workflow_path, timeout=90, filename_prefix="news"):
        self.base = base_url.rstrip("/")
        self.workflow_path = workflow_path
        self.timeout = timeout
        self.filename_prefix = filename_prefix

    def _load_workflow(self):
        # utf-8-sig：Windows 上导出/保存的 JSON 常带 BOM，
        # 用 utf-8 读会直接报 "Unexpected UTF-8 BOM"（2026-10-24 实测踩到）
        with open(self.workflow_path, "r", encoding="utf-8-sig") as f:
            return json.load(f)

    def generate(self, prompt, negative, seed, width, height):
        try:
            graph = self._load_workflow()
        except (OSError, ValueError) as e:
            raise RuntimeError("工作流文件读不了（%s）：%s" % (self.workflow_path, e))

        graph = replace_placeholders(graph, {
            "$$PROMPT$$": prompt,
            "$$NEGATIVE$$": negative,
            "$$SEED$$": seed,
            "$$WIDTH$$": width,
            "$$HEIGHT$$": height,
            "$$FILENAME$$": self.filename_prefix,
        })
        leftover = find_leftover_placeholders(graph)
        if leftover:
            raise RuntimeError(
                "工作流里还有没替换的占位符（检查是否漏写）：%s" % ", ".join(sorted(set(leftover))[:5])
            )

        r = requests.post(self.base + "/prompt",
                          json={"prompt": graph, "client_id": str(uuid.uuid4())},
                          timeout=15)
        r.raise_for_status()
        prompt_id = r.json().get("prompt_id")
        if not prompt_id:
            raise RuntimeError("ComfyUI 没返回 prompt_id")

        deadline = time.time() + self.timeout
        while time.time() < deadline:
            time.sleep(1.0)
            try:
                hist = requests.get("%s/history/%s" % (self.base, prompt_id), timeout=10).json()
            except Exception:
                continue
            entry = hist.get(prompt_id)
            if not entry:
                continue
            outputs = entry.get("outputs") or {}
            for node_out in outputs.values():
                for img in node_out.get("images", []):
                    return self._fetch(img)
            raise RuntimeError("ComfyUI 任务完成但没有图片输出：%s" % list(outputs.keys()))
        raise RuntimeError("等 ComfyUI 出图超时（%ss）" % self.timeout)

    def _fetch(self, img):
        params = {
            "filename": img.get("filename", ""),
            "subfolder": img.get("subfolder", ""),
            "type": img.get("type", "output"),
        }
        r = requests.get(self.base + "/view", params=params, timeout=30)
        r.raise_for_status()
        return r.content


# ---------------------------------------------------------------------------
# 出图：dry-run 通道（无 GPU 时用，画一张确定性占位图）
# ---------------------------------------------------------------------------
def make_dryrun_image(seed, size):
    """画一张**确定性**的占位图：同一 id 每次都一样。
    只用来验证链路，画面本身不代表最终质量，也不含任何文字。"""
    w = h = size
    img = Image.new("RGB", (w, h), (250, 250, 252))
    draw = ImageDraw.Draw(img)
    rnd_state = (seed or 1) % 9973

    for y in range(h):
        t = y / max(h - 1, 1)
        shade = int(226 + 20 * t)
        draw.line([(0, y), (w, y)], fill=(shade, shade, min(255, shade + 6)))

    for i in range(6):
        rnd_state = (rnd_state * 1103515245 + 12345) % 2147483647
        cx = (rnd_state % max(w - 200, 1)) + 100
        rnd_state = (rnd_state * 1103515245 + 12345) % 2147483647
        cy = (rnd_state % max(h - 200, 1)) + 100
        rnd_state = (rnd_state * 1103515245 + 12345) % 2147483647
        rad = 60 + (rnd_state % 180)
        tone = 190 + (i * 9) % 60
        draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(tone, tone, min(255, tone + 14)))

    return img.filter(ImageFilter.GaussianBlur(1.2))


# ---------------------------------------------------------------------------
# 后处理：统一到 1200×1200 / 控体积
# ---------------------------------------------------------------------------
def postprocess(raw_bytes, out_path, size, max_bytes):
    img = Image.open(io.BytesIO(raw_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")

    if img.size != (size, size):
        # 文档 §3：原生 ≥1024² 时用 LANCZOS 重采样到 1200²（1.17×，可接受）；
        # 更小的图要先用 Real-ESRGAN 超分，不能只靠这里拉伸。
        img = img.resize((size, size), Image.LANCZOS)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, format="PNG", optimize=True)

    if os.path.getsize(out_path) > max_bytes:
        # 超重就转 JPEG（新闻配图不需要透明通道）
        jpg_path = os.path.splitext(out_path)[0] + ".jpg"
        img.save(jpg_path, format="JPEG", quality=88, optimize=True)
        out_path = jpg_path
    return out_path


# ---------------------------------------------------------------------------
# HTTP 服务
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_state = None  # 由 main() 注入：dict(cfg, breaker, backend, lock, stats)

    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # 默认日志太吵，关掉
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            st = self.server_state
            comfy_ok = False
            if st["backend"]:
                try:
                    requests.get(st["backend"].base + "/system_stats", timeout=3)
                    comfy_ok = True
                except Exception:
                    comfy_ok = False
            self._send({
                "ok": True,
                "dry_run": bool(st["cfg"].dry_run),
                "circuit": st["breaker"].state(),
                "comfy": comfy_ok,
                "generated": st["stats"]["generated"],
                "failed": st["stats"]["failed"],
            })
            return
        self._send({"ok": False, "error": "NOT_FOUND", "message": "只有 /health 和 /api/ai-image"}, 404)

    def do_POST(self):
        if not self.path.startswith("/api/ai-image"):
            self._send({"ok": False, "error": "NOT_FOUND", "message": "只有 /health 和 /api/ai-image"}, 404)
            return

        st = self.server_state
        cfg = st["cfg"]
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            req = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, OSError) as e:
            self._send({"ok": False, "error": "BAD_JSON", "message": "请求体不是合法 JSON：%s" % e})
            return

        nid = safe_id(req.get("id"))
        prompt = (req.get("prompt") or "").strip()
        if not prompt:
            self._send({"ok": False, "error": "EMPTY_PROMPT", "message": "缺少图片描述词（prompt）"})
            return

        # 熔断：跳闸期间直接拒绝，别让前端每条新闻都白等
        if st["breaker"].state() == "open":
            self._send({"ok": False, "error": "CIRCUIT_OPEN",
                        "message": "文生图服务连续失败已熔断，暂不调用（%ss 后重试）" % st["breaker"].cooldown})
            return

        out_dir = os.path.join(ROOT, cfg.out_dir)
        os.makedirs(out_dir, exist_ok=True)
        target = os.path.join(out_dir, nid + ".png")

        # 缓存：同一条新闻只生成一次
        for ext in (".png", ".jpg"):
            cached = os.path.join(out_dir, nid + ext)
            if os.path.isfile(cached):
                rel = os.path.relpath(cached, ROOT).replace("\\", "/")
                self._send({"ok": True, "url": rel, "from": "cache",
                            "meta": {"model": "dry-run" if cfg.dry_run else cfg.workflow, "seed": stable_seed(nid)}})
                return

        seed = stable_seed(nid + prompt)
        started = time.time()
        with st["lock"]:  # GPU 单并发，排队执行（文档 §5）
            try:
                if cfg.dry_run:
                    raw = None
                    img = make_dryrun_image(seed, cfg.size)
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    raw = buf.getvalue()
                else:
                    raw = st["backend"].generate(prompt, NEGATIVE_PROMPT, seed, cfg.width, cfg.height)
                final = postprocess(raw, target, cfg.size, cfg.max_bytes)
                st["stats"]["generated"] += 1
                st["breaker"].record(True)
            except Exception as e:
                st["stats"]["failed"] += 1
                st["breaker"].record(False)
                log("出图失败 %s：%s" % (nid, e), cfg.log)
                self._send({"ok": False, "error": "GENERATE_FAILED", "message": str(e)[:300]})
                return

        rel = os.path.relpath(final, ROOT).replace("\\", "/")
        log("出图完成 %s → %s（%.1fs）" % (nid, rel, time.time() - started), cfg.log)
        self._send({
            "ok": True,
            "url": rel,
            "from": "t2i",
            "meta": {
                "model": "dry-run" if cfg.dry_run else os.path.basename(cfg.workflow or ""),
                "seed": seed,
                "size": cfg.size,
                "elapsed_ms": int((time.time() - started) * 1000),
            },
        })


def main():
    ap = argparse.ArgumentParser(description="文生图独立服务（质量档引擎接入层）")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8020)
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188", help="ComfyUI 地址")
    ap.add_argument("--workflow", default="", help="ComfyUI 工作流 JSON（含 $$PROMPT$$ 等占位符）")
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="输出目录（相对项目根）")
    ap.add_argument("--size", type=int, default=1200, help="最终输出边长（正方形）")
    ap.add_argument("--width", type=int, default=1024, help="送进模型的宽")
    ap.add_argument("--height", type=int, default=1024, help="送进模型的高")
    ap.add_argument("--timeout", type=int, default=90, help="等 ComfyUI 出图的秒数")
    ap.add_argument("--max-bytes", type=int, default=1572864, help="单张体积上限（默认 1.5MB）")
    ap.add_argument("--log", default=os.path.join(".data", "t2i.log"))
    ap.add_argument("--dry-run", action="store_true", help="不连 ComfyUI，画确定性占位图（用于验证链路）")
    args = ap.parse_args()

    if args.log:
        os.makedirs(os.path.dirname(os.path.join(ROOT, args.log)) or ".", exist_ok=True)
    args.log = os.path.join(ROOT, args.log) if args.log else None

    if not args.dry_run and not args.workflow:
        ap.error("非 dry-run 模式必须用 --workflow 指定工作流 JSON（导出方法见 docs/workflows/README.md）")

    backend = None
    if not args.dry_run:
        backend = ComfyBackend(args.comfy_url, args.workflow, timeout=args.timeout)

    Handler.server_state = {
        "cfg": args,
        "breaker": CircuitBreaker(threshold=3, cooldown=600),
        "backend": backend,
        "lock": threading.Lock(),
        "stats": {"generated": 0, "failed": 0},
    }

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    log("文生图服务已启动 http://%s:%s （%s）" % (
        args.host, args.port, "dry-run 占位图模式" if args.dry_run else "ComfyUI %s" % args.comfy_url), args.log)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
