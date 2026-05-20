# LLM Wiki 全面综合报告

> 综合 6 个来源（Karpathy 原版 + 4 个实现 + 本项目 llmwiki）的系统性分析。

## 一、什么是 LLM Wiki —— 与 RAG 的本质区别

### 核心理念

```
传统 RAG:
  查询时 → 检索碎片 → 拼凑答案 → 下次重新开始
  (知识不累积，每次从头发现)

LLM Wiki:
  摄取时 → 编译知识 → 写入 Wiki → 知识常驻累积
  查询时 → 搜索 Wiki → 基于已有知识回答
  (Wiki 是持久化、可累积的知识产物)
```

两者的根本区别不在技术栈，而在**知识管理的范式**：

| 维度 | RAG | LLM Wiki |
|------|-----|----------|
| **知识状态** | 短暂的 (ephemeral) | 持久的 (persistent) |
| **交叉引用** | 每次重新发现 | 已经就位，持续维护 |
| **矛盾检测** | 无 | 主动标注新旧矛盾 |
| **知识空白** | 无感知 | 通过 lint 发现 |
| **人机分工** | 人提问，AI 回答 | 人策展，AI 维护 |
| **维护成本** | 无（也不累积） | 近零（LLM 承担） |

### 为什么 LLM 让 Wiki 重新可行

```
人类放弃 Wiki 的根本原因：
  维护负担的增长速度 > 价值的增长速度
  (每加一个新文档，要更新 10+ 个页面，人做不来)

LLM 的三个关键能力：
  1. 不无聊 — 不会因为重复的簿记工作而疏忽
  2. 不遗忘 — 总是记得更新所有交叉引用
  3. 上下文大 — 一次能触摸 10-15 个文件的交叉引用
```

## 二、统一的架构模式

所有 6 个实现共享一个三层架构：

```
┌──────────────────────────────────────────────────┐
│              Layer 1: 不可变源文件                  │
│                                                    │
│  raw/sources/  — PDF, Markdown, HTML, Office       │
│  raw/assets/   — 图片, 数据文件                     │
│                                                    │
│  ┌────────────────────────────────────────┐        │
│  │ 规则: 人添加，LLM 只读，永不修改         │        │
│  │ 修订 = 新文件 + 重新摄取，永远不覆盖      │        │
│  └────────────────────────────────────────┘        │
├──────────────────────────────────────────────────┤
│              Layer 2: Wiki (LLM 拥有)               │
│                                                    │
│  wiki/*.md  — 所有页面由 LLM 创建和维护               │
│  wiki/index.md — 内容目录 (自动更新)                 │
│  wiki/log.md   — 操作日志 (仅追加)                   │
│                                                    │
│  ┌────────────────────────────────────────┐        │
│  │ 规则: LLM 写，人读，永不手动编辑         │        │
│  │ 好的查询回答可以归档回 wiki              │        │
│  └────────────────────────────────────────┘        │
├──────────────────────────────────────────────────┤
│          Layer 3: Schema / 约定 (共演化)            │
│                                                    │
│  purpose.md / schema.md / CLAUDE.md / AGENTS.md     │
│                                                    │
│  ┌────────────────────────────────────────┐        │
│  │ 规则: 定义结构、约定、工作流              │        │
│  │ 人和 LLM 共同演化，持续优化               │        │
│  └────────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

## 三、三种交互模型

每个实现选择不同的 LLM ↔ Wiki 交互方式：

```
                      LLM Agent
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
  ┌──────────┐    ┌──────────────┐    ┌──────────────┐
  │ 内置引擎  │    │   MCP 服务    │    │ Skill 系统    │
  │          │    │              │    │              │
  │ llm_wiki │    │ llmwiki      │    │ Skilled      │
  │ (Tauri)  │    │ OmegaWiki    │    │ OmegaWiki    │
  │          │    │              │    │              │
  │ LLM调用  │    │ Agent 通过    │    │ Agent 读取    │
  │ 在应用内  │    │ MCP 工具      │    │ SKILL.md     │
  │ 直接编排  │    │ 操作 Wiki     │    │ 操作 Wiki     │
  └──────────┘    └──────────────┘    └──────────────┘
    GUI 导向          服务导向             约定导向
  人操作 GUI        人 + LLM 各自入口     LLM 主导，人策展
