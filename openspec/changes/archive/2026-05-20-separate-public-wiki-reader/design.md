## Context

LLMWiki 当前是单进程 Go 服务：后端提供 `/api/v1/*`，前端 React SPA 通过 `AppContext` 统一加载 documents、settings、ingest sessions、jobs 等数据。`server.go` 中的 token auth 目前在路由层全局启用，除 `/api/v1/health` 外都会要求 `Authorization: Bearer <token>`。因此，若 Wiki 要支持公开访问，必须显式拆分“公开只读读取路径”和“私有管理路径”。

前端上，`App.tsx` 目前用单一 `view` 状态切换 `Ingest`、`Jobs`、`Wiki`、`Settings`。这让 Wiki 在信息架构上表现为工作台里的一个 tab，而不是一个面向阅读和分享的页面。参考项目 `mdserve` 的核心优势是阅读器优先：顶部窄 header、三栏卡片布局、文档信息栏、目录/大纲折叠、正文滚动细节和 Markdown 样式形成统一阅读体验。

## Goals / Non-Goals

**Goals:**
- 将 Wiki 阅读器和管理工作台从视觉、路由语义、数据访问边界上区分开。
- 支持可选公开 Wiki 只读访问；公开访问不得暴露 ingest、jobs、settings、provider instances、MCP 等管理能力。
- 参考 `mdserve` 提升 Wiki 阅读器美观度和可读性。
- 尽量复用现有 document list/get/search 能力，避免重新设计存储层。
- 保持单 Go binary + 嵌入式 React SPA 的部署形态。

**Non-Goals:**
- 不引入用户账号、角色系统或多租户权限模型。
- 不实现文档级细粒度 ACL；本次只做站点级公开开关和公开只读边界。
- 不把管理工作台完全改造成 React Router 大型路由系统；必要时仅做轻量路径识别。
- 不实现 Wiki 内容编辑器。
- 不强制引入 `mdserve` 的所有功能，例如标签弹窗、下载、Mermaid、Shiki 可作为后续增强。

## Decisions

### D1: 使用两个前端壳层表达产品边界

**决策**: 前端拆分为 `WikiReaderLayout` 与 `WorkbenchLayout` 两类壳层。`WikiReaderLayout` 服务 `/wiki` 及其子路径，面向阅读；`WorkbenchLayout` 服务管理入口，承载 `Ingest`、`Jobs`、`Settings`，并可提供“进入 Wiki”链接。

**理由**:
- Wiki 的首要任务是展示，管理页的首要任务是操作，二者视觉密度和导航方式不同。
- 独立壳层能自然支持公开访问、分享链接和更沉浸的阅读体验。
- 实现上可先使用 `window.location.pathname` 做轻量路由判断，降低引入路由库的范围。

**替代方案**:
- 继续保留 Wiki 为普通 tab，仅调整样式。无法解决公开访问和管理操作混杂问题，拒绝。
- 一次性引入完整 React Router。长期可行，但本次目标偏边界重塑和阅读器升级，暂不要求。

### D2: 公开访问通过独立只读 API 前缀实现

**决策**: 新增公开只读 API 前缀，例如 `/api/public/wiki/documents`、`/api/public/wiki/documents/{id}`、`/api/public/wiki/search`。公开 Wiki 页面只调用这些 API，不调用 `/api/v1/*` 管理接口。

**理由**:
- API 前缀让 token auth 规则清晰，避免在一个 handler 内混合“公开读取”和“私有管理”语义。
- 公开端点可以只暴露必要字段，降低误泄露 metadata、source path 或内部状态的风险。
- 后续若需要文档级公开、robots、缓存头，也能集中在公开 API 层演进。

**替代方案**:
- 在现有 `/api/v1/documents` 上按请求是否带 token 返回不同字段。语义隐晦且测试复杂，拒绝。

### D3: 公开 Wiki 使用站点级开关

**决策**: 引入站点级配置开关控制公开 Wiki 是否启用。未启用时，公开 API 返回 404 或 403，公开 `/wiki` 页面可以显示不可用状态或跳转管理入口。

