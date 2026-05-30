# Wiki 目录组织方式深度分析

> 跨 6 个实现（Karpathy 原版 + 4 个实现 + 本项目）对比 Wiki 子目录组织方式，
> 重点关注**文本与资源文件的分离模式**。

## 一、六种实现的 Wiki 目录结构对比

```
图例:
  ✨ = 该实现特有/独创的设计
  📄 = 文本/Markdown 文件
  🖼️ = 图片/二进制/资源文件
  ⚙️ = 工具/配置/索引数据
```

### 1. Karpathy 原始模式 (概念级)

```
project/
├── raw/                     🖼️ 不可变源文件 (PDF, 文章, 图片)
├── wiki/                    📄 LLM 生成的 Markdown
│   ├── index.md             📄 内容目录
│   ├── log.md               📄 操作日志
│   ├── entities/            📄 实体页面
│   ├── concepts/            📄 概念页面
│   ├── sources/             📄 源文件摘要
│   ├── synthesis/           📄 综合分析
│   └── comparisons/         📄 对比分析
└── schema.md / CLAUDE.md    ⚙️ 结构约定
```

**特点**: 概念层面最简洁。`raw/` 和 `wiki/` 分离是核心。子目录按知识类型组织，面向人类导航。

### 2. llm_wiki (nashsu, Desktop App)

```
my-wiki/
├── purpose.md               📄 ✨ 目标/研究范围 (新增)
├── schema.md                📄 结构约定
├── raw/
│   ├── sources/             🖼️ 不可变源 (PDF, docx, pptx, etc.)
│   └── assets/              🖼️ 本地图片 (Download 到本地)
├── wiki/
│   ├── overview.md          📄 ✨ 全局总览 (新增, 自动维护)
│   ├── index.md             📄 内容目录
│   ├── log.md               📄 操作日志
│   ├── entities/            📄 实体
│   ├── concepts/            📄 概念
│   ├── sources/             📄 源摘要
│   ├── queries/             📄 ✨ 查询归档 (新增)
│   ├── synthesis/           📄 综合分析
│   ├── comparisons/         📄 对比分析
│   └── media/               🖼️ ✨ 从文档提取的图片 (新增)
├── .obsidian/               ⚙️ ✨ Obsidian 配置 (新增)
└── .llm-wiki/               ⚙️ App 数据 (缓存/配置/状态)
```

**关键新增**:
- `purpose.md` — 与 schema 区分，告诉 LLM "这是研究什么"（意图），而不仅是"怎么组织"（规则）
- `overview.md` — 全局总览，跨整个 Wiki 的综合
- `queries/` — 查询结果归档，体现"好答案不消失"的理念
- `media/` — 最关键的文本/资源分离创新：从 PDF/PPTX 提取的图片存在 `wiki/media/`
- `.obsidian/` — 自动兼容 Obsidian
- `.llm-wiki/` — 应用专有数据，与用户内容彻底分离

**RAW 文件处理**: `raw/sources/` 是原始文档；`raw/assets/` 是从网页下载的图片。文档的内嵌图片由 `extract_images.rs` 提取到 `wiki/media/`。

### 3. LLM-Wiki-Skilled (OpenCode Agents)

```
project/
├── raw/
│   ├── README.md            📄 ✨ 源文件策略说明 (新增)
│   ├── sources/             🖼️ 文本源 (md, txt)
│   └── assets/              🖼️ 二进制媒体 (images, data)
├── wiki/
│   ├── index.md             📄 内容目录
│   ├── log.md               📄 操作日志
│   ├── entities/            📄 实体页面
│   ├── concepts/            📄 概念页面
│   ├── sources/             📄 源摘要
│   ├── syntheses/           📄 综合分析
│   └── templates/           📄 ✨ 页面模板 (新增)
├── scripts/                 ⚙️ ✨ Python 工具 (lint, rebuild, validate)
├── verification/            ⚙️ ✨ TDD 验收测试
├── .agents/skills/          ⚙️ ✨ Agent 技能定义
└── AGENTS.md                📄 ✨ LLM 运行契约
```

**关键新增**:
- `raw/README.md` — 将策略文档化："Once placed in raw/, never edit"
- `templates/` — 页面模板在 wiki 内，LLM 创建新页面时参考
- `scripts/` — 不在 wiki 中，在项目根级别，是可执行工具
- `.agents/skills/` — 技能定义与 Wiki 数据完全分开
- `verification/` — 验收测试与 Wiki 数据分开