```

| 模型 | 代表人 | LLM 如何操作 Wiki | 人如何交互 |
|------|--------|-------------------|-----------|
| **内置引擎** | nashsu llm_wiki | 应用内调用 LLM API | GUI (React 桌面应用) |
| **MCP 服务** | lcasastorian llmwiki, OmegaWiki | 通过 MCP stdio 工具 | Claude Desktop / Codex CLI |
| **Skill 系统** | LLM-Wiki-Skilled, OmegaWiki | 读取 SKILL.md 遵循指令 | Obsidian + Agent 对话 |
| **HTTP API** | lcasastorian llmwiki, nashsu llm_wiki | 通过 REST API | Web UI |

### 与我们的对应

本项目 (llmwiki Go) 采用**三元入口**：MCP (给 Agent) + HTTP API (给 Web UI/远程) + CLI (给人/脚本)。同时内置 LLM 调用能力实现两步骤摄取。

## 四、三个核心操作的全貌

每个操作在不同实现中的具体形态：

### 1. Ingest (摄取)

```
源文件 → SHA256 缓存检查 → 跳过 (如果未变)
       │
       └→ 未缓存:
            ┌────────────────────────────────────┐
            │ 简单模式 (Karpathy, Skilled):        │
            │  LLM 读取源 → 写摘要 → 更新页面       │
            │  一次性完成                          │
            ├────────────────────────────────────┤
            │ 两步骤模式 (nashsu, OmegaWiki):       │
            │  Step 1: 分析 (结构化思考)            │
            │    temperature=0.1, max_tokens=4k    │
            │  Step 2: 生成 (产出 FILE 块)          │
            │    temperature=0.1, max_tokens=8k    │
            │  ≡ Chain-of-Thought 嵌入摄入流程      │
            ├────────────────────────────────────┤
            │ 并行模式 (OmegaWiki /init):           │
            │  每篇论文 → 独立 worktree + subagent  │
            │  全部完成后 merge=union → dedup       │
            └────────────────────────────────────┘
```

**关键差异**: 两步骤模式显著提升质量，并行模式处理批量源。

**页面合并保护** (nashsu 首创):
- 确定性合并: sources[], tags[], related[] — 直接联合
- LLM 辅助合并: 正文 — 变化时交给 LLM，结果长度检查 (≥70%)
- 锁定字段: type, title, created — 强制保护不覆盖

### 2. Query (查询)

```
问题 → 搜索
        ├─ 索引遍历: 读 index.md → 找相关页面 (Karpathy, Skilled, OmegaWiki)
        ├─ FTS5 全文搜索: SQLite BM25 (lcasastorian, 本项目)
        ├─ 混合搜索: 关键词 + 向量 RRF 融合 (nashsu)
        └─ 图扩展: 从种子节点遍历 (nashsu)
              → 相关性模型 (4 信号):
                  直接链接 ×3.0 + 源重叠 ×4.0 +
                  Adamic-Adar ×1.5 + 类型亲和 ×1.0
      → 上下文组装 → LLM 综合 → 回答 + [[wikilink]] 引用
      → 可选: 归档到 wiki/synthesis/ (好答案不消失)
```

### 3. Lint (维护)

```
定期健康检查:
  通用 (所有实现):
    ├─ 页面间矛盾
    ├─ 过时声明
    ├─ 孤立页面 (无入链)
    ├─ 缺失的交叉引用
    └─ 数据空白

  机械验证 (Skilled, OmegaWiki):
    ├─ frontmatter 契约验证
    ├─ 必需章节检查
    ├─ source_path 验证
    ├─ wikilink 解析验证
    └─ append-only log 契约

  知识图谱 (OmegaWiki):
    ├─ 双向链接对称性检查 (xref.yaml)
    ├─ idea 状态机合法性验证
    └─ experiment-idea 一致性
```

## 五、六种实现的定位矩阵

```
                    轻量级 ←──────────────────→ 重量级
                    纯约定                   全功能应用

  Karpathy原版  ████░░░░░░░░░░░░░░░░  概念文档，非实现
  Skilled       ██████░░░░░░░░░░░░░░  Agent Skill 系统
  OmegaWiki     ██████████░░░░░░░░░░  Research Platform
  lcasastorian  ██████████████░░░░░░  Web Platform + MCP
  本项目        ████████████████░░░░  Go 单二进制 (目标)
  nashsu        ████████████████████  Desktop App (最重)
                    ↑
              我们在这里
```

```
                    通用 ←──────────────────→ 领域特化

  Karpathy原版  ██████████████████████  任何领域
  Skilled       ██████████████████████  任何领域
  lcasastorian  ██████████████████████  任何领域
  nashsu        ██████████████████████  任何领域
  本项目        ██████████████████████  任何领域
  OmegaWiki     ████████░░░░░░░░░░░░░░  仅学术研究