**理由**:
- 当前系统没有账号和文档级权限模型，站点级开关是风险最低的第一步。
- 适合个人知识库的常见部署模式：私有运行时默认关闭，需要公开时显式开启。
- 不改变已有私有管理 API 的使用方式。

**开放点**:
- 开关来源可以先放在 CLI/server config，后续再进入 Settings 页面。实现时应选择与现有配置体系最贴近的方案。

### D4: Wiki 阅读器复用数据源，但使用独立 view model

**决策**: 后端公开 API 可复用现有 SQLite 查询逻辑，但响应结构应为公开阅读专用类型，只包含渲染所需字段：`id`、`filename`、`title`、`path`、`file_type`、`page_count`、`updated_at`、`content`、`tags` 等安全字段。

**理由**:
- 复用查询逻辑减少重复和不一致。
- 独立响应类型让公开边界可审查，避免未来新增敏感字段后自动被公开。

### D5: UI 风格参考 mdserve，但不复制其应用状态模型

**决策**: 迁移 `mdserve` 的视觉语言和阅读器交互模式，而不是直接复制其上下文、数据模型或依赖树。优先吸收：
- 顶部 `rounded-xl border border-border/70 bg-card/70 backdrop-blur-sm shadow-sm` 阅读器 header。
- `main` 使用 `gap-4 px-4 pb-2` 的三栏卡片布局。
- 左右栏为 `rounded-xl border bg-card/70 shadow-sm backdrop-blur-sm`，桌面端可折叠。
- 文档正文卡片带 `point` 色信息栏，用于展示路径、类型、页数、更新时间、标签。
- 正文滚动条空闲隐藏、滚动时显示。
- Markdown 内联代码、代码块、表格、链接、blockquote 的统一样式。

**理由**:
- `llmwiki` 与 `mdserve` 数据源不同，直接迁移组件会扩大改动面。
- 视觉 token 和布局模式可以低风险提升观感，并保持现有 API/状态管理。

### D6: 管理工作台减少 Wiki tab 权重

**决策**: 管理工作台主导航保留 `Ingest`、`Jobs`、`Settings`。Wiki 以站点链接或品牌旁入口出现，而不是与管理任务同级的 tab。

**理由**:
- 用户进入工作台通常是为了摄入、查看任务、配置模型；Wiki 是阅读目的地。
- 这个区分能让公开 Wiki 与私有工作台形成清晰心智模型。

## Proposed Shape

```text
Browser
  │
  ├─ /wiki[/...]
  │    └─ WikiReaderLayout
  │         ├─ ReaderHeader
  │         ├─ WikiFileTree
  │         ├─ WikiDocumentCard
  │         └─ WikiOutline
  │
  └─ /app 或 /
       └─ WorkbenchLayout
            ├─ Ingest
            ├─ Jobs
            └─ Settings
```

```text
HTTP
  │
  ├─ /api/public/wiki/*       公开只读，受 public wiki 开关控制
  │
  ├─ /api/v1/*                私有管理 API，token 开启时必须鉴权
  │
  └─ /*                       SPA fallback
```

## Risks / Trade-offs

- **[公开数据泄露]** 公开 API 若复用完整 document 类型，可能暴露内部字段。通过公开 view model 和测试约束缓解。
- **[鉴权绕过]** 全局 token 中间件改动有风险。需要后端测试覆盖：token 开启时 `/api/v1/settings` 仍拒绝未授权，公开开关开启时 `/api/public/wiki/documents` 可读。
- **[范围膨胀]** `mdserve` 功能很多，本次只吸收阅读器视觉和关键交互，不做完整功能克隆。
- **[URL 状态复杂度]** 当前 `AppContext` 使用内存 `currentDocId`，公开分享需要 URL 能表达文档。MVP 可支持 `?doc=<id>` 或 `/wiki/d/<id>`，实现时选最小可行方式。
- **[移动端三栏]** 三栏在窄屏不可用。移动端应使用抽屉或浮动按钮打开文件树/大纲，避免正文被挤压。
