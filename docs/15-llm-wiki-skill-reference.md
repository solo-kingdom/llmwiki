# LLM Wiki Skill 参考文档

> 综合分析 Karpathy 原始理念 + 5 个参考实现的 Skill 设计精华，结合本项目（llmwiki Go）的实际架构。
> 描述截至 2026-05 的实现状态。

---

## 一、跨实现 Skill 系统对比

### 1.1 五个参考实现

```
Karpathy LLM Wiki 模式
        │
    ┌───┼───┬───┬───┐
    ▼   ▼   ▼   ▼   ▼
  nashsu   lcasastorian  llm-wiki-skill  LLM-Wiki-Skilled  OmegaWiki
 (桌面应用)  (Web 平台)    (Claude Code)    (OpenCode)      (研究平台)
```

### 1.2 Skill 系统对比表

| 维度 | nashsu/llm_wiki | lcasastorian/llmwiki | llm-wiki-skill | LLM-Wiki-Skilled | OmegaWiki |
|------|-----------------|----------------------|----------------|------------------|-----------|
| **Skill 格式** | 无（内置引擎） | MCP 工具描述 | 1 个 SKILL.md (1133 行) | 3 个 SKILL.md (~40 行) | 29 个 SKILL.md (~200 行) |
| **工作流数** | 18 个 Tauri 命令 | 5 个 MCP 工具 | 10 个工作流 | 3 个工作流 | 29 个 skill |
| **触发方式** | GUI 按钮触发 | MCP tools/call | Agent 读取 SKILL.md | Agent 读取 SKILL.md | Agent 读取 SKILL.md |
| **交互模型** | 应用内 LLM 调用 | MCP stdio + HTTP | Agent 对话 | Agent 对话 | Agent 对话 |
| **定位** | 全功能桌面应用 | Web 平台 + MCP | 通用知识库 Agent Skill | 极简 Agent Skill | 学术研究平台 |
| **技术栈** | Rust/Tauri/React | Python/FastAPI/Next.js | Shell 脚本 + Agent | OpenCode Agent | Claude Code + Python |
| **多语言** | ✅ (i18n) | ❌ | ✅ (中/英) | ✅ (中/英) | ✅ (中/英) |
| **领域** | 通用 | 通用 | 通用 | 通用 | 学术研究特化 |

### 1.3 交互模型分类

```
┌─────────────────────────────────────────────────────────────┐
│                   LLM ↔ Wiki 交互模型                        │
│                                                               │
│  模型 A: 内置引擎                                              │
│  ┌──────────┐  nashsu/llm_wiki                                │
│  │ LLM API  │  应用内直接调用 LLM API 编排摄入                   │
│  │ 调用在   │  用户通过 GUI 触发                                 │
│  │ 应用内   │                                                  │
│  └──────────┘                                                  │
│                                                               │
│  模型 B: MCP 服务                                              │
│  ┌──────────┐  lcasastorian/llmwiki                          │
│  │ Agent 通过│  Agent 通过 MCP 工具操作 Wiki                    │
│  │ MCP 工具 │  人通过 Web UI 操作                               │
│  └──────────┘                                                  │
│                                                               │
│  模型 C: Skill 系统                                            │
│  ┌──────────┐  llm-wiki-skill / LLM-Wiki-Skilled / OmegaWiki  │
│  │ Agent 读取│  Agent 读取 SKILL.md 遵循指令操作                 │
│  │ SKILL.md │  文件系统为中介                                   │
│  └──────────┘                                                  │
│                                                               │
│  模型 D: 混合 (本项目)                                         │
│  ┌──────────┐  llmwiki Go                                     │
│  │ 代码内   │  Prompt 系统驱动 LLM，MCP 工具暴露给外部 Agent     │
│  │ Prompt + │  Local Tool 在 Session 内供 LLM 调用              │
│  │ MCP 工具 │  Web UI / CLI / MCP 三元入口                      │
│  └──────────┘                                                  │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 从参考实现中提取的设计精华

| 来源 | 关键设计 | 本项目是否采纳 |
|------|----------|:---:|
| **llm-wiki-skill** | 工作流路由表（10 个工作流按关键词路由） | ⬚ 参考（本项目通过 UI 模式区分） |
| **llm-wiki-skill** | 隐私自查提示（摄入前检查敏感信息） | ⬚ 参考（可在 rules.md 中配置） |
| **llm-wiki-skill** | 内容分级处理（>1000 字完整 / ≤1000 字简化） | ⬚ 参考（LLM 自行判断） |
| **llm-wiki-skill** | 别名展开查询（同义词组搜索） | ❌ 未采纳 |
| **LLM-Wiki-Skilled** | 极简 Skill 结构 + 严格 Done Criteria | ✅ 采纳（lint 检查即 Done Criteria） |
| **LLM-Wiki-Skilled** | Guardrails 模式（前置检查 + 不可变约束） | ✅ 采纳（格式契约 + 忠实性指令） |
| **OmegaWiki** | 双向链接不变量（写前链同时写反链） | ✅ 部分采纳（引用图 + Lint 检查） |
| **OmegaWiki** | 置信度标注（EXTRACTED/INFERRED/AMBIGUOUS） | ❌ 未采纳 |
| **nashsu** | 两步骤摄入（分析 → 生成） | ✅ 采纳（StepAnalysis → StepGeneration） |
| **nashsu** | 页面合并保护三层（锁定字段/数组合并/正文 LLM 合并） | ✅ 采纳（`ingest/merge.go`） |
| **nashsu** | 4 信号相关性模型 + Louvain 社区发现 | ❌ 未采纳（Go 生态限制） |
| **lcasastorian** | MCP 5 工具集 + 引用图引擎 + 陈旧性传播 | ✅ 采纳 |

---

## 二、本项目架构与 Skill 定位

### 2.1 为什么不使用 SKILL.md

本项目的 LLM 不是通过读取 SKILL.md 文件来工作的，而是通过代码内 `ComposeSystemPrompt()` 函数按步骤分发 prompt。这与 llm-wiki-skill、LLM-Wiki-Skilled、OmegaWiki 的模式根本不同：

```
参考实现模式:                    本项目模式:
  Agent → 读取 SKILL.md → 执行    服务内 Prompt → LLM → 工具调用 → 写入
  （LLM 是外部 Agent）            （LLM 是服务内嵌的执行引擎）
