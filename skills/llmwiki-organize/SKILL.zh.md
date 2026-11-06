---
name: llmwiki-organize
description: 通过 HTTP 新建、改写、合并、移动、删除 llmwiki 页面——保证 frontmatter 与目录契约、维护 wiki/log.md、让知识库始终可 lint。用户要求新增或重写 wiki 页面、清理重复、调整结构、修正页面元数据时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-organize

写操作走 API，文件、索引、图谱才会一致。`$LLMWIKI_URL` 和鉴权头来自入口 skill `llmwiki`。

## 页面契约

| 目录 | `type` | 必需章节 |
|---|---|---|
| `wiki/entities/` | `entity` | 概述 / 关键事实 / 相关概念 / 来源 |
| `wiki/concepts/` | `concept` | 定义 / 核心要点 / 相关实体 / 来源 |
| `wiki/synthesis/` | `synthesis` | 问题或目的 / 分析 / 引用 / 后续 |
| `wiki/comparisons/` | `comparison` | 对比维度 / 异同 / 结论 |
| `wiki/queries/` | `query` | 问题 / 回答 / 引用 |
| `wiki/sources/` | `source` | 摘要 / 关键观点 / 相关实体或概念 |

每个 wiki 页面都要 frontmatter，缺 `title`、`date`、`type` 都是 lint 错误：

```yaml
---
title: 注意力机制
type: concept
date: 2025-01-31
description: 一句话摘要，会进入 wiki/index.md
tags: [transformer, nlp]
---
```

Lint 会强制检查的规则：

- `type` 必须与目录一致（type 单数、目录复数）。
- 业务页只能放在类型子目录里。`wiki/foo.md` 会报 `misplaced_wiki_page`；顶层只允许 `wiki/overview.md`、`wiki/index.md`、`wiki/log.md`。
- 链接用 Obsidian 语法：`[[entities/transformer|Transformer]]`、`[[concepts/attention]]`，slug 唯一时可写 `[[attention]]`；markdown 链接 `[文本](/wiki/concepts/attention.md)` 也认。指向不存在页面的链接是 `dead_link`。
- 一页一个主题。页面里长出第二个主题时拆开并互相链接。

## 新建页面

```bash
# 1. 已经存在吗
curl -fsS -G "${AUTH[@]}" "$LLMWIKI_URL/api/v1/search" --data-urlencode "q=<主题>" --data-urlencode "limit=5"

# 2. 写入（路径决定类型：wiki/** 是 wiki 页，其他都是 source）
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents" \
  -H 'Content-Type: application/json' \
  -d '{
    "filename": "attention-mechanism.md",
    "path": "/wiki/concepts",
    "title": "注意力机制",
    "tags": ["transformer"],
    "content": "---\ntitle: 注意力机制\ntype: concept\ndate: 2025-01-31\n---\n\n# 定义\n…\n"
  }'
```

返回创建后的整行：确认 `source_kind == "wiki"`、`relative_path == "wiki/concepts/attention-mechanism.md"`。`content` 里必须自带 frontmatter——API 原样落盘，不会替你补元数据。

## 改写页面

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"    # {"content": "…"}
# 本地改好 markdown，再整体回写
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/documents/{id}/content" \
  -H 'Content-Type: application/json' \
  -d '{"content": "<完整 markdown，含 frontmatter>"}'
```

`PUT /content` 是全量替换：只发片段会删掉其余内容。保留你没打算改的章节；实质内容变化时更新 `date`。

不要用 `PATCH /api/v1/documents/{id}`（`title`、`tags`、`date`、`metadata`）：它只改索引行，文件 frontmatter 与索引会一直漂移，直到下次 reindex。改元数据统一走 `PUT /content`。

## 合并重复页

1. 对准备删除的页面调 `GET /graph/backlinks/{id}`，先把入链改到目标页。
2. 把合并后的内容写进保留页（`PUT /content`）。
3. 逐个改写入链页面里的链接（`PUT /content`）。
4. 删除多余页（见下）。
5. `POST /api/v1/reindex`，再确认 `GET /api/v1/lint` 不再报 `dead_link` 或 `duplicate_page`。

## 移动/改名

没有 move 接口：在目标位置新建页面、改好链接、删掉旧页。之后必须 reindex；漏改链接就会留下 `dead_link`。

## 删除页面

```bash
curl -fsS "${AUTH[@]}" -X DELETE "$LLMWIKI_URL/api/v1/documents/{id}"
# {"status":"deleted","path":"wiki/concepts/old.md"}
```

删除会同时删文件和索引行，reindex 不会把它复活。删前查 `backlinks`，删后 reindex 并看 lint。`POST /documents/bulk-delete {"ids":[…]}` 可批量。

## 日志（`wiki/log.md`）

只追加，且与文件中已有顺序保持一致（新条目放最前还是最后，照抄现状）：

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{log_id}/content"
# 读取后追加：## [2025-01-31] create | concepts/attention-mechanism | 新增注意力机制概念页
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/documents/{log_id}/content" \
  -H 'Content-Type: application/json' -d '{"content": "<原内容 + 新条目>"}'
```

格式固定：`## [YYYY-MM-DD] <action> | <description>`。在用 action：`create`、`update`、`merge`、`move`、`delete`、`ingest`。不要重排或改写历史条目。

## 收口

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"     # 重建 wiki/index.md 与图谱
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"                # 不能留下你造成的 error
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/backup"  # 用户要快照时才做
```

汇报改动路径、lint 摘要、提交了就给出 commit sha。

## 禁止

- 编辑 `wiki/index.md`（生成物）、`.llmwiki/`（派生物）、`raw/` 下任何文件。
- 在 `wiki/` 顶层、单数目录（`entity/`、`concept/`）或 `wiki/raw/` 里建页面。
- 写出前后矛盾的页面（正文与 `type`、`date` 对不上）。
- 一批改动不做 lint、不 reindex 就结束。
