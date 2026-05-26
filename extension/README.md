# LLM Wiki Web Clipper

Chrome 扩展（Manifest V3）：将当前网页正文提取为 Markdown，并提交到 llmwiki 的文本 ingest API。

## 前置条件

- Node.js 18+
- 已运行 `llmwiki serve`（默认 `http://localhost:8868`）
- Google Chrome 或 Chromium 浏览器

## 开发

```bash
cd extension
npm install
npm run dev    # 监听构建到 dist/
npm run build  # 生产构建
npm test       # 单元测试（Markdown 转换 fixture）
```

## 安装（开发者模式）

1. 执行 `npm run build`
2. 打开 Chrome → `chrome://extensions`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `extension/dist` 目录

## 使用

1. 在 popup 中确认或修改 **服务地址**（默认 `http://localhost:8868`），点击「保存设置」
2. 打开要剪藏的文章页
3. 点击扩展图标 → **剪藏当前页**
4. 成功后 popup 显示任务 ID；在 llmwiki Web UI 的 Jobs 页可查看对应 ingest job

## API 契约

扩展调用与 Web UI `TextIngestDialog` 相同的端点：

```
POST {serverUrl}/api/v1/ingest/jobs/text
Content-Type: application/json

{
  "title": "页面标题",
  "content": "---\ntitle: ...\nsource_url: ...\n---\n\n# 标题\n\n正文...",
  "filename": "web-clip-20260521T083045.md",
  "source_ref": "https://example.com/article"
}
```

服务端会将文件写入 `raw/sources/web-clip-{timestamp}.md` 并创建 queued ingest job。

## 手工验收

### 剪藏文章页 → Jobs 可见

1. `llmwiki serve ~/your-workspace`
2. 加载扩展，打开一篇新闻/博客文章
3. 点击「剪藏当前页」
4. 在 `http://localhost:8868` → Ingest → Jobs 中确认出现新 job，`source_ref` 为页面 URL

### 服务地址持久化

1. 在 popup 将服务地址改为 `http://127.0.0.1:8868` 并保存
2. 关闭 popup 后重新打开
3. 确认地址仍为 `http://127.0.0.1:8868`

## 故障排查

| 现象 | 处理 |
|------|------|
| 「内容脚本未加载」 | 刷新目标页面后重试 |
| 「无法连接服务器」 | 确认 `llmwiki serve` 已启动，地址与端口正确 |
| 「无法提取正文」 | 页面可能是 SPA/列表页，换用文章详情页 |