```

## 六、从四个实现到本项目 —— 采纳与创新

### 明确采纳的设计

| 设计要素 | 来源 | 理由 |
|----------|------|------|
| `raw/sources/` + `raw/assets/` 分离 | nashsu, Skilled | 文本/资源物理分离 |
| `purpose.md` | nashsu | 意图与结构分离 |
| `wiki/overview.md` | nashsu | 全局总览 |
| `index.md` + `log.md` | Karpathy 原版 | 导航 + 审计 |
| 6 个 Wiki 子目录 | Karpathy + nashsu | 知识类型导航 |
| Two-Step 摄取 | nashsu | 分析→生成 Chain-of-Thought |
| SHA256 增量缓存 | nashsu | 节省 token |
| SQLite + FTS5 | lcasastorian | 轻量嵌入式全文搜索 |
| `source_kind` 三值 | lcasastorian | DB 层区分类型 |
| 引用图 (cites + links_to) | lcasastorian | 双向引用追踪 |
| 陈旧性传播 | lcasastorian | links_to 更新标记 stale |
| 页面合并保护 | nashsu | 防止 LLM 覆盖重要字段 |
| 级联删除 | nashsu | 源删除时清理 Wiki |
| MCP 5 工具集 | lcasastorian | 标准化的 Agent 接口 |
| HTTP API | lcasastorian, nashsu | Web UI + 远程访问 |
| 文件监视器 | 全部实现 | 文件系统自动同步 |
| Frontmatter 完整回填 | 修复 lcasastorian gap | 删库可恢复 |

### 本项目独特的设计决策

| 决策 | 说明 |
|------|------|
| **Go 单二进制** | 零依赖部署，Python 和 Node.js 都不需要 |
| **三元入口** | MCP + HTTP API + CLI 统一服务 |
| **embed Web UI** | `embed.FS` 打包前端，一个文件包含一切 |
| **内置 LLM 调用** | 服务端直接编排摄取，不依赖外部 Agent |
| **远程服务能力** | `llmwiki serve --bind 0.0.0.0` 跨设备访问 |

### 暂不采纳但值得关注的设计

| 设计 | 来源 | 原因 |
|------|------|------|
| 9 种实体类型 | OmegaWiki | 过于领域特化，通用项目不需要 |
| 16 种边类型 | OmegaWiki | 需要 LLM 在摄入时精确分类，过度设计 |
| YAML-only Schema | OmegaWiki | Go 项目中 schema 在代码中定义更自然 |
| 并行 worktree 摄入 | OmegaWiki | Git worktree 复杂度高，串行摄入当前足够 |
| 向量搜索 (LanceDB) | nashsu | Go 生态缺客户端，FTS5 在中等规模足够 |
| Louvain 社区发现 | nashsu | 前端可视化模块，非核心功能 |
| `wiki/templates/` | Skilled | 模板在 schema 中定义，不需要独立目录 |
| TDD 验证套件 | Skilled | 验收测试在 OpenSpec 层面更合适 |

## 七、Wiki 内容增长的演化路径

```
Phase 1: 初始化 (10-50 页)
  ┌──────────────────────────────────────┐
  │ 一个中心主题 + 几个源                 │
  │ index.md 可以容纳全部索引              │
  │ 不需要全文搜索                        │
  │ 文件系统直接遍历就够                   │
  └──────────────────────────────────────┘

Phase 2: 增长 (50-500 页)
  ┌──────────────────────────────────────┐
  │ 多个子主题，交叉引用密集               │
  │ index.md 开始变长                     │
  │ 引入 FTS5 全文搜索                    │
  │ 引用图开始显现价值                     │
  │ 需要定期 lint 检查                    │
  └──────────────────────────────────────┘

Phase 3: 大规模 (500-5000 页)
  ┌──────────────────────────────────────┐
  │ 知识图谱成为核心导航工具               │
  │ 社区发现帮助识别知识簇                 │
  │ 陈旧性传播确保知识新鲜度               │
  │ 混合搜索 (关键词 + 向量) 可能必要       │
  └──────────────────────────────────────┘

Phase 4: 超大规模 (5000+ 页)
  ┌──────────────────────────────────────┐
  │ 引入向量数据库 (LanceDB/Postgres)      │
  │ 自动摘要生成                           │
  │ 知识空白智能发现                       │
  │ 多工作区分域                           │
  └──────────────────────────────────────┘
```

本项目初期定位在 Phase 1→2 过渡，优先实现 FTS5 搜索 + 引用图 + 文件监视器。

## 八、总结：LLM Wiki 模式的核心价值

```
LLM Wiki 不是又一个 RAG 系统。
它回答了一个更根本的问题：

  知识不是一次查询的结果，
  而是持续累积的产物。

如果你只问一次 → RAG 就够了。
如果你要持续深入地理解一个领域 → 你需要 LLM Wiki。

Karpathy 的洞察:
  连接文档之间的"关联线索"和文档本身一样有价值。
  Vannevar Bush (1945) 想到但无法实现的部分——谁来做维护？
  LLM 来。
```

---

## 相关文档

- [功能对比矩阵](13-feature-comparison-matrix.md) — 跨 6 个来源的 145 功能维度对比
- [Gap 分析与路线图](14-gap-analysis-and-roadmap.md) — 本项目 17 个缺失功能的优先级分析
- [Wiki 目录组织分析](12-wiki-directory-organization.md) — 子目录和文本/资源分离深度分析
- [Karpathy 核心概念](01-karpathy-core-concept.md) — 原始 LLM Wiki 理念