**资源分离**: `raw/sources/` (纯文本源) vs `raw/assets/` (二进制媒体)。这是在 raw 层内部的二次分离。

### 4. llmwiki (lcasastorian, Web Platform)

```
workspace/                   ← 灵活的，不要求特定目录结构
├── raw/                     🖼️ LLM 只读区
├── wiki/                    📄 LLM 可写区
│   ├── overview.md
│   └── log.md
├── .llmwiki/
│   ├── index.db            ⚙️ SQLite 索引
│   └── cache/              ⚙️ 衍生缓存 (PDF 转换, 图片)
└── (任意其他目录结构)        ← 没有硬性要求
```

**特点**: 最灵活。不强制 wiki 子目录结构。`source_kind` 列（`'wiki'|'source'|'asset'`）在 DB 层面区分文本类型。文件系统和数据库双层存储。`raw/` vs `wiki/` 读写权限在 Api/MCP 层控制。

### 5. OmegaWiki (Research Platform)

```
project/
├── raw/
│   ├── papers/              🖼️ 人拥有的 .tex/.pdf
│   ├── discovered/          🖼️ ✨ 自动获取的外部论文
│   ├── tmp/                 🖼️ ✨ 准备的本地辅助文件
│   ├── notes/               📄 人拥有的 .md 笔记
│   └── web/                 📄 人拥有的 HTML/Markdown
├── wiki/
│   ├── index.md             📄 内容目录
│   ├── log.md               📄 操作日志
│   ├── papers/              📄 论文页面
│   ├── concepts/            📄 概念页面
│   ├── topics/              📄 ✨ 主题页面
│   ├── people/              📄 ✨ 人物页面
│   ├── ideas/               📄 ✨ 想法页面
│   ├── experiments/         📄 ✨ 实验页面
│   ├── methods/             📄 ✨ 方法页面
│   ├── Summary/             📄 ✨ 综合摘要
│   ├── foundations/         📄 ✨ 基础知识
│   ├── outputs/             🖼️ ✨ 输出产物 (图表, 幻灯片)
│   └── graph/               ⚙️ ✨ 自动生成的图文件 (edges.jsonl, citations.jsonl)
├── runtime/                 ⚙️ ✨ YAML-only Schema
├── tools/                   ⚙️ ✨ Python 工具
├── .claude/skills/          ⚙️ ✨ Agent 技能
├── config/                  ⚙️ 配置
└── CLAUDE.md                📄 ✨ LLM 运行契约
```

