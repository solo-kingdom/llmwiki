# 数据模型设计

## 数据库 Schema（从 lcasastorian/llmwiki 翻译）

### documents 表 — 核心文档

```sql
CREATE TABLE documents (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT NOT NULL,
    filename        TEXT NOT NULL,
    title           TEXT,
    path            TEXT DEFAULT '/' NOT NULL,
    relative_path   TEXT UNIQUE NOT NULL,
    source_kind     TEXT NOT NULL CHECK (source_kind IN ('wiki', 'source', 'asset')),
    file_type       TEXT NOT NULL,
    file_size       INTEGER DEFAULT 0,
    document_number INTEGER,
    
    -- 状态机
    status          TEXT DEFAULT 'pending' 
                    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    
    page_count      INTEGER,
    content         TEXT,             -- 全文/提取文本
    tags            TEXT DEFAULT '[]', -- JSON array
    date            TEXT,             -- ISO 字符串，来自 frontmatter
    metadata        TEXT,             -- JSON: {description, ...}
    error_message   TEXT,
    
    -- 版本和完整性
    version         INTEGER DEFAULT 0,
    parser          TEXT,             -- 'opendataloader' | 'mistral' | 'native'
    content_hash    TEXT,             -- SHA256
    mtime_ns        INTEGER,
    last_indexed_at TEXT,
    stale_since     TEXT,             -- 陈旧标记
    highlights      TEXT DEFAULT '[]', -- JSON: 用户批注
    
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX idx_documents_relative_path ON documents(relative_path);
CREATE INDEX idx_documents_path ON documents(path);
CREATE INDEX idx_documents_source_kind ON documents(source_kind);
CREATE INDEX idx_documents_status ON documents(status);
```

### document_pages — 多页提取内容

```sql
CREATE TABLE document_pages (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page        INTEGER NOT NULL,
    content     TEXT NOT NULL,
    elements    TEXT,  -- JSON: 提取的结构化元素（表格等）
    UNIQUE(document_id, page)
);
```

### document_chunks — 搜索分块

```sql
CREATE TABLE document_chunks (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    document_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index      INTEGER NOT NULL,
    content          TEXT NOT NULL,
    page             INTEGER,
    start_char       INTEGER,
    token_count      INTEGER NOT NULL,
    header_breadcrumb TEXT,  -- 标题面包屑: "## A > ### B"
    UNIQUE(document_id, chunk_index)
);
CREATE INDEX idx_chunks_doc ON document_chunks(document_id);
```

### document_references — 引用图

```sql
CREATE TABLE document_references (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source_document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    target_document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reference_type      TEXT NOT NULL CHECK (reference_type IN ('cites', 'links_to')),
    page                INTEGER,  -- 引用页码
    UNIQUE(source_document_id, target_document_id, reference_type)
);
CREATE INDEX idx_refs_source ON document_references(source_document_id);
CREATE INDEX idx_refs_target ON document_references(target_document_id);
```

### chunks_fts — FTS5 全文搜索

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    content,
    content='document_chunks',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- 触发器自动同步
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON document_chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER chunks_fts_delete AFTER DELETE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER chunks_fts_update AFTER UPDATE ON document_chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

---

## 分块策略

| 参数 | 值 | 说明 |
|------|-----|------|
| CHUNK_SIZE | 512 token | 每块目标大小 |
| CHUNK_OVERLAP | 128 token | 块间重叠 |
| MIN_CHUNK_TOKENS | 32 | 低于此值丢弃 |
| MAX_CHUNK_CHARS | 10,000 | 匹配数据库约束 |

Token 估算：`max(1, len(text) // 4)` — 约每 4 字符 = 1 token。

**按段落分割 + 标题面包屑追踪**：每个 chunk 携带其所属的标题路径，在搜索结果中显示为面包屑。

**超长块处理**：单块超过 10,000 字符时（CJK 段落或长代码块），先按句子边界拆分，失败则按固定大小硬切。

---

## 引用图引擎

### 引用类型

| 类型 | 来源语法 | 含义 |
|------|----------|------|
| `cites` | `[^1]: file.pdf, p.3` | Wiki 页面引用源文件 |
| `links_to` | `[text](other-page.md)` | Wiki 页面间交叉引用 |

### 解析流程

