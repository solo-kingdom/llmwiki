## Why

当前 Wiki 侧边栏导航存在三个体验问题：1) 模式标签"概念"对用户含义不直观，无法清晰传达该视图展示的是 Wiki 知识内容；2) 概念模式下仅展示"实体"列表标题，缺少对概念(Concept)类型的分组展示，用户无法区分浏览实体和概念；3) Wiki 模式（原概念模式）不应提供页面类型筛选，因为该视图聚焦于知识浏览而非文档管理。这些优化将提升 Wiki 导航的清晰度和可用性。

## What Changes

- **Tab 标签重命名**：将侧边栏模式切换标签从"概念 / Pages"改为"Wiki / 页面"（中文）/ "Wiki / Pages"（英文）
- **Wiki 模式内容分组展示**：Wiki 模式下将实体(Entities)和概念(Concepts)分开展示为两个独立列表区块，各有独立的标题和计数
- **移除 Wiki 模式页面类型筛选**：Wiki 模式下不再显示页面类型筛选器（WikiTypeFilter），仅在 Pages/页面模式下保留筛选功能
- 默认模式保持不变（仍为 Wiki 模式，原概念模式）

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `wiki-sidebar-navigation-modes`: 修改模式标签命名规则（概念→Wiki）和 Wiki 模式的内容展示要求（实体与概念分组展示），以及移除 Wiki 模式下的页面类型筛选器
- `wiki-reader-ui`: 更新侧边栏实体列表的需求描述，要求 Wiki 模式下实体和概念分组展示，并明确 Wiki 模式不显示页面类型筛选

## Impact

- **前端组件**：`Sidebar.tsx`（模式切换标签）、`WikiEntityList.tsx`（分组展示逻辑）、`WikiTypeFilter.tsx`（条件渲染）
- **状态管理**：`WikiReaderContext.tsx`（可能需调整默认模式和筛选逻辑）
- **类型常量**：`wiki-page-types.ts`（NavigationMode 类型值从 `"concept"` 改为 `"wiki"`）
- **国际化**：`zh.ts` / `en.ts`（新增/修改翻译键）
- **测试**：`wiki-reader.test.tsx`（需更新相关测试用例）