```

因此，本项目不需要 `.opencode/skills/` 下的 SKILL.md 文件。LLM 的行为由以下机制控制：

1. **代码内 Prompt**（`internal/ingest/prompts.go`）：9 个 PromptStep，中英双语
2. **工作区配置文件**：`purpose.md`（研究目标）、`rules.md`（写作规则）、`.llmwiki/prompts.yaml`（步骤追加）
3. **Settings API**：`rules_supplement`（运行时补充规则）、`doc_language`（文档语言）

### 2.2 三元入口架构

```
                     ┌─────────────────────────────────────┐
                     │        llmwiki (Go 单二进制)          │
                     │        ./llmwiki serve               │
                     ├─────────────────────────────────────┤
                     │  ┌──────────┐ ┌──────────┐ ┌──────┐ │
                     │  │ MCP/SSE  │ │ HTTP API │ │ CLI  │ │
                     │  │ (stdio)  │ │ (REST)   │ │(cobra)│ │
                     │  ├──────────┤ ├──────────┤ ├──────┤ │
                     │  │ 给外部   │ │给 Web UI │ │给人  │ │
                     │  │ Agent    │ │+ 远程服务│ │/LLM  │ │
                     │  └────┬─────┘ └────┬─────┘ └──┬───┘ │
                     │       └──────┬─────┴──────────┘     │
                     │         Core Service                │
                     │   摄取引擎 · 搜索 · 引用图 · 监视     │
                     │         SQLite + Filesystem         │
                     │   Embedded React/Vite/TS Web UI     │
                     └─────────────────────────────────────┘
