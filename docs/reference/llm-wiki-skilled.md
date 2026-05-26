# LLM-Wiki-Skilled 分析

> 仓库: [LLM-Wiki-Skilled](https://github.com/LLM-Wiki-Skilled/LLM-Wiki-Skilled) · Apache 2.0
> 定位: **OpenCode Agent Skill 系统** — 最小化框架，纯约定驱动

## 核心设计哲学

```
类比: Obsidian = IDE, LLM = 程序员, Wiki = 代码库

人 → 浏览、策展、提问、思考
LLM → 所有簿记工作: 摘要、交叉引用、归档、维护
```

这不是一个独立应用，而是一个让 LLM agent 成为"训练有素的 Wiki 维护者"的**规则+模板+脚本**集合。LLM 通过读取 `AGENTS.md` 和 `.agents/skills/` 来理解如何操作 Wiki。

## 三层架构

```
┌─────────────────────────────────────┐
│  Layer 1: raw/  (不可变源文件)        │  ← 人添加源文件，LLM 只读不写
│  ├── sources/   (文本源)             │
│  └── assets/    (二进制/媒体)         │
├─────────────────────────────────────┤
│  Layer 2: wiki/ (LLM 维护)           │  ← LLM 创建/更新所有 Markdown
│  ├── entities/   (具体事物)           │
│  ├── concepts/   (抽象概念)           │
│  ├── sources/    (源摘要)             │
│  ├── syntheses/  (综合分析)           │
│  ├── templates/  (页面模板)           │
│  ├── index.md    (内容目录)          │
│  └── log.md      (仅追加日志)        │
├─────────────────────────────────────┤
│  Layer 3: AGENTS.md (约定/契约)      │  ← 与 LLM 共演化的规则文档
│  + .agents/skills/ (技能定义)        │
│  + scripts/ (Python 工具)            │
│  + verification/ (验收测试)           │
└─────────────────────────────────────┘
```

## 五大不可变规则 (来自 AGENTS.md)

| # | 规则 | 含义 |
|---|------|------|
| 1 | 原始源文件不可变 | `raw/` 中的文件 LLM 永不修改，源修订作为新文件添加 |
| 2 | LLM 拥有 Wiki 层 | 人从不在 `wiki/` 中写页面 |
| 3 | 每次操作都记录日志 | `wiki/log.md` 记录所有操作的时间线 |
| 4 | 索引始终最新 | `wiki/index.md` 反映当前所有页面 |
| 5 | 交叉引用是一等公民 | 任何声明必须引用 `[[wikilink]]` 源 |

## 三大操作 (Skills)

项目定义了三个 OpenCode agent skill：

### 1. Ingest（摄取）
```
raw/sources/新文件
  → LLM 读取源
  → 与操作者讨论要点
  → 写源摘要页 (wiki/sources/)
  → 提取实体 → 创建/更新 wiki/entities/
  → 提取概念 → 创建/更新 wiki/concepts/
  → 更新 wiki/index.md (目录)
  → 追加 wiki/log.md (日志)
  
单个源可能触及 10-15 个 wiki 页面
```

### 2. Query（查询）
```
用户提问
  → LLM 读 index.md 找相关页面
  → LLM 深入阅读相关页面
  → 综合回答 + [[wikilink]] 引用
  → 可选: 归档到 wiki/syntheses/
  
好回答不应消失在聊天记录中
```

### 3. Lint（维护）
```
定期健康检查:
  → 运行 scripts/lint_schema.py (结构校验)
  → 扫描页面间矛盾
  → 检查过时声明
  → 找孤立页面（无入链）
  → 找缺失的交叉引用
  → 发现数据空白
  → 建议新的研究和源
```

## 四类页面类型 (Type System)

| 类型 | 目录 | 核心部分 (Required Sections) | Frontmatter |
|------|------|------------------------------|-------------|
| **entity** | `wiki/entities/` | Identity, Aliases, Key Attributes, Evidence, Related, Open Questions | type, aliases, tags, created, updated, source_count |
| **concept** | `wiki/concepts/` | Definition, Scope, Contrasts, Evidence, Related, Open Questions | type, aliases, tags, created, updated, source_count |
| **source** | `wiki/sources/` | Summary, Key Claims, Notable Quotes, Entities/Concepts Mentioned, Follow-ups | type, tags, created, file_name, source_path |
| **synthesis** | `wiki/syntheses/` | Question/Purpose, Answer/Analysis, Comparison, Citations, Implications, Follow-up | type, tags, created, question |

每种类型都有明确的前置条件（frontmatter contract）和必需章节（required sections），由 `scripts/lint_schema.py` 机械验证。

## 三个 Python 工具

### `scripts/rebuild_index.py`
- 扫描所有 wiki 页面 → 解析 YAML frontmatter
- 按类别生成 markdown 目录表
- `--check` 标志：对比当前 index，不一致则退出非零
- `--sort-by updated`: 按更新日期排序
- 验证：type 必须与目录匹配、created 必须存在、source_count 必须是非负整数

### `scripts/lint_schema.py`
- 验证 frontmatter contract：每个页面类型各有必需的 frontmatter 键
- 验证 required sections：每个页面类型各有必需的 `## Section` 标题
- 验证 source_path（对 source 页面）
- 验证交叉引用（解析 `[[wikilinks]]`，检查目标页面存在）
- 输出：人类可读报告 和/或 JSON 机器输出
- 退出码：0=清理/非严格，1=有issue(strict)，2=无效wiki根

### `scripts/validate_log.py`
- 确保 log 条目格式: `## [YYYY-MM-DD] action-type | description`
- 检查必需 bullet: Action, Pages touched, Notes, Open questions
- 日期验证：ISO 格式、非递减（append-only）
- `--baseline` 标志：对比 git baseline 验证 append-only 契约

## 验证套件 (TDD 风格)

`verification/` 目录包含轻量级的验收测试框架：

```
verification/
├── ingest-fixture.md          # 测试源: Vannevar Bush "As We May Think"
├── ingest-fixture.expect.json  # 预期检查: 源页创建、index更新、log追加、raw不变
├── query-fixture.md            # 测试问题
├── query-fixture.expect.json   # 预期检查: wikilink引用、已知页面约束
├── lint-fixture.md             # 故意破坏的 mini-wiki（含矛盾、孤立、缺失错误）
├── lint-fixture.expect.json    # 预期检查: 矛盾/孤立/缺失/死链检测
├── run_checks.py              # 验收运行器
└── README.md
```

## 关键设计决策

### 1. 最小化框架，最大化约定
没有数据库，没有后端服务，没有 GUI。所有结构化信息存在于：
- Markdown 文件的 YAML frontmatter 中
- `index.md`（可重建的衍生数据）
- `log.md`（仅追加的时间线）

**文件系统即数据库**，Git 即版本控制。

### 2. 约定驱动而非代码驱动
核心契约是 `AGENTS.md` — 纯自然语言（面向 LLM）的规则文档。Python 脚本是辅助性的，用来机械验证 LLM 的输出是否合规（"lint the linter"）。

### 3. 仅追加日志 (Append-Only Log)
`wiki/log.md` 只能追加不能修改。`validate_log.py` 严格验证这个契约。这创建了一个可解析的时间线。

### 4. 确定性索引 (Deterministic Index)
`wiki/index.md` 始终可以从页面 frontmatter 衍生。`rebuild_index.py` 可幂等地重建它。`--check` 标志验证索引是否过时。这意味着 LLM 的索引更新是可验证的。

### 5. 引用优先文化 (Citation-First Culture)
每个声明必须引用一个 `[[wikilink]]`。交叉引用是结构本身，不是事后补充。孤立页面被视为 bug。

### 6. 知识复合 (Compound Knowledge)
摄取的源和查询的答案都可以归档回 Wiki。Wiki 随时间越来越丰富。"好答案不应消失在聊天记录中"。

## 适用场景

最适合那些希望：
- 用 OpenCode agent 直接操作 Wiki
- 最小化基础设施
- Git 作为版本控制
- 纯 Markdown 文件，兼容 Obsidian
- 通过约定（而非软件）约束 LLM 行为

相比之下不适合需要：
- Web UI 浏览
- 远程访问
- 向量搜索
- 批量处理
- 多用户协作
