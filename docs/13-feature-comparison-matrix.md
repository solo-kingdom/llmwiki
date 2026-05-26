# LLM Wiki 功能对比矩阵

> 跨 6 个来源（Karpathy 原始理念 + 4 个参考实现 + 本项目 llmwiki Go）的全维度功能对比。
> 基于代码评审，反映**实际实现状态**。

## 图例

| 标记 | 含义 |
|:----:|------|
| ✅ | 功能可用且完整（已通过代码评审确认） |
| ⚠️ | 部分实现（存在但不完整或有已知 gap） |
| ❌ | 未实现 |
| — | 不适用（该实现不需要或定位不包含此功能） |

## 来源标识

| 简称 | 完整名称 | 技术栈 |
|------|----------|--------|
| **Karpathy** | Karpathy LLM Wiki Gist | 概念文档（非代码） |
| **nashsu** | nashsu/llm_wiki | Rust (Tauri v2) 桌面应用 |
| **Skilled** | LLM-Wiki-Skilled | OpenCode Agent Skills + Python |
| **lcasastorian** | lcasastorian/llmwiki | Python FastAPI + Next.js |
| **OmegaWiki** | DAIR-AI/OmegaWiki | Claude Code Skills + Python |
| **本项目** | llmwiki Go | Go 单二进制 + React SPA |

---

## 一、工作区基础

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **三层架构** (raw/wiki/schema) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **purpose.md** (目标/意图声明) | — | ✅ | — | — | — | ✅ |
| **schema.md** (结构约定) | ✅¹ | ✅ | — | — | — | — |
| **AGENTS.md / CLAUDE.md** (LLM 契约) | ✅¹ | — | ✅ | — | ✅ | — |
| **wiki/index.md** (内容目录) | ✅ | ✅ | ✅ | — | ✅ | ❌² |
| **wiki/log.md** (操作日志) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **wiki/overview.md** (全局总览) | — | ✅ | — | ✅ | — | ✅ |
| **workspace init 命令** | — | ✅ | — | ✅ | ✅ | ✅ |
| **reindex (删库可恢复)** | — | — | ✅³ | ⚠️⁴ | ✅ | ✅ |

> ¹ Karpathy 在概念中提到 schema 为第三层，未指定具体文件名  
> ² `wiki/index.md` 在 README 和文档中提及，但 `llmwiki init` 不会创建  
> ³ LLM-Wiki-Skilled 通过 `rebuild_index.py` 实现，可幂等重建且 `--check` 验证  
> ⁴ lcasastorian 的 `reindex` 不回填 frontmatter（tags 写死 `[]`），不重建引用图

