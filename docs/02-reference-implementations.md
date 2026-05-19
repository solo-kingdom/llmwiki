# 参考实现分析

## 两个实现概览

```
Karpathy LLM Wiki 模式
        │
    ┌───┴───┐
    ▼       ▼
lucasastorian/llmwiki          nashsu/llm_wiki
├─ Python (FastAPI)            ├─ Rust (Tauri v2)
├─ Web + MCP 工具               ├─ 桌面应用
├─ SQLite + FTS5               ├─ 文件系统 + LanceDB
├─ 定位: Claude 的 Wiki 后端    ├─ 定位: 独立知识管理应用
└─ 核心: VaultFS 抽象           └─ 核心: 知识图谱 + 社区发现
```

---

## 实现一：lucasastorian/llmwiki

**仓库**: https://github.com/lucasastorian/llmwiki
**许可证**: Apache 2.0

### 架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Next.js    │────▶│   FastAPI    │────▶│   SQLite     │
│   Frontend   │     │   Backend    │     │   (FTS5)     │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │  MCP Server  │◀──── Claude Desktop / Code
                     │   (stdio)    │      5 个工具:
                     └──────┬───────┘      guide / search / read
                            │              write(create/edit/append)
                     ┌──────┴───────┐      / delete
                     │  Filesystem  │  ← 真理源
                     └──────────────┘
```

### 核心设计

#### VaultFS 抽象层（21 个接口）
支持双实现：`SqliteVaultFS`（本地）+ `PostgresVaultFS`（云端）

#### MCP 工具集（5 个工具）
| 工具 | 功能 |
|------|------|
| `guide` | 返回 Wiki 使用指南，列出工作区 |
| `search` | 三种模式：list（浏览）、search（FTS5 全文搜索）、references（引用图查询） |
| `read` | 按类型读取文档：PDF 按页、Office 按页、表格先列 Sheet、图片 Base64、批量 glob |
| `create/edit/append` | 三种写模式：新建、精确替换（str_replace）、尾部追加 |
| `delete` | 按路径/glob 删除，保护 overview.md 和 log.md |

#### 引用图引擎
- 脚注解析：`[^N]: file.pdf, p.3` → `cites` 边（含页码）
- Wiki 链接解析：`[text](path.md)` → `links_to` 边
- 三层目标匹配：精确文件名 → 去扩展名 base 匹配 → Wiki 相对路径匹配
- 去重：按 `(source, target, type)` 唯一约束
- 写入后自动同步引用图，返回影响面

#### 陈旧性传播
页面 B 更新后，所有 `links_to` 到 B 的页面自动标记 `stale_since`。`cites` 类型不触发（源文件修改不自动标记引用它的 Wiki 页）。

#### 文件监视器
- `watchfiles` 库监听文件系统变更 → 自动更新 SQLite 索引
- `mark_written()` + 2 秒冷却期防止自写入回环
- SHA256 哈希去重避免重复索引

#### 数据库 Schema（5 表 + 7 索引 + 3 触发器）
| 表 | 用途 |
|----|------|
| `workspace` | 单行，user_id 唯一 |
| `documents` | 核心文档（29 列）：source_kind 区分 wiki/source/asset，status 状态机 |
| `document_pages` | PDF/Office 的逐页提取内容，唯一 (document_id, page) |
| `document_chunks` | 搜索分块（512 tokens, 128 overlap），header_breadcrumb 标题面包屑 |
| `document_references` | 引用图边：cites（脚注→源）和 links_to（wiki 间），UNIQUE(source, target, type) |
| `chunks_fts` | FTS5 外部内容虚拟表，tokenize='porter unicode61' |

### 部署模式
| 模式 | 数据库 | 认证 | 存储 | CLI 命令 |
|------|--------|------|------|----------|
| local | SQLite + FTS5 | No-op | 本地文件系统 | `llmwiki init/serve/mcp` |
| hosted | PostgreSQL + PGroonga | Supabase JWKS | S3 | Docker |

### 关键发现：reindex 的不完整性
`llmwiki reindex` 删除并重建 documents 表，但 `_index_existing_files()` 存在 gap：
- **不回填 frontmatter**：tags 写死 `[]`，date 和 metadata 不设置
- **不重建引用图**：删除 documents 后 document_references 也 CASCADE 删除，但不会重新解析
- **不重建 chunks**：文本文件不重新分块

这意味着删 DB 后，tags/date/metadata 和引用图会丢失（虽然信息仍在 markdown 文件中）。

---

## 实现二：nashsu/llm_wiki

**仓库**: https://github.com/nashsu/llm_wiki
**许可证**: GPL v3

### 架构

```
┌─────────────────────────────────────────────────────┐
│                  Tauri v2 桌面应用                     │
├─────────────────────────────────────────────────────┤
│  前端：React 19 (Zustand) + Vite + shadcn/ui        │
│  后端：Rust (Tauri)                                  │
│  存储：LanceDB (向量) + 文件系统 (Markdown)           │
│  搜索：关键词 + 向量 (RRF 融合)                       │
│                                                      │
│  内置服务: HTTP API(:19828)  Clip Server(:19827)     │
└─────────────────────────────────────────────────────┘
```

### 对原始模式的增强（选取 18 项中的核心）

#### 1. purpose.md
原始只有 Schema。nashsu 增加了 `purpose.md`：
- 定义目标、关键问题、研究范围、演进的论点
- LLM 每次摄取和查询时读取作为上下文
- 不同于 schema：schema 是结构规则，purpose 是方向意图

#### 2. 两步骤摄取（分析 → 生成）
```
Step 1 (Analysis): LLM 读取源 → 结构化分析
  - 关键实体、概念、论点
  - 与现有 wiki 的连接点
  - 矛盾与张力
  - 结构建议
  temperature=0.1, max_tokens=4096, reasoning=off

