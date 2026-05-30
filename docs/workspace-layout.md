# LLM Wiki 工作区布局（Canonical）

本文档是工作区目录结构的**单一权威来源**。Help 页、Skills、README 等用户向文档应与此保持一致。

完整规范见 `openspec/specs/typed-wiki-organization/spec.md`。

## 工作区根目录

```
~/research/
├── purpose.md              # 研究目标（工作区根，不在 wiki/ 内）
├── rules.md                # 写作与引用规则（工作区根）
├── schema.md               # 可选：结构约定
├── raw/
│   ├── sources/            # 不可变源文件（只读）
│   └── assets/             # 本地图片等资源
├── wiki/                   # LLM 维护的结构化 Markdown
│   ├── overview.md         # 全局总览（系统页）
│   ├── index.md            # 内容目录（系统页，reindex/apply 后自动维护）
│   ├── log.md              # 操作日志（系统页，仅追加）
│   ├── entities/           # 实体页面（复数）
│   ├── concepts/           # 概念页面（复数）
│   ├── sources/            # 源摘要（复数）
│   ├── synthesis/          # 综合分析
│   ├── comparisons/        # 对比分析
│   ├── queries/            # 归档问答
│   └── templates/          # 页面模板（系统目录，非业务内容）
└── .llmwiki/
    ├── index.db            # SQLite 索引（可 reindex 重建）
    └── ...
```

## 路径约定

| 类别 | 路径 | 说明 |
|------|------|------|
| 工作区配置 | `purpose.md`, `rules.md` | 位于工作区**根目录** |
| 不可变源 | `raw/sources/`, `raw/assets/` | LLM 只读，不在 `wiki/` 内 |
| 系统页 | `wiki/overview.md`, `wiki/index.md`, `wiki/log.md` | 仅有的合法顶层 wiki 页面 |
| 业务页 | `wiki/entities/` … `wiki/queries/` | 必须使用**复数** typed 子目录 |
| 系统模板 | `wiki/templates/` | init scaffold，非 ingest 产物 |

## 常见错误模式（Anti-patterns）

以下路径**不是** canonical 布局，Organize 模式与 `structure()` 工具不应返回这些内容：

| 错误路径 | 原因 |
|----------|------|
| `wiki/purpose.md`, `wiki/rules.md` | 配置文件应在工作区根 |
| `wiki/raw/` | 源文件目录是 `raw/`，不在 wiki 内 |
| `wiki/entity/`, `wiki/concept/`, `wiki/source/` | 应使用复数：`entities/`, `concepts/`, `sources/` |
| `wiki/skills/` | 不存在；勿与仓库 `skills/` 或 MCP 工具名混淆 |
| `📁 root/` 包装的占位树 | 非 `structure()` 工具输出格式 |

## structure() 工具输出格式

Organize 模式应调用 Local `structure()` 工具。真实输出特征：

- 标题：`# Wiki 目录结构`
- 含工作区路径与数据来源说明（SQLite index）
- 统计行：`总计 N 个 wiki 文档（M 个业务内容页）`
- typed 子目录：`├── entities/ (N 页)` 等，空目录显示 `(空目录)`
- 路径前缀为 `wiki/…`（相对工作区根）

示例（格式示意，实际页面名以 tool 返回为准）：

```markdown
# Wiki 目录结构

工作区：`/path/to/research`
数据来源：SQLite index（与文件系统不一致时请运行 `llmwiki reindex`）

总计 41 个 wiki 文档（32 个业务内容页）

## 顶层系统页面

- 总览 (`wiki/overview.md`)
- 目录 (`wiki/index.md`)
- 日志 (`wiki/log.md`)

├── entities/ (10 页)
│   ├── AppLovin
│   └── ...
├── concepts/ (18 页)
│   ...
├── sources/ (4 页)
│   ...
├── synthesis/ (空目录)
├── comparisons/ (空目录)
├── queries/ (空目录)
├── templates/ (6 个系统模板)
│   ├── entity.md (系统模板)
│   └── ...
```

若 assistant 回复中的目录树含 emoji、`root/` 包装、或 `OpenAI.md` / `AGI.md` 等占位文件名，则为 LLM 编造，应重新调用 `structure()` 并引用原始返回。