```

### 2.3 两套工具体系

```
┌──────────────────────────────────────────────────────────────┐
│ MCP 工具 (外部 Agent 用)          │ Local 工具 (Session 内 LLM 用)  │
│ internal/mcp/tools.go            │ internal/mcp/local_tools.go    │
│                                  │                                │
│ guide   → 工作区概览              │ search   → 全文搜索 + 浏览     │
│ search  → list/search/ref/lint   │ read     → 读取文档            │
│ read    → 读取文档                │ web_fetch → 获取网页内容       │
│ write   → 创建/编辑 wiki 页面     │ references → 引用图查询        │
│ delete  → 删除文档(保护系统页)    │ audit    → Wiki 健康诊断       │
│ ping    → 连通性测试              │ structure → Wiki 目录结构      │
│                                  │ gaps     → 知识空白检测        │
│                                  │ similar  → 相似页面查找        │
└──────────────────────────────────────────────────────────────┘
```

MCP 工具面向外部 Agent（Claude Desktop / Claude Code），操作粒度较粗。
Local 工具面向摄入 Session 内的 LLM 调用，操作粒度更细，支持 audit/structure/gaps/similar 等诊断类工具。

---

## 三、Ingest 工作流详解

### 3.1 完整步骤链

```
用户操作                        代码入口                        PromptStep
─────────────────────────────────────────────────────────────────────────
1. 打开摄入页面              →  Web UI IngestHub
2. 与助手对话 / 添加上下文    →  Session Chat API            →  StepSessionChat
3. (可选) 上传附件           →  AttachmentSummaryPrompt      →  (预处理)
4. 满意后点击「归档」         →  Archive API                  →  StepPlan
5. 展示审核卡片 (计划预览)    →  前端展示 Plan JSON
6. 确认计划                  →  Apply API
7. 分析源文档                →  Pipeline.runAnalysis()       →  StepAnalysis
   └ LLM 调用 search/read   →  Local Tool 循环
8. 生成 wiki 页面            →  Pipeline.runGeneration()     →  StepGeneration
   └ LLM 输出 FILE 块       →  解析 → 合并 → 写入文件
9. (如需合并) 正文合并       →  mergeBody()                  →  StepMergeBody
10. 更新索引 + 引用图        →  FileIndexer + References
11. 完成                     →  Job 状态更新为 succeeded
```

### 3.2 工具调用序列

摄入过程中 LLM 通过 Local Tool 循环调用：

| 阶段 | PromptStep | 工具调用 | 目的 |
|------|-----------|----------|------|
| 分析 | StepAnalysis | `search` → `read` | 搜索已有相关页面，读取内容以避免重复 |
| 生成 | StepGeneration | `read` | 读取已有页面内容，确保合并而非覆盖 |
| 回滚 | StepRollback | `read` | 读取当前文件内容，生成回滚后的版本 |

工具循环参数（`internal/mcp/local_tools.go`）：

| Session 模式 | MaxRounds | MaxToolCallsPerRound | 温度 | MaxTokens |
|:---:|:---:|:---:|:---:|:---:|
| chat (默认) | 8 | 4 | 0.7 | 2048 |
| qa | 6 | 4 | 0.5 | 2048 |
| organize | 12 | 4 | 0.6 | 3072 |

### 3.3 与 nashsu 两步骤摄入的对比

```
nashsu (Tauri 桌面应用):               本项目 (Go 服务):
─────────────────────────────────────────────────────────
Step 1: Analysis                      StepAnalysis
  temperature=0.1                       ← 由 Session 模式决定
  max_tokens=4096                       ← 由 Provider 配置决定
  reasoning=off                         ← 无特殊推理设置
                                       
Step 2: Generation                    StepGeneration
  temperature=0.1                       ← 同上
  max_tokens=8192                       ← 同上
  输出 ---FILE:path 块                  ← 相同的 FILE 块协议
                                       
页面合并保护:                           页面合并保护:
  数组字段: 确定性联合                   ✅ 相同 (merge.go)
  正文: LLM 辅助合并 + 70% 长度 guard   ✅ 相同
  锁定字段: type/title/created          ✅ 相同
                                       
新增:                                  新增:
  - SHA256 增量缓存                     ✅ 已实现 (cache.go)
  - 持久化摄入队列                      ✅ 已实现 (job 系统)
  - Session 对话式摄入                  ✅ 本项目独创
  - 智能回滚                            ✅ 本项目独创 (rollback.go)
```

---

## 四、Query 工作流详解

### 4.1 两种 Session 模式

```
┌─────────────────────────────────────────────────────────────┐
│                     Query 工作流                              │
│                                                               │
│  ┌───────────────┐          ┌─────────────────┐              │
│  │   QA 模式      │          │  Organize 模式    │              │
│  │               │          │                 │              │
│  │ StepSessionQA │          │StepSessionOrganize│              │
│  │ 温度: 0.5     │          │ 温度: 0.6       │              │
│  │ 轮次: 6       │          │ 轮次: 12        │              │
│  │ 定位: 知识问答 │          │ 定位: 结构优化    │              │
│  │               │          │                 │              │
│  │ 工具:         │          │ 工具:            │              │
│  │ search        │          │ search          │              │
│  │ read          │          │ read            │              │
│  │ web_fetch     │          │ web_fetch       │              │
│  │ references    │          │ references      │              │
│  │               │          │ audit           │              │
│  │               │          │ structure       │              │
│  │               │          │ gaps            │              │
│  │               │          │ similar         │              │
│  └───────┬───────┘          └────────┬────────┘              │
│          │                           │                        │
│          └──────── 归档 ─────────────┘                        │
│                    │                                           │
│                    ▼                                           │
│            StepPlanQA / StepPlanOrganize                       │
│                    │                                           │
│                    ▼                                           │
│            StepGeneration (写入 FILE 块)                       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 工具调用顺序

