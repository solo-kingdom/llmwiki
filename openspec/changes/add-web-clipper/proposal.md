## Why

Karpathy 推荐 Obsidian Web Clipper 获取网页源；nashsu 和 lcasastorian 提供 Chrome Extension 一键剪藏。当前用户需手动复制粘贴或下载 HTML，Web UI 摄入效率低。属于 P2-1 体验增强，在核心闭环稳定后实施。

## What Changes

- 新增 `extension/` 目录：Chrome Extension (Manifest V3)
- Readability 提取正文 + Turndown 转 Markdown
- 通过 HTTP API 提交到 llmwiki 服务（ingest endpoint）
- 配置：服务 URL、workspace token（若启用）
- 中文 popup UI

## Scope

### In Scope

- MV3 extension：content script + popup + service worker
- 剪藏当前页 → Markdown → POST ingest API
- 设置页：server URL 配置
- 基础错误提示

### Out of Scope

- Firefox/Safari 扩展
- 离线队列
- 图片下载到 raw/assets/（后续增强）
- WXT 框架（可用原生 MV3 或 WXT，实现时定）

## Capabilities

### New Capabilities

- `web-clipper-extension`: Chrome 剪藏扩展

## Dependencies

- `fix-ingest-job-cache`（ingest API 稳定）
- 远程 serve 场景可能需要 HTTP token auth（独立 future change）