```
内容正则解析
    ├─ _CITATION_RE = r"\[\^\d+\]:\s*(.+)$"
    │   → 文件名 + 页码提取
    │   → 三层匹配: 精确文件名 → base → wiki 路径
    │   → 边类型: cites
    │
    └─ _WIKI_LINK_RE = r"(?<!!)\[(?:[^\]]*)\]\(([^)]+)\)"
        → 排除 http, #, mailto:, 图片
        → 路径解析: /wiki/ → ./ → ../ → bare
        → + .md 回退 + basename 回退
        → 边类型: links_to

去重: UNIQUE(source, target, type)
写入: INSERT OR REPLACE
```

### 陈旧性传播

当页面 B 被更新时：
```sql
UPDATE documents SET stale_since = datetime('now')
WHERE id IN (
    SELECT source_document_id FROM document_references
    WHERE target_document_id = ? AND reference_type = 'links_to'
) AND stale_since IS NULL
```
仅 `links_to` 类型触发，`cites` 不触发（源文件修改不自动标记 Wiki 页为 stale）。

---

## Frontmatter 规范

每个 Wiki 页面头部必须有 YAML frontmatter：

```yaml
---
title: KV Cache Efficiency
description: Memory optimization strategies for transformer inference
date: 2025-03-15
tags: [inference, memory, optimization, transformers]
---
```

四个字段全部必需。`description` 出现在搜索结果和图谱提示中。

### 提取与回填

写操作时自动解析 frontmatter → 更新 DB 的 `date` 和 `metadata` 列。

reindex 时必须从文件重新解析 frontmatter → 回填 tags, date, description。**这是 lcasastorian 实现的已知 gap，我们的实现必须修复**。

---

## 文件系统 → 数据库同步

### 初始化 (llmwiki init)
```go
1. 创建 wiki/ 目录
2. 创建 .llmwiki/index.db
3. 执行 schema → 建表
4. 写入 workspace 行
5. 脚手架: overview.md + log.md (写文件 + 写 DB)
6. 扫描现有文件 → 索引到 DB
```

### 重索引 (llmwiki reindex)
```go
1. DELETE FROM document_chunks
2. DELETE FROM document_pages
3. DELETE FROM documents
4. 保留 workspace 行
5. 重新扫描所有文件:
   - 文本文件: 读内容 → INSERT documents + frontmatter 解析回填
   - 非文本: 仅 INSERT documents 元数据
6. 对 wiki/*.md 重新解析引用图
7. 对所有文本文件重新分块 → 触发器自动填充 FTS5
```

### 文件监视器
```go
1. fsnotify 监听 workspace 目录
2. 忽略: .llmwiki/, .git/, node_modules/, 以.开头的目录
3. 700ms 防抖批处理
4. 变更检测: SHA256 hash 对比
5. 自写保护: markWritten() + 4 秒冷却
```

---

## 删除策略

### MCP delete 工具
- 保护 overview.md 和 log.md（不可删除）
- 支持 glob 批量删除
- 双路径清理：文件系统删除 + 数据库 CASCADE 删除

### 级联删除
删除源文件时：
1. 删除 wiki 中的源摘要页
2. 对关联的 wiki 页面：若被删源是唯一源 → 删除页；否则 → 从 sources[] 移除被删源
3. 清理 index.md
4. 清理死 `[[wikilinks]]`

---

## 工作区结构总结

```
~/research/
├── purpose.md                 # 目标/问题/范围（YAML frontmatter）
├── schema.md                  # 结构约定（可选）
├── raw/
│   ├── sources/               # 源文件（不可变）
│   │   └── *.pdf / *.md / *.docx / ...
│   └── assets/                # 本地图片
├── wiki/
│   ├── overview.md            # 全局总览（自动维护）  → DB: source_kind='wiki'
│   ├── log.md                 # 操作日志（只追加）    → DB: source_kind='wiki'
│   ├── index.md               # 内容目录（按类别）    → DB: source_kind='wiki'
│   ├── entities/              # 实体页面              → DB: source_kind='wiki'
│   ├── concepts/              # 概念页面              → DB: source_kind='wiki'
│   ├── sources/               # 源文件摘要            → DB: source_kind='wiki'
│   ├── queries/               # 查询归档              → DB: source_kind='wiki'
│   ├── synthesis/             # 综合分析              → DB: source_kind='wiki'
│   └── comparisons/           # 对比分析              → DB: source_kind='wiki'
└── .llmwiki/
    ├── index.db               # SQLite: documents, pages, chunks, references, fts
    └── cache/                 # 衍生缓存: PDF 提取结果, LibreOffice 转换
```