Step 2 (Generation): LLM 基于分析 + 原始内容 → 生成 wiki 文件
  - 产出 ---FILE:path 块
  - 不重复分析内容
  temperature=0.1, max_tokens=8192, reasoning=off
```

#### 3. SHA256 增量缓存
源文件内容哈希在摄取前计算；未变文件自动跳过，节省 token。缓存只在"零硬失败"时保存（FS 级错误 = 不缓存）。

#### 4. 持久化摄入队列
- 串行处理（防止并发 LLM 调用）
- 队列持久化到磁盘，应用重启后恢复
- 失败任务自动重试（最多 3 次）
- 700ms 防抖 + 进度可视化

#### 5. 4 信号相关性模型 + Louvain 社区发现
| 信号 | 权重 | 描述 |
|------|:---:|------|
| 直接链接 | ×3.0 | 通过 `[[wikilinks]]` 链接的页面 |
| 源重叠 | ×4.0 | 共享同一原始源的页面（frontmatter `sources[]`） |
| Adamic-Adar | ×1.5 | 共享共同邻居的页面（按邻居度加权） |
| 类型亲和 | ×1.0 | 相同页面类型的加分（实体↔实体，概念↔概念） |

Louvain 算法 + sigma.js + ForceAtlas2 可视化。

#### 6. 混合搜索 + RRF
```
Phase 1: 关键词（CJK bigram + English tokenization）
Phase 1.5: 向量搜索（LanceDB，Cosine 相似度，可选）
Phase 2: 图扩展（从种子节点 2 跳遍历 + 衰减）
Phase 3: 预算控制（context window 60/20/5/15 分配）
Phase 4: 上下文组装（编号页面 + 含引用格式）
```
基准：召回率从 58.2% 提升到 71.4%（启用向量后）。

#### 7. 页面合并保护（三层层）
- **数组联合字段**：`sources`、`tags`、`related` 确定性合并不经 LLM
- **正文合并**：旧 ≠ 新 → 交给 LLM → 结果长度检查（不低于 70%）
- **锁定字段**：`type`、`title`、`created` 即使 LLM 改写也强制还原

#### 8. 级联删除
删除源文件时：
- 删除其 wiki 摘要页
- 3 方法匹配找到相关 wiki 页面
- 共享实体保留（仅移除被删源）
- 清理 index.md 和死 `[[wikilinks]]`

### 文件监视器设计（Rust）
- `RecommendedWatcher` (notify crate) 监听 OS 级别文件事件
- 700ms 防抖批量处理（BTreeSet 收集）
- MD5 哈希比较检测实际变更（≤32MB 文件）
- 任务去重：同一文件多次变化合并为一个队列条目
- 自写保护：`mark_app_write_path()` + 4 秒冷却
- 生成控制：`AtomicU64` 解决旧 watcher 实例的任务竞态
- Linux 定期重扫描（10 秒间隔，弥补 inotify 丢事件）

### 关键 Rust 命令（18 个 Tauri commands）
- **fs**: read/write/list/copy/delete/find_related 等 15 个
- **project**: create/open
- **search**: search_project（关键词 + 向量 RRF）
- **vectorstore**: vector_upsert/search/delete/count + v1/v2 分块版本
- **claude_cli/codex_cli**: detect/spawn/kill
- **extract_images**: PDF/Office 图片提取
- **file_sync**: start/stop/rescan + queue 管理

### 技术栈
| 层 | 技术 |
|----|------|
| 桌面 | Tauri v2 (Rust) |
| 前端 | React 19 + TypeScript + Vite + shadcn/ui + Tailwind v4 |
| 编辑器 | Milkdown (ProseMirror WYSIWYG) |
| 图 | sigma.js + graphology + ForceAtlas2 |
| 向量 | LanceDB (Rust, 嵌入式) |
| 状态 | Zustand |
| i18n | react-i18next |
