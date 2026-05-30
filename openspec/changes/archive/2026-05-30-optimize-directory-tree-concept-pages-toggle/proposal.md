## Why

当前 Wiki 左侧同时存在“实体列表”和“Pages 文档树”，但 Pages 中又包含实体文档，造成信息层级重叠与认知负担。需要将抽象知识视图（实体/概念/概览）与文档视图（Pages）拆分，并提供显式切换，提升浏览与定位效率。

## What Changes

- 在 Wiki 左侧导航新增“概念 / Pages”视图切换开关，避免同一内容在不同区域重复出现。
- 默认进入“概念”视图，集中展示 `entity`、`concept` 与 `overview` 类型内容，作为知识理解入口。
- “Pages”视图仅展示文档树，并保持按页面类型组织与筛选的既有能力。
- 在切换视图时保持当前文档阅读状态不丢失（不强制跳转文档）。
- 调整文案与交互提示，使用户清晰理解两个视图的职责边界。

## Capabilities

### New Capabilities
- `wiki-sidebar-navigation-modes`: 定义 Wiki 左侧导航在“概念视图”和“Pages 视图”之间切换的行为与默认策略。

### Modified Capabilities
- `wiki-reader-ui`: 调整侧边栏导航结构，避免实体列表与文档树重复承载实体内容，并明确默认展示概念视图。

## Impact

- 前端 UI：`web/src/components/DocumentViewer.tsx`、`web/src/App.css` 及相关侧边栏组件逻辑。
- 测试：补充或调整 Wiki reader 相关单测（例如视图切换默认态、筛选生效范围、列表渲染差异）。
- 规格：新增侧边栏视图模式能力 spec，并更新 `wiki-reader-ui` 对侧边栏组成和默认行为的要求。