**关键特点**:
- **raw 内部细分化** — `papers/`, `discovered/`, `tmp/`, `notes/`, `web/`。区分"人添加"vs"机器获取"vs"临时"vs"笔记"vs"网页"
- **9 种实体类型** — 远超通用的 entity/concept，面向研究领域特化
- **wiki/graph/ 是特殊子目录** — 存放的不是人写的页面，而是工具自动生成的 JSONL/JSON 图文件
- **wiki/outputs/** — 生成的可视产物（图表、海报），与知识页面分离
- **wiki/Summary/** — 使用大驼峰命名，暗示这是聚合页（不同于 entities）
- **foundations/** — 使用 terminal=true 标记终点节点，构成知识 DAG 的叶子

### 6. 本项目 (llmwiki, Go Single Binary)

```
~/research/
├── purpose.md               📄 目标/问题/范围（工作区根）
├── rules.md                 📄 写作与引用规则（工作区根）
├── schema.md                📄 结构约定 (可选)
├── raw/
│   ├── sources/             🖼️ 不可变源
│   └── assets/              🖼️ 本地图片
├── wiki/
│   ├── overview.md          📄 全局总览 (自动维护)
│   ├── log.md               📄 操作日志 (仅追加)
│   ├── index.md             📄 内容目录 (apply/reindex 后自动维护)
│   ├── entities/            📄 实体页面
│   ├── concepts/            📄 概念页面
│   ├── sources/             📄 源文件摘要
│   ├── queries/             📄 查询结果归档
│   ├── synthesis/           📄 综合分析
│   ├── comparisons/         📄 对比分析
│   └── templates/           ⚙️ 页面模板（系统目录）
└── .llmwiki/
    ├── index.db            ⚙️ SQLite 索引
    └── cache/              ⚙️ 衍生缓存
```

完整规范见 `docs/workspace-layout.md`。

---

## 二、核心组织模式分析

### 模式 A: 知识分类导向的子目录 (Knowledge-Type Subdirectories)

几乎所有实现都采用**按知识类型划分子目录**的模式：

```
wiki/
  entities/    ← 具体事物 (人、组织、产品、地点)
  concepts/    ← 抽象概念 (理论、方法、框架)
  sources/     ← 源文件摘要
  synthesis/   ← 综合分析 (或 syntheses)
  comparisons/ ← 对比分析 (nashsu + 本项目)

# 扩展
  queries/     ← 查询归档 (nashsu + 本项目)
  topics/      ← 研究主题 (OmegaWiki)
  people/      ← 研究人员 (OmegaWiki)
  ideas/       ← 研究想法 (OmegaWiki)
  experiments/ ← 实验记录 (OmegaWiki)
  methods/     ← 技术方法 (OmegaWiki)
  foundations/ ← 基础知识 (OmegaWiki)
  Summary/     ← 主题综合 (OmegaWiki)
```

**设计原则**: 子目录对应人类心智模型的知识分类，减少 LLM 决策时对路径的选择困惑。目录名即语义。

**差异点**: 子目录数量和类型反映了实现的定位：
- 通用 (Karpathy, nashsu, LLM-Wiki-Skilled, lcasastorian, 本项目): ~5-8 个
- 领域特化 (OmegaWiki): 9 个，精准对应研究领域实体

### 模式 B: 文本 vs 资源分离 (Text vs Assets Separation)

```
层次 1: 全局分离
  raw/         ← 不可变输入 (源 + 图片)
  wiki/        ← LLM 可写的输出 (Markdown)

层次 2: raw 内部分离
  raw/sources/  ← 文本/文档源
  raw/assets/   ← 二进制/媒体源

层次 3: wiki 内部分离 (仅 nashsu)
  wiki/media/        ← 从文档提取的内嵌图片
  wiki/outputs/      ← 生成的可视产物 (OmegaWiki)
  wiki/graph/        ← 自动生成的图数据 (OmegaWiki)
```

**关键洞察**:

```
┌──────────────────────────────────────────────────────────┐
│                    RESOURCE FLOW                         │
│                                                          │
│  外部世界                                                  │
│    │                                                     │
│    ├── 网页 → clip → raw/sources/ (md)                    │
│    ├── 图片下载 → raw/assets/ (png/jpg)                    │
│    ├── PDF/docx → raw/sources/ (原文)                     │
│    │   └── extract_images → wiki/media/ (提取的内嵌图)     │
│    │                                                     │
│  raw/ 层 (不可变)                                         │
│    │                                                     │
│    ▼ LLM 摄取                                             │
│    │                                                     │
│  wiki/ 层 (LLM 产出)                                      │
│    ├── *.md 页面 (引用 raw/sources/ + wiki/media/)         │
│    └── outputs/ (图表/幻灯片)                              │
│                                                          │
│  .llmwiki/ 层 (衍生数据，不入 Git)                          │
│    ├── index.db (SQLite 索引)                             │
│    └── cache/ (PDF 转换, OCR 结果)                        │
└──────────────────────────────────────────────────────────┘
```

### 模式 C: 特殊文件位置

**根级别文件** (Git 可见，项目配置):

| 文件 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| purpose.md | — | ✅ | — | — | — | ✅ |
| schema.md | ✅* | ✅ | — | — | — | ✅ |
| CLAUDE.md / AGENTS.md | ✅* | — | ✅ | — | ✅ | — |

> \* Karpathy 原始概念中提到 schema 作为"第三层"，但未指定文件名

**wiki 内特殊文件** (内容目录等):

| 文件 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| index.md | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| log.md | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| overview.md | — | ✅ | — | ✅ | — | ✅ |

**隐藏目录** (不入 Git):

| 目录 | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|
| .llm-wiki/ or .llmwiki/ | ✅ App数据 | — | ✅ SQLite+Cache | — | ✅ SQLite+Cache |
| .obsidian/ | ✅ | — | — | — | — |
| .agents/ | — | ✅ 技能定义 | — | — | — |
| .claude/ | — | — | — | ✅ 技能+配置 | — |

---

## 三、Wiki 子目录组织的最佳实践总结

### 原则 1: 文本与资源物理分离

```
✅ 好的做法:
  raw/sources/    — 文本/Markdown 源文件
  raw/assets/     — 图片/二进制/数据文件
  wiki/media/     — 从文档提取的图片

❌ 避免:
  raw/paper.pdf, raw/image.png, raw/note.md  ← 混在一起
  wiki/page.md + wiki/diagram.png            ← 文本和图片同级
```

**理由**: 
- LLM 读取策略不同：文本直接读取，图片需要 vision 能力
- 引用语法不同：`[text](wiki/page.md)` vs `![](wiki/media/image.png)`
- 提取流程不同：PDF 提取 vs 图片 caption
- `.gitignore` 规则不同：大型二进制可忽略，文本必须追踪

### 原则 2: 子目录对应页面类型，类型在 frontmatter 声明

```
✅ 好的做法:
  wiki/entities/transformer.md     ← type: entity
  wiki/concepts/attention.md       ← type: concept
  wiki/sources/paper-summary.md    ← type: source

  lint 工具验证: type 必须与目录匹配

❌ 避免:
  仅依靠目录推断类型，不在 frontmatter 声明
  或在 frontmatter 声明但与目录不一致
```

### 原则 3: 衍生索引与缓存不入 Wiki

```
✅ 好的做法:
  .llmwiki/index.db    — SQLite 索引 (可重建)
  .llmwiki/cache/      — PDF 转换结果 (衍生)
  wiki/graph/          — 自动生成的图文件 (只在 OmegaWiki)

  [.gitignore]
  .llmwiki/

❌ 避免:
  wiki/.index.json     ← 混入 wiki 内容区
```

### 原则 4: 特殊文件的保护

```
受保护文件 (不可删除, 不可重命名):
  wiki/overview.md
  wiki/log.md
  wiki/index.md

在 MCP delete 工具或 API 中显式检查:
  if path in ["wiki/overview.md", "wiki/log.md"]:
    return Error("protected file")
```

### 原则 5: 子目录粒度应根据领域复杂性伸缩

| 场景 | 建议子目录数 | 示例 |
|------|:---:|------|
| 个人知识管理 | 4-6 | entities, concepts, sources, queries, synthesis |
| 深度研究 | 6-8 | + comparisons, + 领域特定 (如 experiments, methods) |
| 学术研究 (OmegaWiki) | 9+ | papers, concepts, topics, people, ideas, experiments, methods, Summary, foundations |
| 最小化 (lcasastorian) | 0 (平铺) | 所有 .md 文件放 wiki/ 下，通过 source_kind 区分 |

**关键权衡**:
- **多子目录**: 人类浏览友好，LLM 容易定位，schema 清晰
- **平铺**: 灵活性高，用户不关心目录结构，DB 层面区分即可
- **建议**: 初期保守 (4-6 个子目录)，根据实际使用逐渐扩展

---

## 四、与本项目的对比和建议

### 已采纳的设计

本项目已从各参考实现中采纳：

| 设计 | 来源 |
|------|------|
| `raw/sources/` + `raw/assets/` 分离 | nashsu, LLM-Wiki-Skilled |
| `purpose.md` (目标/意图声明) | nashsu |
| `wiki/overview.md` (全局总览) | nashsu |
| `wiki/index.md` + `wiki/log.md` 双文件 | Karpathy 原版 |
| 6 个子目录: entities, concepts, sources, queries, synthesis, comparisons | Karpathy + nashsu |
| `.llmwiki/` 隐藏目录 (SQLite + cache) | lcasastorian |
| `source_kind` 三值: wiki/source/asset | lcasastorian |
| reindex 时 frontmatter 回填 | 修复 lcasastorian 的 gap |

### 可选扩展 (未来考虑)

| 设计 | 来源 | 适用场景 |
|------|------|----------|
| `raw/` 内细分 (papers/discovered/notes) | OmegaWiki | 多来源类型的深度研究 |
| `wiki/templates/` | LLM-Wiki-Skilled | 需要 LLM 遵循统一页面格式 |
| `wiki/outputs/` | OmegaWiki | 需要生成图表/幻灯片 |
| `.obsidian/` 自动生成 | nashsu | 兼容 Obsidian 图视图 |
| `media/` 提取图片子目录 | nashsu | PDF 内嵌图片提取 |
| `verification/` TDD 目录 | LLM-Wiki-Skilled | 需要验收 LLM 输出质量 |

---

## 相关文档

- [功能对比矩阵](13-feature-comparison-matrix.md) — 工作区基础部分的详细对比
- [Gap 分析与路线图](14-gap-analysis-and-roadmap.md) — Wiki 目录相关的 gap（P0-3 子目录不完整、P1-3 Obsidian 兼容）
