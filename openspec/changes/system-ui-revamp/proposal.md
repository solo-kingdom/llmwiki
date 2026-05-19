## Why

当前 Web UI 在信息架构与交互样式上不统一：顶部使用 Tab 组件承担主导航、Chat 的模型选择与发送操作割裂、Session 管理区域占位过重、Jobs 与 Settings 页面宽度与对齐策略不一致、Wiki 缺少右侧大纲结构，整体观感“功能可用但不协调”。随着摄入、会话与文档浏览功能持续扩展，统一 UI 骨架与核心交互已成为提升可用性与维护效率的高优先级事项。

## What Changes

- 移除顶部 Tab Group 式主导航，改为语义化导航按钮组，统一页面级导航视觉与交互。
- 重构 Ingest Chat 顶部配置区：移除独立下拉条，将模型选择入口迁移到发送区附近，以“按钮 + 模态框”完成 Provider/Model 选择。
- 在 Chat 输入区展示当前已选 provider/model 的灰色状态标识，强化上下文可见性。
- 重构 Session 管理入口：由左侧重型列表改为“切换按钮 + 添加按钮”双入口，降低噪声并贴近会话主流程。
- 调整 Jobs 与 Settings 页面容器策略：统一内容宽度与居中布局，消除页面尺度不一致问题。
- 升级 Wiki 为三栏布局：左侧目录树、中间正文、右侧大纲，增强文档浏览和定位体验。

## Capabilities

### New Capabilities
- `wiki-outline-panel-ui`: 为 Wiki 页面引入右侧大纲面板能力，支持基于文档标题结构的导航与定位。

### Modified Capabilities
- `web-ui`: 主导航形态与页面级布局容器策略调整，统一全站视觉骨架。
- `ingest-chat-ui`: Chat 输入区与会话相关操作重排，强调发送主路径。
- `model-selection-ui`: 模型选择交互从静态下拉改为按钮触发模态框流程，并增加已选状态展示。
- `chat-sidebar-ui`: Session 管理入口由左栏主承载调整为轻量操作入口（切换/新增）。
- `jobs-page-ui`: 页面宽度与内容对齐策略调整为与 Settings 一致。

## Impact

- **前端页面与布局**: `web/src/App.tsx`、`web/src/App.css`、`web/src/index.css`
- **Ingest 相关组件**: `web/src/components/IngestChat.tsx`、`web/src/components/ChatSidebar.tsx`、可能新增模型选择模态框组件
- **页面容器一致性**: `web/src/components/JobsPage.tsx`、`web/src/components/SettingsPage.tsx`
- **Wiki 浏览结构**: `web/src/components/Sidebar.tsx`、`web/src/components/DocumentViewer.tsx`、新增/扩展 Outline 组件
- **状态与类型**: `web/src/context/AppContext.tsx`、`web/src/types.ts`（如需补充 UI 状态类型）
