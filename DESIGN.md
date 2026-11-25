# DESIGN

## 风格包

- 包与版本：`quiet-inset 0.6.15`（模板仓 `sunzhenkai/ui-templates-skill`，main `e5d0db4`；同批 workbench-shell 5.0.27）
- 一句话气质：安静的近中性三层面工作台——整页单页头、内容优先、密度紧凑、单一靛蓝强调色。

## 自定义（白名单内）

无。`src/styles/theme.css` 与风格包一致；唯一的项目侧代码改动见「偏离」（领域词表）。

校验：`validate_package.py project web` → 0 error（2026-11-22）

## 页面与页面模板

| 路由 | 页面模板 | 备注 |
| --- | --- | --- |
| `/`、`/chat/:id` | conversation | 会话列表（pane）+ 对话区；会话动作在页头 |
| `/jobs` | collection | |
| `/timeline` | collection | 详情用 Sheet |
| `/logs` | log-viewer | |
| `/settings` | settings | 重定向到 `/settings/models` |
| `/settings/:section` | settings | 6 分区：模型 / 摄入与检索 / 存储 / 访问控制 / 外部集成 / 规则文件；SectionLayout 导航 + 42rem 居中窄列 |
| `/wiki` | tree-nav | 左树：按主题自由建多级目录 + `page_type` 筛选；默认仅当前页祖先展开；支持增删改移、拖拽与定位展折 |
| `/wiki/:id` | reader | 单页头（真实目录面包屑）+ 正文（无卡片、不限宽）+ 右目录（滚动跟踪、可隐藏并持久化）；元信息（含 `page_type` 切换与移动）/引用/历史进页头弹窗 |
| `/wiki/graph` | canvas | 无卡片全宽；节点 hover 浮层；选中详情进页头弹窗 |
| `/archives`、`/archives/:id` | tree-nav + reader | 独立于 Wiki 逻辑层的「档案」文件树：支持多级目录管理、多格式直传/拖拽、在线预览（Markdown/HTML 沙箱/图片/音视频 Range/PDF/文本编辑）、下载与关联 Wiki 跳转 |
| `/help` | page | 章节目录用 NavList |

## 偏离

| 位置 | 偏离内容 | 理由 | 是否回馈模板 |
| --- | --- | --- | --- |
| `web/src/lib/vocab.ts` | 补充 job / review / revision / page type 等领域状态词 | 状态徽标统一取词表 | 否（领域词） |
| 阅读页正文宽度 | 不限宽（reader 默认 `full`） | 配合右侧目录与宽屏阅读 | 已回馈（reader pattern 默认 full） |
| `web/src/styles/ui-enhancements.css`、`web/src/lib/scrollbar-idle.ts` | 滚动条保持细宽度；滚动时滑块着色，停止约 1 秒后滑块透明。侧栏与明确隐藏滚动条的导航不受影响 | Linux 常驻粗滚动条和 quiet-inset 的紧凑密度冲突；只改颜色、不改宽度，避免内容抖动 | 否（模板未定义滚动条外观；未改 lock 文件） |

## 验收记录

| 日期 | 范围 | 方式 | 结果 |
| --- | --- | --- | --- |
| 2026-11-22 | 设置 5 分区 | 宽/窄截图 + 逐态（重定向、行控件、弹窗） | 通过 |
| 2026-11-22 | 文档阅读壳 | 宽/窄、右目录滚动跟踪、4 个页头弹窗、目录隐藏跨刷新 | 通过 |
| 2026-11-22 | 树形二级菜单 | 默认折叠 + 当前祖先展开、全展/全折、定位、搜索扁平、中英目录名 | 通过 |
| 2026-11-22 | 图谱 | 全宽、hover 浮层、选中详情弹窗、显式选中 | 通过 |
| 2026-11-22 | 全套门禁 | tsc / eslint / build / vitest 5/5 / fidelity 7/7 / validate project 0 error | 通过 |
| 2026-11-25 | 滚动条 | `vitest run src/lib/scrollbar-idle.test.ts` 2/2。预览 `http://127.0.0.1:4173/wiki`：滚轮后 `.scrollbar-active`、滑块 `oklch(0 0 0 / 0.28)`，约 1 秒后类名去掉且滑块透明，`scrollTop` 保持；暗色滑块为白 28%。侧栏 `.no-scrollbar` 与 `[scrollbar-width:none]` 仍是 `none`。Playwright Chromium 是 overlay 滚动条（gutter 0），截图像素里看不到滑块 | 通过（显隐以计算样式为准） |