**QA 模式**：
```
用户提问
  → search(query, mode="search")  # 全文搜索
  → read(path)                    # 读取相关页面
  → references(query)             # 查看引用关系
  → 综合回答 + 引用来源
  → (可选) 归档到 wiki/queries/
```

**Organize 模式**：
```
用户描述重组意图
  → structure()                   # 获取 Wiki 目录结构 (必须先调用)
  → audit()                       # 获取健康诊断 (必须第二步调用)
  → read(path)                    # 深入阅读具体页面
  → gaps()                        # 检测知识空白
  → similar(query)                # 查找相似页面
  → 给出重组方案
  → (可选) 归档重组计划
```

### 4.3 结果归档流程

```
对话 → 用户点击「归档」
         │
         ▼
  StepPlan (生成计划 JSON)
    {
      "summary": "...",
      "changes": [
        {"path": "wiki/entities/X.md", "action": "create|update", "rationale": "..."}
      ]
    }
         │
         ▼
  前端展示审核卡片 → 用户确认
         │
         ▼
  StepGeneration (执行计划，输出 FILE 块)
    ---FILE: wiki/entities/X.md
    (markdown content)
    ---END FILE---
         │
         ▼
  写入文件系统 → 更新索引 → 更新引用图
```

### 4.4 与参考实现的对比

| 特性 | llm-wiki-skill | LLM-Wiki-Skilled | OmegaWiki | 本项目 |
|------|:-:|:-:|:-:|:-:|
| 搜索策略 | index.md 遍历 + Grep | index.md 遍历 | index.md + 工具搜索 | FTS5 全文 + Local Tool |
| 别名展开 | ✅ (别名词表) | ❌ | ❌ | ❌ |
| 上下文预算 | 每关键词 3 段, 总 15 段 | 无限制 | 无限制 | 由 MaxRounds 间接控制 |
| 结果持久化 | wiki/queries/ | wiki/syntheses/ | wiki/graph/ | wiki/queries/ (通过归档) |
| 深度报告 | digest 工作流 (独立) | 合并在 query 中 | /survey skill | organize 模式 |

---

## 五、Lint 工作流详解

### 5.1 已实现的检查项

```
engine/lint.go — LintWorkspace() 检查流水线
──────────────────────────────────────────────

1. 收集所有 wiki/*.md 页面
     │
2. 对每个页面:
     ├─ frontmatter 验证 (frontmatter.go)
     │   ├─ missing_frontmatter: 必需字段缺失 (title/type/date)
     │   └─ type_dir_mismatch: type 与目录不匹配
     │
     ├─ 错位页面检测 (wiki_org.go)
     │   └─ misplaced_wiki_page: 业务页不在 typed 子目录
     │
     └─ 链接检查
         └─ dead_link: [[wikilink]] 或 [text](path) 目标不存在

3. 孤立页面检测
     └─ orphan_page: 无入链的 wiki 页面
        (排除: 系统页、wiki/sources/ 下的摘要页)

4. 日志格式验证 (log_validator.go)
     ├─ log_format_invalid: 条目前缀格式错误
     └─ log_date_decreasing: 日期非递减 (违反仅追加契约)

5. 统计: 页数/源数/最后更新日期
```

### 5.2 检查码速查表

| 检查码 | 严重度 | 说明 | 代码位置 |
|--------|:---:|------|----------|
| `dead_link` | error | 死链：链接目标不存在 | `lint.go:96-111` |
| `missing_frontmatter` | error | 缺少必需 frontmatter 字段 | `frontmatter.go` |
| `type_dir_mismatch` | warning | type 字段与目录不匹配 | `frontmatter.go` |
| `misplaced_wiki_page` | warning | 业务页不在 typed 子目录 | `wiki_org.go` |
| `orphan_page` | warning | 孤立页面：无入链 | `lint.go:114-126` |
| `log_format_invalid` | error | 日志条目格式错误 | `log_validator.go` |
| `log_date_decreasing` | error | 日志日期非递减 | `log_validator.go` |

