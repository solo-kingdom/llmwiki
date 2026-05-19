# 疑问与风险

## 待解决的设计问题

### Q1: Go SQLite 驱动选择
| 驱动 | 优点 | 缺点 |
|------|------|------|
| `modernc.org/sqlite` | 纯 Go，无 CGO，交叉编译简单 | FTS5 支持需确认；性能可能略低 |
| `mattn/go-sqlite3` | 生态成熟，FTS5 已确认可用 | 需要 CGO，交叉编译需 C 工具链 |
| `ncruces/go-sqlite3` | Wasm 编译的 SQLite，纯 Go | 较新，社区小 |

**倾向**: 优先 `modernc.org/sqlite`，若 FTS5 有问题则切换到 `mattn/go-sqlite3`（接受 CGO 代价）。

### Q2: 前端 UI 框架
| 框架 | 包大小 | 构建速度 | 组件丰富度 | 适配 embed |
|------|:---:|:---:|:---:|:---:|
| shadcn/ui (Radix + Tailwind) | 小（选择性导入） | 快 | 中 | ✅ |
| Ant Design | 大 | 慢 | 丰富 | ⚠️ |
| MUI | 中 | 中 | 丰富 | ⚠️ |
| 纯 Tailwind + Headless UI | 小 | 快 | 需自己实现 | ✅ |

**倾向**: shadcn/ui — nashsu 已使用，Tree-shakeable，Tailwind 友好。

### Q3: MCP 远程模式 (SSE) 是否在首个版本支持？
- **本地 stdio**: 必须（Claude Desktop / Code 的基础交互）
- **远程 SSE**: 可选（远程 Claude 通过 HTTP 连接）

**倾向**: 首个版本仅支持 stdio，远程 SSE 作为后续迭代。

### Q4: 源文件处理（PDF/Office）是否内建到 Go 二进制？
| 方案 | 优点 | 缺点 |
|------|------|------|
| A: 内建到 Go | 单二进制，无需外部依赖 | PDF 解析库少（Go 生态弱），Office 更难 |
| B: 外部工具依赖 | 借用成熟工具（opendataloader, LibreOffice） | 部署需额外安装 |
| C: 标记待处理 | 仅索引元数据，由 LLM 通过 MCP 工具自行读取 | 搜索效果差 |

**倾向**: 首个版本采用 B（外部工具依赖），但把 PDF 提取作为可选功能。Markdown 和纯文本直接内建处理。后期评估 Go 生态的 pdfcpu 或 leaderone 等库。

### Q5: 摄入队列架构
两步骤摄取（两个 LLM 调用 + 文件写入）是一个长事务。需要：
- 状态持久化（避免服务重启丢任务）
- 并发控制（同一工作区串行，不同工作区并行）
- 失败重试（最多 3 次）

**倾向**: 首个版本使用简单的内存队列 + SQLite 状态持久化。后期可引入 proper job queue（如 River）。

### Q6: 用户批注/高亮存储方案
| 方案 | 存储 | 删库恢复 | Obsidian 兼容 |
|------|------|:---:|:---:|
| A: 嵌入 markdown 脚注 | wiki/page.md 内 | ✅ | ✅ |
| B: 独立 JSON 文件 | .llmwiki/highlights/ | ✅ | ✅ |
| C: DB-only | SQLite JSON 列 | ❌ | ✅ |

**倾向**: 方案 A 或 B，取决于高亮是面向源文件还是 Wiki 页面。

---

## 已知风险

### 风险 1: Go 生态 PDF 提取不成熟
Go 的 PDF 解析库（ledongthuc/pdf, pdfcpu）主要面向 PDF 生成/修改，文本提取能力有限。可能需要：
- 调用外部工具（opendataloader, pdftotext）
- 或接受首个版本只支持 Markdown 和纯文本源

### 风险 2: FTS5 中文分词
SQLite FTS5 默认 `porter unicode61` tokenizer 对中文效果差（不分词）。CJK 文本需要用 `unicode61` 的 trigram 或接入外部中文分词器（jieba）。nashsu 的 TypeScript 方案是自己实现 CJK bigram 分词。

### 风险 3: 引用图一致性
引用图（document_references）是全量替换策略（先删后写），在大型 Wiki 中存在短暂不一致窗口。Go 中需要通过事务包装。

### 风险 4: 文件监视器跨平台差异
- Linux: inotify，需定期重扫描（10s 间隔）弥补丢事件
- macOS: FSEvents，较可靠
- Windows: ReadDirectoryChangesW，需处理驱动器字母和路径分隔符

### 风险 5: 前端路由 SPA fallback
Go 的 `embed.FS` + HTTP file server 对 SPA 的 client-side routing 支持不直观。需要自定义 handler 把所有非 `/api/` 路径请求都返回 `index.html`。

### 风险 6: LLM 调用的 token 成本
两步骤摄取每次可能需要 15K+ tokens（分析 4K + 生成 8K + 系统提示 + 用户消息）。对于大型源文件或频繁摄取，成本不低。SHA256 增量缓存是缓解措施。

### 风险 7: MCP JSON-RPC 的 edge cases
- 客户端可能在工具调用完成前发送新请求（并发）
- 需要处理 stdout 写入失败（管道关闭）
- 大文本响应（如 read 返回大段 PDF 文本）可能超出某些客户端限制

---

## 后续迭代考虑

1. **向量搜索**：引入 LanceDB 或纯 Go 向量索引，实现混合搜索 (RRF)
2. **知识图谱可视化**：Sigma.js + Louvain 社区发现
3. **Deep Research**：LLM 优化搜索主题 → Web 搜索 → 自动摄入 Wiki
4. **Web Clipper 扩展**：Chrome Extension 一键捕获网页
5. **多工作区支持**：一个 MCP server 管理多个工作区
6. **Git 集成**：Wiki 即 Git repo，自动版本控制
7. **Obsidian 兼容模式**：自动生成 `.obsidian/` 配置
8. **同步功能**：多个设备间同步 Wiki（通过 git 或自定义协议）
