# ComfyUI 工作流文件（放这里）

`tools/t2i_server.py` 需要一个**工作流 JSON** 才知道该怎么出图。
这个文件由你自己从 ComfyUI 导出，不放进仓库默认内容——
因为 ComfyUI 的节点结构随版本变，硬编码一份写死的节点图很容易变成"看起来能跑、
实际报错"的假工作流。

## 导出步骤

1. 在 ComfyUI 里把出图流程搭好（加载模型 → 写提示词 → 采样 → 保存图片）
2. 菜单 **Workflow → Export (API Format)**（不同版本可能叫 "Save (API Format)"）
3. 把导出的 JSON 存到本目录，例如 `flux_schnell_1024.json`
4. 用下面的占位符替换里面的固定值：

| 占位符 | 替换成 | 一般出现在哪个节点 |
|---|---|---|
| `$$PROMPT$$` | 新闻的提示词 | `CLIPTextEncode`（正向） |
| `$$NEGATIVE$$` | 负向提示（服务端已内置模板） | `CLIPTextEncode`（负向） |
| `$$SEED$$` | 随机种子（由新闻 id 推导，保证可复现） | `KSampler` / `RandomNoise` |
| `$$WIDTH$$` | 送进模型的宽（默认 1024） | `EmptyLatentImage` |
| `$$HEIGHT$$` | 送进模型的高（默认 1024） | `EmptyLatentImage` |
| `$$FILENAME$$` | 输出文件名前缀 | `SaveImage` |

## 启动服务

```powershell
python tools/t2i_server.py --port 8020 --workflow docs/workflows/flux_schnell_1024.json
```

- 服务会**自动检查占位符**：还有没替换的 `$$XXX$$` 会直接报错并列出名字，不会默默出一张错图
- JSON 带 BOM 也能读（服务端用 `utf-8-sig`，Windows 保存的文件常有 BOM）
- 没有 GPU 想先验证链路：`python tools/t2i_server.py --dry-run`（画确定性占位图）

## 版本锁定（PoC 通过后必填）

工作流出图效果达标后，把下面这些记进 `docs/配图引擎选型需求.md` §14.3，
否则下次 ComfyUI 一升级，同一份工作流可能就出不来同样的图：

- ComfyUI 版本号
- 模型权重文件名 + 来源 URL + 量化方式 + sha256
- 本工作流 JSON 的 sha1（`certutil -hashfile 文件名 SHA1`）
