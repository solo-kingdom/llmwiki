## 1. Extension 脚手架

- [ ] 1.1 创建 `extension/` 目录与 MV3 manifest
- [ ] 1.2 配置 Vite/WXT 构建流程
- [ ] 1.3 README：安装与开发说明

## 2. 内容提取

- [ ] 2.1 content script：Readability 提取正文
- [ ] 2.2 Turndown 转 Markdown
- [ ] 2.3 携带 page title 和 URL metadata

## 3. API 集成

- [ ] 3.1 background/service worker POST ingest API
- [ ] 3.2 复用 Web ingest 文本端点契约
- [ ] 3.3 canonical path 生成策略

## 4. Popup UI

- [ ] 4.1 剪藏按钮 + 加载状态
- [ ] 4.2 设置：server URL（localStorage）
- [ ] 4.3 中文成功/错误反馈

## 5. 测试与验收

- [ ] 5.1 单元测试：Markdown 转换 fixture
- [ ] 5.2 手工验收：剪藏文章页 → Jobs 页可见 job
- [ ] 5.3 手工验收：server URL 配置持久化
