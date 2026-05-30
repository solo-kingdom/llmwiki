## Why

设置页已经承载 Provider、模型、规则、MCP、任务、日志、处理参数和版本控制等多类配置，但当前以长表单平铺，用户很难判断哪些是日常配置、哪些是高级/调试项。同时，管理工作台与 Wiki reader 的导航栏和内容宽度策略不同，需要把这种差异明确为产品设计决策，避免后续改动误把两者混为同一套布局。

## What Changes

- 优化 Settings 页面信息架构，将配置项按用户心智分组，区分常用配置、连接配置、自动化配置和高级配置。
- 改善 Settings 页面保存体验，提供更清晰的未保存状态、保存入口和保存反馈，减少长页面滚动带来的迷失感。
- 降低高级配置的默认噪音，将低频或高风险项以更清晰的高级区域呈现。
- 统一 Settings 页面中文 UI 文案和说明，减少英文裸文案与字段名暴露。
- 明确管理工作台继续使用居中的 `max-w-5xl` 内容列，Wiki reader 继续使用阅读优先的全屏三栏布局；两者保持视觉一致的 header 风格，但不强制等宽。
- 补充响应式要求，保证 Settings 页面在窄屏下不会因二栏设置或宽内容控件而破坏布局。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `web-ui`: 调整管理工作台 Settings 页面信息架构、保存体验、文案一致性，以及工作台内容列宽度要求。
- `wiki-reader-ui`: 明确 Wiki reader 与管理工作台不共享等宽内容列，保留阅读优先的全屏布局和三栏结构。

## Impact

- 主要影响 `web/src/components/SettingsPage.tsx`、`PageContainer.tsx`、`WorkbenchContentShell.tsx`、`WorkbenchLayout.tsx`、`WikiReaderLayout.tsx` 及相关 i18n 文案。
- 可能需要更新 Settings、导航/布局相关前端测试，尤其是宽度 class、设置项分组、保存状态和响应式行为。
- 不涉及后端 API、数据模型或持久化格式变更。
