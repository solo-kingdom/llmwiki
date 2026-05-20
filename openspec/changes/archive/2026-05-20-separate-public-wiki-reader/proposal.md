## Why

当前 Web UI 将 `Wiki` 与 `Ingest`、`Jobs`、`Settings` 放在同一个顶部导航与同一个应用壳中。这个结构适合早期功能验证，但不符合 Wiki 的产品属性：Wiki 页面主要用于阅读和展示，甚至需要支持公开访问；而摄入、任务、模型配置等页面属于管理工作台，应保留更严格的访问边界和更强的操作语义。

同时，现有 Wiki 阅读体验仍偏工具页面：左中右三栏已经具备雏形，但整体视觉密度、文档卡片、目录树、右侧大纲、滚动细节与 Markdown 呈现都不如参考项目 `mdserve` 成熟。若继续把 Wiki 作为工作台 tab 打磨，会让公开展示、只读访问与管理操作之间的边界越来越模糊。

## What Changes

- 将 Wiki 从普通 tab 语义提升为独立阅读器入口，与管理工作台形成明确边界。
- 新增可选的公开 Wiki 只读访问模式：允许未携带管理 token 的用户访问公开阅读器与公开只读文档 API。
- 保留 `Ingest`、`Jobs`、`Settings` 作为管理工作台入口，继续受现有 token 保护。
- 参考 `mdserve` 全面升级 Wiki UI：顶部阅读器 header、圆角卡片式三栏布局、浅墨绿色文档信息栏、可折叠左侧目录树、可折叠右侧大纲、正文滚动体验与 Markdown 样式。
- 调整前端信息架构，使 `/wiki` 更像可分享的阅读站点，`/app` 或根管理壳更像私有操作后台。

## Capabilities

### New Capabilities
- `wiki-reader-ui`: 独立 Wiki 阅读器界面，面向阅读与展示，不承载摄入、任务、设置等管理操作。
- `public-wiki-access`: 可选公开只读访问能力，为 Wiki 提供不依赖管理 token 的安全读取路径。
- `markdown-reader-polish`: Markdown 阅读体验升级，参考 `mdserve` 的文档卡片、信息栏、代码块、滚动和大纲交互。

### Modified Capabilities
- `web-app-shell`: 全局应用壳区分管理工作台与 Wiki 阅读器，不再把 Wiki 仅作为同级管理 tab 处理。

## Impact

- **前端应用壳**: `web/src/App.tsx`、可能新增 reader/workbench layout 组件，必要时引入轻量路径状态或路由判断。
- **Wiki 组件**: `web/src/components/WikiPage.tsx`、`Sidebar.tsx`、`DocumentViewer.tsx`、`DocumentOutline.tsx`，以及可能新增折叠按钮、文档信息栏、阅读器 header 组件。
- **前端样式**: `web/src/App.css` / `web/src/index.css`，补充 `mdserve` 风格的 point color、卡片、滚动条、Markdown 内联代码和代码块样式。
- **前端 API**: `web/src/lib/api.ts`，新增公开只读 API 调用路径，避免公开页面触达管理接口。
- **后端路由与鉴权**: `internal/server/server.go`，在 token auth 中区分公开 Wiki 只读端点与管理端点。
- **后端 API**: `internal/api` 相关文档读取与搜索 handler，可复用现有查询逻辑但通过公开只读路由暴露。
- **测试**: 后端鉴权/公开只读 API 测试，前端导航与 Wiki 阅读器布局测试。
