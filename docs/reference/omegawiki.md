# OmegaWiki 分析

> 仓库: [DAIR-AI/OmegaWiki](https://github.com/DAIR-AI/OmegaWiki) · MIT
> 定位: **研究加速系统** — Claude Code Skill 系统，面向学术研究的全生命周期
> 团队: DAIR Lab, Peking University · 8 位贡献者

## 核心理念

OmegaWiki 是 Karpathy LLM-Wiki 模式在学术研究领域的**完整实现**。它不是简单的 Wiki 维护工具，而是覆盖论文发现→知识图谱→空白识别→想法生成→实验→论文写作→审稿回复的**完整研究生命周期系统**。

```
论文进入 → 知识图谱增长 → 研究想法产出
    ↑                        ↓
审稿回复 ← 论文写作 ← 实验验证
```

## 与 Karpathy 原始模式的关系

OmegaWiki 在三个核心操作上进行了大幅扩展：

| Karpathy 原始 | OmegaWiki 扩展 |
|---------------|---------------|
| Ingest | `/init` (批量并行) + `/ingest` (单篇) |
| Query | 内置知识图谱查询 + 26 个 /command |
| Lint | `tools/lint.py` — 10+ 机械检查 |
| — | `/ideate` 想法生成 |
| — | `/exp-*` 实验全流程 |
| — | `/paper-*` 论文全流程 |
| — | `/daily-arxiv` 自动化论文发现 |
| — | `/discover` 论文智能发现 |

## 系统架构

四层架构：

```
┌─────────────────────────────────────────────────────────┐
│  Skills 层 (.claude/skills/)                            │
│  26 个 Claude Code slash 命令                           │
│  每个是 SKILL.md: 输入/输出/流程/约束/错误处理             │
│  角色: 编排者 (Orchestrator) — 使用 LLM 推理做多步决策    │
├─────────────────────────────────────────────────────────┤
│  Runtime 层 (runtime/)                                  │
│  单一真理源: 什么在 Wiki 中结构合法的定义                    │
│  YAML-only: entities.yaml, edges.yaml, xref.yaml         │
│  loader.py: 自动派生常量, 零代码变更                      │
├─────────────────────────────────────────────────────────┤
│  Tools 层 (tools/)                                      │
│  确定性 Python 工具, 无 LLM 调用                         │
│  research_wiki.py (wiki 引擎, 20+ CLI 命令)              │
│  lint.py (结构验证, 10+ 检查)                             │
│  discover.py (论文发现/排序)                               │
│  其他: serve, remote, visualize, poster...               │
├─────────────────────────────────────────────────────────┤
│  Web UI 层 (app/)                                       │
│  纯 JS SPA: Cytoscape 图可视化 + 阅读器 + Dashboard       │
│  SSE 实时更新, 技能意图合成                                │
└─────────────────────────────────────────────────────────┘
```

## 9 种实体类型 (Entity Types)

这是 OmegaWiki 最大胆的设计选择——远比通用的 entity/concept 更细分：

| 类型 | 目录 | 关键字段 | 说明 |
|------|------|----------|------|
| **papers** | `wiki/papers/` | arxiv_id, venue, year, s2_id, contribution_type, cited_by, tldr | 学术论文核心实体 |
| **concepts** | `wiki/concepts/` | maturity (stable/active/emerging/deprecated), definition, key_papers, first_introduced | 学术概念 |
| **topics** | `wiki/topics/` | key_venues, key_people, linked_ideas | 研究主题/子领域 |
| **people** | `wiki/people/` | affiliation, research_areas, scholar | 研究人员/团队 |
| **ideas** | `wiki/ideas/` | status 状态机: proposed→in_progress→tested→validated\|failed, novelty_score, pilot_result, failure_reason | **核心创新**：研究想法生命周期 |
| **experiments** | `wiki/experiments/` | status: planned→running→completed\|abandoned, linked_idea, hypothesis, setup, baseline, outcome | 与 idea 配对 |
| **methods** | `wiki/methods/` | type (architecture\|training\|inference\|...\|other), source_papers, parent_methods, code_repo | 技术方法分类学 |
| **Summary** | `wiki/Summary/` | scope, key_topics, paper_count | 主题综合摘要 |
| **foundations** | `wiki/foundations/` | terminal=true, status (mainstream\|historical), aliases | 基础知识（终点节点） |

### 知识图谱：16 种边类型

```
论文-论文语义关系 (ingest 产生):
  same_problem_as, similar_method_to, complementary_to,
  builds_on, compares_against, improves_on, challenges, surveys
  全部带有 confidence (high|medium|low) + evidence

论文-概念关系:
  introduces_concept, uses_concept, extends_concept, critiques_concept

工作流关系 (跨类型):
  supports (证据), contradicts (证据), tested_by (实验),
  invalidates (实验), addresses_gap (想法), derived_from (来源),
  inspired_by (想法)

引用:
  cites (论文→论文, 含 source + date 属性)
```

## Skill/Tool 分离原则

**核心架构决策**：

```
Skills (LLM 推理) → 编排多步流程，调用工具
Tools (Python)    → 执行确定性操作，不涉及 LLM

Skills 永远不包含确定性逻辑
Tools 永远不包含 LLM 调用
```

这个分离严格执行在 CONTRIBUTING.md 中。

## 26 个 Slash 命令（分四个阶段）

### Phase 1: Setup（设置）
| 命令 | 用途 |
|------|------|
| `/setup` | 一键配置 API keys 和依赖 |
| `/init [topic]` | 初始化并**并行**摄取种子论文 |
| `/reset` | 清理 wiki 数据 |

### Phase 2: Knowledge Foundation（知识建设）
| 命令 | 用途 |
|------|------|
| `/ingest` | 摄取单篇论文（含源码和外部元数据） |
| `/discover` | 智能发现论文 (4 种模式: from-anchors/from-topic/from-wiki/from-venue) |
| `/daily-arxiv` | 每日 arXiv 自动化（GitHub Actions） |
| `/prefill` | 预填充基础概念 (Wikipedia + 标准定义) |
| `/survey` | 生成文献综述 |
| `/research` | 深入调研某个主题 |
| `/refine` | 人工细化 wiki 页面 |
| `/check` | 检查知识库空白和质量 |
| `/novelty` | 评估想法的创新性 |
| `/visualize` | 生成知识图谱可视化 |

### Phase 3: Research Pipeline（研究流水线）
| 命令 | 用途 |
|------|------|
| `/ideate` | 5 阶段想法生成（双模型头脑风暴） |
| `/exp-design` | 设计实验 |
| `/exp-run` | 运行实验（本地或远程 GPU） |
| `/exp-pilot-run` | 运行预实验 |
| `/exp-eval` | 评估实验结果 |
| `/exp-pilot-eval` | 评估预实验结果 |
| `/exp-status` | 查看实验状态 |

### Phase 4: Writing & Submission（写作与投稿）
| 命令 | 用途 |
|------|------|
| `/paper-plan` | 论文大纲规划 |
| `/paper-draft` | LaTeX 论文草稿 |
| `/paper-compile` | 编译论文 |
| `/rebuttal` | 逐条审稿回复 |
| `/poster` | 会议海报生成 |

## 关键设计决策

### 1. YAML-Only 契约 (No-Code Schema)
实体类型、边类型、xref 规则、约定全部在 YAML 中定义。添加新实体类型或边类型**不需要任何 Python 代码变更**——`runtime/loader.py` 自动派生所有常量。这是刻意的"无代码生成步骤"哲学。

### 2. 双向链接不变量 (Bidirectional Link Invariant)
每条前向链接必须同时写入反向链接。这在 `runtime/schema/xref.yaml` 中定义（10 条前向→反向规则）。这确保知识图谱永远一致。Foundations 页被豁免（终点节点）。

### 3. 所有权分区 (Ownership Zones)
- **人所有** (`raw/`): 只读，技能不可写
- **工具所有** (`wiki/graph/`): 只能通过 `research_wiki.py` 修改
- **仅追加** (`wiki/log.md`): 永远不在原地重写
- **技能标志文件**：人所有，技能只读

### 4. 失败实验是一等公民 (Failed Experiments as First-Class)
失败的 idea 和 experiment 不被丢弃，而是变成**反重复记忆**（`status: failed` + `failure_reason`），防止系统重新探索已经证明的死胡同。

### 5. 双模型审核 (Cross-Model Review)
`llm-review` MCP server 提供独立的第二 LLM 对研究产出的审核。审核 LLM 在形成独立评估之前永远看不到 Claude 自己的分析（审核独立性原则）。

### 6. 双语一等公民 (Bilingual First-Class)
每个 skill、共享引用、运行时契约都存在英文（规范源）和中文两个版本。`setup.sh --lang` 选择语言并 symlink 活动文件。

### 7. 并行安全架构 (Parallel-Safe Architecture)
`.gitattributes` 使用 `merge=union` 处理并行摄入时累积的共享文件。`/init` 工作流为每篇论文创建 git worktree 来避免文件冲突。

## 文件组织特点

```
OmegaWiki/
├── CLAUDE.md              ← LLM 运行契约（根级别，Claude 第一读取）
├── .claude/skills/        ← 26 个技能定义（Claude Code 自动发现）
│   └── */SKILL.md + references/
├── i18n/{en,zh}/          ← 技能规范源（CLAUDE.md + 所有 SKILL.md）
│   └── skills/*/SKILL.md  ← setup.sh 复制到 .claude/skills/
├── runtime/               ← 单一定义源（YAML-only Schema）
│   ├── schema/            ← entities.yaml, edges.yaml, xref.yaml
│   ├── policy/            ← writers.yaml (写权限)
│   ├── templates/         ← *.md.tmpl (页面模板)
│   └── loader.py          ← Python 访问 API（解析 YAML）
├── tools/                 ← 确定性 Python 工具
├── wiki/                  ← LLM 创建的内容（.gitkeep 占位）
│   ├── index.md, log.md   ← 两个基础文件
│   ├── papers/, concepts/, .../  ← 9 个实体目录 (.gitkeep)
│   └── graph/             ← 工具生成的图文件 (.gitkeep)
├── raw/                   ← 人拥有的源文件 (.gitkeep)
├── config/                ← 配置模板
├── docs/                  ← 人类文档
├── app/                   ← Web UI (纯 JS SPA)
└── mcp-servers/           ← MCP 服务器 (llm-review)
```

## 引用关系

OmegaWiki 的 wiki/graph/ 不使用数据库，而是使用 JSONL 文件：
- `edges.jsonl` — 语义关系边
- `citations.jsonl` — 文献引用
- `context_brief.md` — 压缩的全局上下文
- `open_questions.md` — 知识空白地图

每行 JSONL: `{"source": "papers/transformer", "target": "concepts/attention", "type": "introduces_concept", "confidence": "high", "evidence": "Section 3.1"}`

## 适用场景

最适合：
- 学术研究人员（博士生、教授、实验室）
- 需要跟踪研究领域进展
- 从阅读论文到产出论文的全流程
- 团队协作研究
- 每天自动跟踪 arXiv 新论文

相比之下不适合：
- 非学术领域的知识管理
- 轻量级个人 Wiki
- 不需要实验管理的场景
