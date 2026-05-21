## Context

参考：
- nashsu: Readability.js + Turndown + Tauri HTTP
- lcasastorian: WXT + FastAPI ingest

本项目 ingest API 已支持 Web 文本/文件提交（ingest hub）。扩展只需调用现有 REST 端点。

## Goals / Non-Goals

**Goals:**

- 一键剪藏当前页为 Markdown 并提交 ingest job
- 配置 llmwiki serve URL（默认 localhost:8868）
- 中文 popup 反馈（成功/失败/job id）

**Non-Goals:**

- 扩展内嵌 LLM
- 批量标签页剪藏

## Decisions

### Decision 1: 技术栈

```
extension/
├── manifest.json       (MV3)
├── src/
│   ├── background.ts   (service worker)
│   ├── content.ts      (Readability extract)
│   ├── popup.html/ts   (UI + settings)
│   └── api.ts          (POST ingest)
├── package.json
└── README.md
```

使用 Vite 构建或 WXT（与 lcasastorian 对齐）。

### Decision 2: Ingest 提交格式

POST 到现有 ingest 文本端点（与 Web TextIngestDialog 相同）：

```json
{
  "title": "页面标题",
  "content": "# 标题\n\n正文 markdown...",
  "source_url": "https://..."
}
```

canonical path: `raw/sources/web-clip-{timestamp}.md`

### Decision 3: 认证

首版：无 token（localhost 开发）
后续：popup 配置 Bearer token（依赖 HTTP auth change）

### Decision 4: 正文提取

- `@mozilla/readability` 或等价库
- `turndown` 转 Markdown
- 保留页面 title 和 source URL 在 frontmatter

## Risks

| 风险 | 缓解 |
|------|------|
| CORS | llmwiki 已有 CORS 配置 |
| 动态 SPA 页面提取失败 | 提示用户手动选择 |
| MV3 service worker 限制 | 使用 fetch from background |