### 5.3 触发方式

```
方式 1: MCP 工具 (外部 Agent)
  search(mode="lint")
  → 调用 engine.LintWorkspace()
  → 返回格式化报告 (中文)

方式 2: Local 工具 (Session 内 LLM)
  audit(workspace, args)
  → 调用 engine.LintWorkspace()
  → 返回格式化报告

方式 3: HTTP API
  GET /api/v1/search?mode=lint
  (未来可扩展为独立 Lint 端点)
```

### 5.4 与 Karpathy 原始概念的对应

| Karpathy 原始 Lint 检查 | 本项目状态 | 对应检查码 |
|--------------------------|:---:|-----------|
| 页面间矛盾 | ❌ 未实现 (需 LLM) | — |
| 过时声明 | ⚠️ 部分实现 | `staleness.go` (陈旧性传播) |
| 孤立页面 | ✅ | `orphan_page` |
| 被提及但缺独立页面的概念 | ❌ 未实现 | — |
| 缺失的交叉引用 | ❌ 未实现 | — |
| 可通过网络搜索填补的数据空白 | ❌ 未实现 | — |
| Frontmatter 一致性 | ✅ | `type_dir_mismatch`, `missing_frontmatter` |
| 日志格式 | ✅ | `log_format_invalid`, `log_date_decreasing` |
| 错位页面 | ✅ | `misplaced_wiki_page` |
| 死链 | ✅ | `dead_link` |

### 5.5 未来阶段

```
阶段 2 (已有基础设施):
  - 陈旧声明检测: 利用 stale_since 字段，在 Lint 中暴露
  - 缺失交叉引用: 分析页面正文中提及但未创建的概念

阶段 3 (需 LLM 参与):
  - 矛盾检测: LLM 对比多个页面的同一主题描述
  - 知识空白检测: LLM 分析 wiki 覆盖度，建议新页面
```

---

## 六、Prompt 系统设计映射

### 6.1 PromptStep 与 Session 模式映射

```
┌──────────────────────────────────────────────────────────────┐
│                   PromptStep 完整映射                          │
│                                                                │
│  入口: ComposeSystemPrompt(step, ctx)                          │
│                                                                │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 文件摄入管线                                         │       │
│  │                                                       │       │
│  │ StepAnalysis      ← 源文档分析（识别实体/概念/连接）    │       │
│  │ StepGeneration    ← 生成 FILE 块（wiki 页面产出）      │       │
│  │ StepMergeBody     ← 正文合并（旧+新 → LLM 合并）       │       │
│  │ StepRollback      ← 回滚（撤回摄入，恢复旧内容）       │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ Session 模式                                         │       │
│  │                                                       │       │
│  │ StepSessionChat    ← 摄入对话（默认模式）              │       │
│  │ StepSessionQA      ← 知识问答                        │       │
│  │ StepSessionOrganize← 结构优化                        │       │
│  │                                                       │       │
│  │ 归档计划:                                              │       │
│  │ StepPlan           ← 通用摄入计划                     │       │
│  │ StepPlanOrganize   ← 整理模式归档计划                 │       │
│  │ StepPlanQA         ← 问答模式归档计划                 │       │
│  └─────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 ComposeSystemPrompt 叠加机制

```
ComposeSystemPrompt(step, ctx) 的叠加顺序:
═══════════════════════════════════════════

1. lockedFormatInstruction(step)          ← 格式契约（不可违反）
   ├─ Generation/Rollback: FILE 块格式
   ├─ Plan: 仅输出计划 JSON
   └─ Session*: 对话消息格式

2. FidelityInstruction(docLang)           ← 内容忠实性（不可违反）
   └─ 所有事实必须基于源内容或已有 wiki 页面

3. defaultTaskInstruction(step, docLang)  ← 任务指令
   └─ 按 PromptStep 和语言选择对应的 prompt

4. TemplateGuidanceForGeneration()        ← 模板引导（仅 Generation 步骤）
   └─ 引导 LLM 参考页面模板的结构

5. purpose.md                            ← 工作区研究目标（≤5000 字符）
   └─ 从工作区根目录读取

6. rules.md                              ← 工作区写作规则（≤5000 字符）
   └─ 从工作区根目录读取

