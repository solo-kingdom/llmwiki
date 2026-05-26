## 1. Extension 脚手架

- [x] 1.1 创建 `extension/` 目录与 MV3 manifest
- [x] 1.2 配置 Vite/WXT 构建流程
- [x] 1.3 README：安装与开发说明

## 2. 内容提取

- [x] 2.1 content script：Readability 提取正文
- [x] 2.2 Turndown 转 Markdown
- [x] 2.3 携带 page title 和 URL metadata

## 3. API 集成

- [x] 3.1 background/service worker POST ingest API
- [x] 3.2 复用 Web ingest 文本端点契约
- [x] 3.3 canonical path 生成策略

## 4. Popup UI

- [x] 4.1 剪藏按钮 + 加载状态
- [x] 4.2 设置：server URL（localStorage）
- [x] 4.3 中文成功/错误反馈

## 5. 测试与验收

- [x] 5.1 单元测试：Markdown 转换 fixture
- [x] 5.2 手工验收：剪藏文章页 → Jobs 页可见 job
- [x] 5.3 手工验收：server URL 配置持久化