### 工作区目录结构

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| `raw/sources/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `raw/assets/` | — | ✅ | ✅ | ❌ | — | ✅ |
| `raw/` 内细分 (papers/notes/web...) | — | — | — | — | ✅ | — |
| `raw/` 不可变策略 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **wiki 子目录**: entities | ✅ | ✅ | ✅ | —⁵ | ✅ | ✅ |
| **wiki 子目录**: concepts | ✅ | ✅ | ✅ | —⁵ | ✅ | ✅ |
| **wiki 子目录**: sources | ✅ | ✅ | ✅ | —⁵ | ✅ | ✅ |
| **wiki 子目录**: synthesis | ✅ | ✅ | ✅ | —⁵ | ✅⁶ | ❌⁷ |
| **wiki 子目录**: comparisons | ✅ | ✅ | — | —⁵ | — | ❌⁷ |
| **wiki 子目录**: queries | — | ✅ | — | —⁵ | — | ❌⁷ |
| `.obsidian/` 自动生成 | — | ✅ | —⁸ | — | —⁸ | ❌ |
| `.llmwiki/` (应用数据) | — | ✅⁹ | — | ✅ | — | ✅ |

> ⁵ lcasastorian 的 wiki 使用平铺结构，不强制子目录，通过 `source_kind` DB 列区分类型  
> ⁶ OmegaWiki 的子目录名略有不同：`syntheses`、`Summary`（大写 S）、9 种实体类型  
> ⁷ `llmwiki init` 只创建 entities/concepts/sources 三个子目录，但不创建 synthesis/comparisons/queries  
> ⁸ LLM-Wiki-Skilled 和 OmegaWiki 使用 `[[wikilink]]` 和 YAML frontmatter，技术上兼容但无自动配置  
> ⁹ nashsu 的隐藏目录名为 `.llm-wiki`（带连字符）

---

## 二、原始源处理

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Markdown/纯文本** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PDF 提取** | — | ✅ (pdfium) | — | ✅ (opendataloader) | ✅ (opendataloader) | ✅ (tiered) |
| **Office 文档** (docx/pptx/xlsx) | — | ✅ | — | ✅ (LibreOffice) | — | ✅ (tiered) |
| **HTML 网页** | — | — | — | ✅ (webmd parser) | — | ❌ |
| **图片提取** (从 PDF/Office) | — | ✅ | — | ❌ | — | ⚠️¹⁰ |
| **图片标注 (Vision Caption)** | — | ✅ | — | — | — | ❌ |
| **Web Clipper 扩展** | — | ✅ | — | ✅ | — | ❌ |
| **Obsidian Web Clipper 兼容** | ✅¹¹ | ✅ | ✅ | — | ✅ | — |
| **定时/自动导入** | — | ✅ | — | — | ✅ | ❌ |
| **TUS 可恢复上传** | — | — | — | ✅ | — | ❌ |
| **来源文件 SHA256 去重** | — | ✅ | — | — | — | ✅ |

> ¹⁰ 本项目的 source processing roadmap 中提到图片提取为 Layer C（fallback），当前未实现完整管道  
> ¹¹ Karpathy 在 gist 中推荐 Obsidian Web Clipper 作为获取网页源的工具

---

## 三、Wiki 页面管理

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **页面类型**: entity/concept/source | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **页面类型**: synthesis/comparison | ✅ | ✅ | ✅ | — | — | —¹² |
| **页面类型**: queries | — | ✅ | — | — | — | —¹² |
| **领域特化类型** (9 种/16 种边) | — | — | — | — | ✅ | — |
| **页面模板** (含必需章节) | — | — | ✅ | — | ✅ | ❌ |
| **Frontmatter 契约验证** | — | — | ✅ | ❌ | ✅ | ❌¹³ |
| **Frontmatter 完整回填 (reindex)** | — | — | ✅ | ❌ | ✅ | ✅ |
| **页面合并保护** (正文/字段锁定) | — | ✅ | — | — | — | ❌¹⁴ |
| **级联删除** (源→Wiki 页) | — | ✅ | — | — | — | ✅ |
| **双向链接不变量** | — | — | — | — | ✅ | ❌ |
| **Wikilink 解析** (`[[wikilink]]`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Markdown 链接解析** (`[text](path.md)`) | ✅ | ✅ | — | ✅ | — | ✅ |
| **页面保护** (overview/log 不可删除) | — | — | — | ✅ | — | ✅ |
| **文件名 slug 化** | — | — | — | ✅ | — | ✅ |

> ¹² synthesis/comparisons/queries 子目录在 `llmwiki init` 时不创建，但 LLM 在摄入时可能动态创建  
> ¹³ 本项目有 frontmatter 解析（`engine/frontmatter.go`），但不验证 type-vs-directory 一致性  
> ¹⁴ 本项目有并发锁（`ingest/lock.go`），但写入时直接覆盖现有文件，无正文合并逻辑

---

## 四、摄取 Pipeline

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **单步摄入** (LLM 一次性完成) | ✅ | — | ✅ | — | — | — |
| **两步骤摄入** (分析→生成) | — | ✅ | — | — | ✅ | ✅ |
| **Chain-of-Thought 嵌入摄入** | — | ✅ | — | — | — | ✅ |
| **SHA256 增量缓存** (跳过未变) | — | ✅ | — | — | — | ⚠️¹⁵ |
| **持久化摄入队列** (崩溃恢复) | — | ✅ | — | ✅ | — | ✅ |
| **全局串行摄入** (单队列) | — | ✅ | — | ✅ | — | ✅ |
| **并行摄入** (git worktrees) | — | — | — | — | ✅ | — |
| **摄入进度可视化** | — | ✅ | — | ✅ | — | ✅ |
| **失败重试** (最多 3 次) | — | ✅ | — | ✅ | ✅ | ✅ |
| **摄入取消** | — | ✅ | — | ✅ | — | ✅ |
| **两阶段重试** (pipeline vs commit) | — | — | — | — | — | ✅ |
| **Session (对话式) 摄入** | — | — | — | — | — | ✅ |
| **FILE 块协议解析** | — | ✅ | — | — | — | ✅ |
| **输出路径沙箱** (防路径穿越) | — | ✅ | — | ✅ | — | ✅ |
| **语言守卫** (检测正文语言) | — | ✅ | — | — | — | ❌ |
| **上下文预算控制** | — | ✅ | — | — | — | ❌ |

> ¹⁵ SHA256 缓存仅对文件直接摄入（`Ingest()`）生效，对 job-based `IngestNormalized()` 不生效

---

## 五、搜索与发现

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **索引目录遍历** (基于 index.md) | ✅ | ✅ | ✅ | — | ✅ | ❌¹⁶ |
| **FTS5 全文搜索** (BM25) | — | ❌ | — | ✅ | — | ✅ |
| **关键词分词** (CJK bigram) | — | ✅ | — | — | — | ❌ |
| **向量/语义搜索** (LanceDB) | — | ✅ | — | — | — | ❌ |
| **混合搜索 RRF 融合** | — | ✅ | — | — | — | ❌ |
| **搜索结果上下文片段** | — | ✅ | — | ✅ | — | ✅ |
| **文件浏览** (glob 匹配) | — | ✅ | ✅ | ✅ | — | ✅ |
| **按 tag 过滤搜索** | — | ✅ | — | — | — | ✅ |
| **引用图: cites** (脚注→源) | — | ❌ | — | ✅ | ✅ | ✅ |
| **引用图: links_to** (wiki→wiki) | — | ❌ | — | ✅ | ✅ | ✅ |
| **反向链接查询** | — | — | — | ✅ | ✅ | ✅ |
| **未引用源检测** | — | — | — | ✅ | — | ✅ |
| **陈旧页面检测** | — | — | — | ✅ | — | ✅ |
| **陈旧性传播** | — | — | — | ✅ | — | ✅ |
| **知识图谱查询** (边类型遍历) | — | — | — | — | ✅ | ❌ |

> ¹⁶ `wiki/index.md` 未生成，因此索引目录遍历不可用

### 知识图谱可视化

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **图可视化** (力导向布局) | — | ✅ (sigma.js) | — | — | ✅ (Cytoscape) | ❌ |
| **社区发现** (Louvain) | — | ✅ | — | — | ❌ | ❌ |
| **相关性模型** (多信号) | — | ✅ | — | — | — | ❌ |
| **图 Dashboard** | — | — | — | — | ✅ | ❌ |

---

## 六、Wiki 健康检查 (Lint)

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Lint 概念** (周期性健康检查) | ✅ | — | ✅ | — | ✅ | ❌ |
| **矛盾检测** | ✅ | — | — | — | — | ❌ |
| **过时声明检测** | ✅ | — | — | — | — | ❌ |
| **孤立页面检测** (无入链) | ✅ | — | — | — | ✅ | ❌ |
| **死链检测** (目标不存在) | — | — | — | — | ✅ | ❌ |
| **缺失交叉引用检测** | ✅ | — | — | — | — | ❌ |
| **数据空白检测** | ✅ | — | — | — | — | ❌ |
| **Frontmatter 验证** (必需字段/类型匹配) | — | — | ✅ | — | ✅ | ❌ |
| **Required Sections 验证** | — | — | ✅ | — | — | ❌ |
| **日志契约验证** (仅追加) | — | — | ✅ | — | ✅ | ❌ |
| **Wiki 统计** (页数/源数/更新日期) | ✅ | — | ✅ | — | ✅ | ❌ |
| **结构审计** (字段存档分类) | — | — | — | — | — | ✅¹⁷ |

> ¹⁷ 本项目的 `engine/dataaudit.go` 提供了字段分类审计（FileTruth/DBDerived/DBCached），但这是数据架构审计，不是 Wiki 内容健康检查

---

## 七、交互接口

### MCP Server

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **MCP 协议** (JSON-RPC 2.0) | — | — | — | ✅ | ✅ | ✅ |
| **stdio transport** | — | — | — | ✅ | ✅ | ✅ |
| **SSE transport** | — | — | — | ✅ | — | ❌ |
| **guide 工具** | — | — | — | ✅ | — | ✅ |
| **search 工具** (list/search/references) | — | — | — | ✅ | — | ✅ |
| **read 工具** (多格式+分页) | — | — | — | ✅ | — | ✅ |
| **write 工具** (create/edit/append) | — | — | — | ✅ | — | ✅ |
| **delete 工具** (path/glob) | — | — | — | ✅ | — | ✅ |
| **write 影响面报告** (backlinks) | — | — | — | ✅ | — | ✅ |
| **工具权限策略** | — | — | — | — | ✅ | ✅ |
| **MCP 能力声明** (health 端点) | — | — | — | — | — | ✅ |

### HTTP API

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **HTTP REST API** | — | ✅ | — | ✅ | ✅ | ✅ |
| **Token 认证** | — | ✅ | — | — | — | ❌ |
| **健康检查端点** | — | ✅ | — | ✅ | — | ✅ |
| **文档 CRUD 端点** | — | ✅ | — | ✅ | — | ✅ |
| **搜索端点** | — | ✅ | — | ✅ | — | ✅ |
| **摄取端点** (提交/状态) | — | ✅ | — | — | — | ✅ |
| **引用图端点** (backlinks/stale) | — | ❌ | — | ✅ | — | ✅ |
| **速率限制** | — | ✅ | — | ✅ | — | ❌ |
| **CORS** | — | — | — | — | — | ✅ |

### Web UI

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Web 前端** | — | ✅ | — | ✅ (Next.js) | ✅ (Vanilla JS) | ✅ (React SPA) |
| **Wiki Reader 独立视图** | — | ✅ | — | — | — | ✅ |
| **文件树导航** | — | ✅ | — | — | — | ✅ |
| **Markdown 渲染** (GFM) | — | ✅ | — | ✅ | — | ✅ |
| **文档大纲** (标题目录) | — | — | — | — | — | ✅ |
| **WYSIWYG 编辑器** | — | ✅ (Milkdown) | — | ✅ (TipTap) | — | ❌ |
| **知识图谱视图** | — | ✅ | ❌ | — | ✅ | ❌ |
| **摄入 Hub UI** | — | ✅ | — | — | — | ✅ |
| **摄入聊天 UI** | — | — | — | — | — | ✅ |
| **Jobs 管理页面** | — | ✅ | — | — | — | ✅ |
| **Timeline 页面** (Git log) | — | — | — | — | — | ✅ |
| **活动日志页面** | — | — | — | — | — | ✅ |
| **Settings 页面** | — | ✅ | — | — | — | ✅ |
| **搜索模态框** (Wiki 内) | — | — | — | — | — | ✅ |
| **Provider 实例管理 UI** | — | — | — | — | — | ✅ |
| **响应式/移动适配** | — | ✅ | — | — | — | ✅ |

### CLI

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **init 命令** | — | — | — | ✅ | ✅ | ✅ |
| **serve 命令** | — | — | — | ✅ | ✅ | ✅ |
| **mcp 命令** | — | — | — | ✅ | — | ✅ |
| **reindex 命令** | — | — | ✅ | ✅ | — | ✅ |
| **ingest 命令** | — | — | — | ✅ | — | ❌ |
| **mcp-config 命令** | — | — | — | ✅ | — | ❌ |

---

## 八、LLM 集成

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **OpenAI 兼容** | — | ✅ | — | — | ✅ | ✅ |
| **Anthropic 兼容** | — | ✅ | — | — | ✅ | ✅ |
| **Ollama 兼容** | — | ✅ | — | — | — | ❌ |
| **Google Gemini** | — | ✅ | — | — | — | ❌ |
| **Claude Code CLI (子进程)** | — | ✅ | — | — | — | ❌ |
| **Codex CLI (子进程)** | — | ✅ | — | — | — | ❌ |
| **MiniMax 特殊适配** | — | ✅ | — | — | — | ❌ |
| **Provider 实例管理** | — | ✅ | — | — | — | ✅ |
| **Provider 预设系统** | — | ✅ | — | — | — | ✅ |
| **Model 参数独立控制** | — | ✅ | — | — | — | ✅ |
| **流式响应 (SSE)** | — | ✅ | — | — | — | ✅ |
| **推理 token 检测** (`<think>`) | — | ✅ | — | — | — | ✅ |
| **LLM 健康探测** | — | — | — | — | — | ✅ |
| **网络代理支持** | — | ✅ | — | — | — | ❌ |
| **LLM 调用超时策略** | — | ✅ | — | — | — | ✅ |

---

## 九、扩展与兼容

| 功能 | Karpathy | nashsu | Skilled | lcasastorian | OmegaWiki | 本项目 |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Git 版本控制** | ✅¹⁸ | — | ✅¹⁸ | — | ✅ | ✅ |
| **Ingest 自动 commit** | — | — | — | — | — | ✅ |
| **LLM 智能回滚** | — | — | — | — | — | ✅ |
| **Timeline 历史视图** | — | — | — | — | — | ✅ |
| **Obsidian 兼容** | ✅¹⁹ | ✅ | ✅ | — | ✅ | ⚠️²⁰ |
| **Marp 幻灯片兼容** | ✅ | ✅ | — | — | — | ❌ |
| **Dataview 插件兼容** | ✅ | — | — | — | — | — |
| **i18n 多语言** | — | ✅ | ✅²¹ | — | ✅²² | ❌ |
| **Git 原生版本控制** | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **数据可移植性** (纯文件) | ✅ | ✅ | ✅ | ⚠️²³ | ✅ | ✅ |
| **跨平台** | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| **远程服务能力** | — | — | — | ✅ | — | ✅ |

> ¹⁸ Karpathy 在 gist 中提到"wiki is just a git repo of markdown files"，但 LLM-Wiki-Skilled 将此作为默认方式  
> ¹⁹ Karpathy 推荐 Obsidian 作为浏览工具  
> ²⁰ 本项目使用 `[[wikilink]]` 和 YAML frontmatter，技术上兼容，但缺少 `.obsidian/` 自动配置  
> ²¹ 仅 OpenCode Agent 对话层的双语支持（en/zh）  
> ²² OmegaWiki 的 26 个 skill 全部有 en/zh 双语版本  
> ²³ lcasastorian 需要 SQLite + 文件系统同时在场，纯文件系统不可独立使用

---

## 总结统计

| 分类 | 功能数 | 本项目 ✅ | 本项目 ⚠️ | 本项目 ❌ |
|------|:---:|:---:|:---:|:---:|
| 工作区基础 | 15 | 10 | 1 | 4 |
| 原始源处理 | 11 | 5 | 1 | 5 |
| Wiki 页面管理 | 14 | 7 | 2 | 5 |
| 摄取 Pipeline | 16 | 11 | 1 | 4 |
| 搜索与发现 (含图谱) | 19 | 11 | 0 | 8 |
| Wiki 健康检查 | 11 | 1 | 0 | 10 |
| 交互接口 (MCP+API+UI+CLI) | 33 | 30 | 0 | 3 |
| LLM 集成 | 14 | 8 | 0 | 6 |
| 扩展与兼容 | 12 | 7 | 1 | 4 |
| **合计** | **145** | **90** | **6** | **49** |

> 注：功能数量按 Karpathy 基准 + 普适增强计算，OmegaWiki 的领域特化功能（9 种实体、16 种边等）不在此列。
