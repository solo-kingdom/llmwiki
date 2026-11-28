---
name: llmwiki-organize
description: 通过 HTTP 新建、改写、合并、移动、删除 llmwiki 页面——保证 frontmatter 与目录契约、让知识库始终可 lint。用户要求新增或重写 wiki 页面、清理重复、调整结构、修正页面元数据时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-organize

写操作走 API，文件、索引、图谱才会一致。`$LLMWIKI_URL` 和鉴权头来自入口 skill `llmwiki`。

## 页面契约

目录统一为 `wiki/<主题域>/<主题组>/<页面>.md`，默认两层目录；page_type 与目录解耦，同一主题组可混放 entity/concept/experience。`concepts/`、`entities/`、`devices/` 等是 legacy 路径，只用于尚未迁移的旧页更新。

| `type` | 独立成页门槛 | 必需章节 |
|---|---|---|
| `entity` | 可唯一指代且有可复用事实 | 概述 / 关键事实 / 相关概念 / 来源 |
| `concept` | 中性、可跨案例复用 | 定义 / 核心要点 / 适用边界 / 来源 |
| `synthesis` | 关系分析本身有独立价值 | 问题与结论 / 分析 / 证据 / 未决项 |
| `comparison` | 至少两个对象且有明确维度 | 对比维度 / 异同 / 结论 |
| `query` | 问题与答案值得复用 | 问题 / 回答 / 引用 |
| `experience` | 一组完整可复用经验，不按短语拆页 | 现象 / 经验结论 / 最短判别 / 根因 / 处理 / 验证 / 边界 / 证据 |
| `ledger` | 需要当前状态与追加历史 | 当前状态 / 历史（仅追加）/ 来源 |
| `source` | 保留来源摘要，固定放 `wiki/sources/` | 摘要 / 关键观点 / 相关实体或概念 |

正文按金字塔组织：先结论与适用范围，再要点，最后证据细节。普通关系只写 wikilink/结构化引用，不建 relation 页面。文件名保留可读规范名，空白改为 `-`，不用 `_` 分词；旧名和缩写加入 `aliases`。

每个 wiki 页面都要 frontmatter，缺 `title`、`date`、`type` 都是 lint 错误：

```yaml
---
title: 注意力机制
type: concept
date: 2025-01-31
description: 一句话摘要
tags: [transformer, nlp]
---
```

Lint 会强制检查的规则：

- `type` 必须是合法枚举值（`entity` / `concept` / `source` / `synthesis` / `comparison` / `query` / `experience` / `ledger` / `page`）；仅 `wiki/sources/` 强制 `type: source`，其余业务页可放在任意主题多级目录。
- `experience` 必填 `status`（`draft`/`validated`/`deprecated`），可选 `kind`（`practice`/`pitfall`/`pattern`）与 `symptoms`；`ledger` 必填 `status`；`confidence: high` 需 `last_verified`，`validated` 经验需 `last_verified` 与 `review_after`。
- 业务页只能放在主题子目录里（如 `wiki/AI工程/Agent/harness.md`）。`wiki/foo.md` 会报 `misplaced_wiki_page`；顶层只允许 `wiki/overview.md`。
- 链接用 Obsidian 语法：`[[AI工程/Agent/harness|Harness]]`、`[[entities/transformer|Transformer]]`，slug 唯一时可写 `[[attention]]`；markdown 链接 `[文本](/wiki/concepts/attention.md)` 也认。指向不存在页面的链接是 `dead_link`。
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
    "path": "/wiki/AI与Agent/Skills与工具",
    "title": "注意力机制",
    "tags": ["transformer"],
    "content": "---\ntitle: 注意力机制\ntype: concept\ndate: 2025-01-31\n---\n\n# 定义\n…\n"
  }'