7. prompts.yaml 步骤追加                  ← 用户自定义 prompt 补充
   └─ 从 .llmwiki/prompts.yaml 读取

8. rules_supplement                      ← 运行时补充规则（≤2048 字符）
   └─ 从 Settings API 读取

9. languageInstructionForPipeline()       ← 语言约束
   └─ 根据 doc_language 设置生成语言指令
```

### 6.3 Session 模式 → PromptStep → 工具 → 参数 完整映射表

| Session 模式 | 对话 PromptStep | 归档 Plan PromptStep | 工具集 | 温度 | MaxRounds | Round 0 tool_choice |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| chat (默认) | StepSessionChat | StepPlan | search, read, web_fetch | 0.7 | 8 | — |
| qa | StepSessionQA | StepPlanQA | search, read, web_fetch, references | 0.5 | 6 | — |
| organize | StepSessionOrganize | StepPlanOrganize | search, read, web_fetch, references, audit, structure, gaps, similar | 0.6 | 12 | required (强制首轮调用工具) |

---

## 七、推荐工作流

### 7.1 场景一：新建知识库

```
1. llmwiki init ~/my-research
2. 编辑 purpose.md → 填写研究目标和关键问题
3. 可选: 编辑 rules.md → 添加领域约束和术语表
4. llmwiki serve ~/my-research
5. 在 Web UI「设置」中配置 Provider 和模型
6. 开始摄入第一批源材料
```

### 7.2 场景二：持续摄入

```
推荐工作流（每日/每周）:

1. 打开「摄入」页面
2. 选择操作模式:
   - 有新材料要消化 → 默认 chat 模式，对话探索后归档
   - 粘贴纯文本/笔记 → 「添加上下文」不触发 AI，归档时再处理
   - 上传 PDF/文件 → 附件上传，AI 读取后对话
3. 对话满意后 → 点击「归档」
4. 审核计划卡片 → 确认或修改
5. 在「任务」页面观察执行状态
6. 在「Wiki」页面阅读结果
```

### 7.3 场景三：定期维护

```
推荐工作流（每月/每季度）:

1. 在「设置」中检查 Provider 健康状态
2. 通过 MCP Agent 或 API 触发 Lint 检查
3. 查看报告，关注:
   - error 级: 死链、日志格式错误 → 立即修复
   - warning 级: 孤立页面、type 不匹配 → 评估后修复
4. 在「摄入」页面切换到 organize 模式
5. 描述重组需求（如"整理 concepts/ 下的重复页面"）
6. AI 使用 audit + structure 工具诊断后给出方案
7. 确认方案 → 归档执行
```

### 7.4 场景四：深度问答

```
推荐工作流:

1. 在「摄入」页面，Session 模式选择「问答」
2. 提出具体问题（如"X 和 Y 有什么关系？"）
3. AI 会调用 search → read → references 查找相关页面
4. AI 基于已有 wiki 内容综合回答
5. 如果回答有价值 → 点击「归档」保存到 wiki/queries/
6. 后续摄入时，query 页面视为二级来源
```

---

## 附录：关键代码位置索引

| 文件 | 职责 |
|------|------|
| `internal/ingest/prompts.go` | PromptStep 定义、ComposeSystemPrompt、中英 prompt 模板 |
| `internal/ingest/pipeline.go` | 摄入管线编排（Analysis → Generation） |
| `internal/ingest/merge.go` | 页面合并保护（锁定字段/数组合并/正文合并） |
| `internal/ingest/cache.go` | SHA256 缓存（含 IngestNormalized） |
| `internal/ingest/pipeline_review.go` | 计划审核（StepPlan 执行） |
| `internal/ingest/rollback.go` | 智能回滚 |
| `internal/mcp/tools.go` | MCP 工具注册（guide/search/read/write/delete） |
| `internal/mcp/local_tools.go` | Local 工具定义和路由（search/read/audit/structure/gaps/similar） |
| `internal/engine/lint.go` | Wiki 健康检查（死链/孤立/frontmatter/错位） |
| `internal/engine/frontmatter.go` | Frontmatter 解析和验证 |
| `internal/engine/log_validator.go` | 日志格式验证 |
| `internal/engine/templates.go` | 页面模板（6 种类型） |
| `internal/engine/scaffold.go` | 工作区初始化脚手架 |
| `internal/engine/reindex.go` | 重索引（从文件系统重建 SQLite） |
