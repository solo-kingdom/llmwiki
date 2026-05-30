## 1. 帮助内容 Markdown

- [x] 1.1 新建 `web/src/content/help.zh.md`，从 `docs/01-karpathy-core-concept.md`、`docs/12-wiki-directory-organization.md`、`README.md` 提炼用户向章节：快速开始、核心理念、工作区结构、Wiki 组织、Web UI、CLI、MCP、FAQ
- [x] 1.2 新建 `web/src/content/help.en.md`，与中文版结构对齐的英文帮助文档
- [x] 1.3 为各 h2 章节添加稳定 HTML id（如 `{#quick-start}`），供 TOC 锚点跳转

## 2. HelpPage 组件

- [x] 2.1 新建 `HelpPage.tsx`：按 `useI18n().lang` 选择 `help.zh.md` / `help.en.md`（Vite `?raw` import）
- [x] 2.2 使用 `MarkdownContent` + `wiki-prose` 渲染正文；外层 `PageContainer` + 两栏布局（sticky TOC + 可滚动正文）
- [x] 2.3 实现 hand-maintained TOC（中英文各一份或 language-aware 配置），点击滚动到对应 section id
- [x] 2.4 新建 `help-page.test.tsx`：验证 zh/en 内容切换、TOC 渲染、Markdown 标题可见

## 3. 路由与导航

- [x] 3.1 扩展 `wiki-routes.ts`：`WorkbenchView` 增加 `"help"`；`getWorkbenchViewFromPath("/help")`；`workbenchViewHref("help")` → `/help`
- [x] 3.2 更新 `WorkbenchLayout.tsx`：`NAV_ITEMS` 在 Logs 与 Settings 之间插入 Help；`view === "help"` 时渲染 `HelpPage`
- [x] 3.3 更新 `wiki-routes.test.ts` 与 `app-nav.test.tsx`：覆盖 `/help` 路由与 Help 导航项

## 4. i18n

- [x] 4.1 在 `zh.ts` / `en.ts` 新增 `nav.help`（「帮助」/「Help」）
- [x] 4.2 可选：Help 页 TOC 标签走 i18n key（若 TOC 文案需本地化）

## 5. 验证

- [x] 5.1 运行 `web` 前端测试套件
- [x] 5.2 手动验证：`/help` 直达、导航高亮、`ui_language` 切换后正文语言变化、代码块与宽表渲染正常