```

返回创建后的整行：确认 `source_kind == "wiki"`、`relative_path == "wiki/AI与Agent/Skills与工具/attention-mechanism.md"`。`content` 里必须自带 frontmatter——API 原样落盘，不会替你补元数据。

## 改写页面

局部改动优先使用 `PATCH /api/v1/documents/{id}/content`，并带上乐观锁（`expected_version`、`expected_content_hash` 或 `If-Match` 请求头，不匹配返回 `409 Conflict`）：

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/by-path?path=wiki/topic/page.md&include_content=false"
curl -fsS "${AUTH[@]}" -X PATCH "$LLMWIKI_URL/api/v1/documents/{id}/content" \
  -H 'Content-Type: application/json' \
  -d '{
    "expected_version": 3,
    "dry_run": false,
    "edits": [
      {"op": "replace", "old_text": "旧文本", "new_text": "新文本"},
      {"op": "insert_after", "anchor": "## 摘要", "text": "\n补充条目"}
    ]
  }'
```

`edits[]` 支持 `replace`（可选 `replace_all`）、`replace_lines`（1-based `start_line` / `end_line`）、`append`、`prepend`、`insert_after`。整篇重写走 `PUT /api/v1/documents/{id}/content`。`PATCH /api/v1/documents/{id}` 支持更新 `title` / `tags` / `date` / `metadata` 及乐观锁校验。

## 批量操作与 `dry_run` 预演

使用 `POST /api/v1/documents/batch`（单批上限 100）在单个 `change_set` 内原子执行混合操作（`create`、`replace`、`patch`、`update_meta`、`move`、`archive`、`reopen`、`delete`），合并链接重写并支持 `dry_run: true` 预检：

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/batch" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true, "summary": "目录整理", "ops": [{"op": "move", "path": "wiki/a/p.md", "target_folder": "b"}]}'
```

批量读取走 `POST /api/v1/documents/batch-get`（`{"ids": [...], "paths": [...], "fields": "meta|content|outline"}`）。`POST /api/v1/organize/auto-cluster` 返回的 `batch_ops` 可直接传给 `POST /api/v1/documents/batch`。

## 合并重复页

1. 对准备删除的页面调 `GET /graph/backlinks/{id}`，先把入链改到目标页。
2. 把合并后的内容写进保留页（`PUT /content`）。
3. 逐个改写入链页面里的链接（`PUT /content`）。
4. 删除多余页（见下）。
5. `POST /api/v1/reindex`，再确认 `GET /api/v1/lint` 不再报 `dead_link` 或 `duplicate_page`。

## 移动/改名

使用 `POST /api/v1/documents/{id}/move`（`{"target_folder": "AI工程/Agent", "filename": "new-name.md"}`）或 `POST /api/v1/folders/move`（`{"from_path": "旧目录", "to_path": "新目录", "on_conflict": "fail|merge"}`）。`on_conflict: "merge"` 支持原子合并目录与子目录，同名文件冲突整事务回滚并返回 `409` 及 `conflicts[]`。移动会保留 `document_id` 与历史链，并自动重写显式路径链接。可通过 `GET /api/v1/tree` 与 `POST/PATCH/DELETE /api/v1/folders`（`exist_ok: true` 幂等建目录）管理目录树。

## 归档与重开（原地标记，区别于删除）

```bash
# 原地归档（保留路径、内容与历史链接，默认从列表/搜索/图谱隐藏）
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/{id}/archive" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"已被新方案替代","superseded_by":"[[new-page]]"}'

# 重开已归档页面
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/{id}/reopen" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"重新启用","confidence":"medium","last_verified":"2026-11-25"}'
```

## 删除页面

```bash
curl -fsS "${AUTH[@]}" -X DELETE "$LLMWIKI_URL/api/v1/documents/{id}"
# {"status":"deleted","path":"wiki/concepts/old.md"}
```

删除会直接移除数据库文档并记录 `change_sets`。删前查 `backlinks`，删后 reindex 并看 lint。`POST /documents/bulk-delete {"ids":[…]}` 可批量。

## 收口

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"     # 重建 chunks、图谱与目录总览
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"                # 不能留下你造成的 error
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/history?limit=1"  # 取本次写入的 change set id
```

汇报改动路径、lint 摘要、执行过回滚就给出 change set id。

## 禁止

- 绕过文档 API 直接修改派生状态。
- 在 `wiki/` 顶层、单数目录（`entity/`、`concept/`）或 `wiki/raw/` 里建页面。
- 写出前后矛盾的页面（正文与 `type`、`date` 对不上）。
- 一批改动不做 lint、不 reindex 就结束。
