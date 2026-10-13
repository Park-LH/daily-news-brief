# 📰 每日新闻简报（press message）

这是一个零基础也能用的网页小应用：点一下按钮，自动抓取当天的中文新闻，
按「科技 / 财经 / 生活」三个板块整理成一份最多 10 条的简报。

## 怎么使用

1. 双击打开 `index.html`（用浏览器打开即可，无需安装任何软件）
2. 点击紫色按钮「生成今日简报」
3. 等待 1~3 秒，简报生成完毕
4. 点击任意新闻标题，可在新标签页打开原文

## 新闻来源（RSS）

| 来源 | 分类 | 地址 |
|---|---|---|
| 36氪 | 科技 | https://36kr.com/feed |
| 少数派 | 科技 | https://www.sspai.com/feed |
| 虎嗅 | 科技 | https://www.huxiu.com/rss/0.xml |
| 华尔街见闻 | 财经 | https://dedicated.wallstreetcn.com/rss.xml |
| 知乎每日精选 | 生活 | https://www.zhihu.com/rss |

想换新闻源：打开 `js/config.js`，按注释修改即可。

## 项目结构

```
daily-news-brief/
├── press message.md   ← 本说明文件（你正在看的这个）
├── index.html         ← 入口页面，双击打开它
├── css/
│   └── style.css      ← 样式（防窥玻璃马赛克粉蓝背景）
└── js/
    ├── config.js      ← RSS 源配置 + AI 摘要预留接口
    ├── rss.js         ← RSS 抓取工具
    └── app.js         ← 主逻辑：按钮、抓取、渲染
```

## 技术说明（给想改代码的你）

- 纯 HTML / CSS / JavaScript，不需要安装环境、不需要后端
- RSS 抓取通过免费公共接口 rss2json 完成（自动把 RSS 转成好处理的 JSON）
- AI 摘要功能已预留接口：`js/config.js` 中的 `generateSummary()` 函数，
  目前直接返回 RSS 自带摘要；以后接入 AI 只需改这一个函数

## 注意事项

- 需要联网才能抓新闻；部分源偶尔不稳定，页面会提示哪个源失败了，不影响其他源
- 数据来自公开 RSS 源，仅供个人学习使用
