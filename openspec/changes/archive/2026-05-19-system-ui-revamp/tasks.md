## 1. 全局导航与页面骨架

- [x] 1.1 重构 `web/src/App.tsx`：移除 Tabs 视觉组件作为主导航承载，改为按钮式四入口（Ingest / Jobs / Wiki / Settings）
- [x] 1.2 统一 header 结构与样式 token，保持居中浮层风格并确保 active 入口视觉可识别
- [x] 1.3 验证默认进入 Ingest 页面，且依赖告警入口仍可在导航中显示

## 2. 页面容器统一（Jobs / Settings）

- [x] 2.1 抽取统一页面内容容器样式（如 `max-w-* + mx-auto + px-*`）并复用到 Jobs 与 Settings 页面
- [x] 2.2 调整 `web/src/components/JobsPage.tsx`，确保任务筛选与列表在统一容器中居中展示
- [x] 2.3 调整 `web/src/components/SettingsPage.tsx` 外层结构，与 Jobs 页面保持同宽同对齐策略

## 3. Ingest Chat 模型选择重构

- [x] 3.1 修改 `web/src/components/IngestChat.tsx`，移除顶部 instance/model 下拉区
- [x] 3.2 新增模型选择模态框组件（Provider + Model 两级选择）并接入 `loadModels` 与 `updateSessionLLM`
- [x] 3.3 在发送区附近增加模型入口按钮，并在聊天输入区附近显示灰色 provider/model 状态标识
- [x] 3.4 验证无 provider instance 时的引导提示与禁用状态

## 4. Session 管理入口轻量化

- [x] 4.1 将当前左侧重型 session 列表改造为“切换按钮 + 新建按钮”主入口形态
- [x] 4.2 实现会话切换弹层/模态，接入 `listSessions`、`switchSession`，并保留当前 session 高亮
- [x] 4.3 保持新建会话行为与最近模型继承逻辑（`createSession` + settings 最近值）不回归

## 5. Wiki 三栏布局与右侧大纲

- [x] 5.1 重构 Wiki 页面布局为左目录树、中正文、右大纲三栏结构
- [x] 5.2 新增/扩展右侧大纲组件：根据当前文档标题生成层级并支持点击滚动定位
- [x] 5.3 为小屏场景提供可降级策略（右侧大纲折叠或抽屉），确保正文可读性不回归

## 6. 状态管理与类型收敛

- [x] 6.1 检查并补充 `web/src/context/AppContext.tsx` 中会话、模型选择、弹层状态所需的数据流
- [x] 6.2 必要时更新 `web/src/types.ts`，为新的 UI 状态展示或选择流程补充类型定义
- [x] 6.3 清理不再使用的旧状态字段与无效 UI 逻辑，避免双入口并存导致行为冲突

## 7. 测试与验收

- [x] 7.1 更新前端测试（至少覆盖导航切换、模型选择入口、session 切换入口、Jobs/Settings 容器一致性）
- [x] 7.2 手动验收：模型选择模态流程、发送区状态标识、session 切换/新增、Wiki 三栏与大纲定位
- [x] 7.3 运行前端测试命令并确认无回归（如 `npm test` 或项目既有测试命令）
