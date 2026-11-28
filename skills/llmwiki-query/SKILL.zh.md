---
name: llmwiki-query
description: 通过 HTTP 从 llmwiki 知识库取答案与结构——检索片段、读页面、查反向/正向链接、找未被引用和过期内容。用户问 wiki 里某个主题是什么、要基于页面作答，或问页面之间关系时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-query

答案来自知识库，不来自记忆。`$LLMWIKI_URL` 和鉴权头来自入口 skill `llmwiki`。

## 检索

```bash
curl -fsS -G "${AUTH[@]}" "$LLMWIKI_URL/api/v1/search" \
  --data-urlencode "q=注意力机制" \
  --data-urlencode "scope=wiki" \
  --data-urlencode "limit=10" \
  --data-urlencode "offset=0" \
  --data-urlencode "filter=wiki" \
  --data-urlencode "match=fuzzy" \
  --data-urlencode "types=concept"
```

- `q` 必填，空值返回 `400`。
- `scope`（`wiki|archives|all`，默认 `wiki`）：可只查 Wiki、只查档案（返回 `archive_results` / `archive_total`）或并行联合检索。
- `filter=wiki`（默认）只查 wiki 页面并跳过 `wiki/sources/`；`filter=sources` 只查原始材料；`filter=wiki/<子目录>` 或 `folder=<子目录>` 按目录前缀缩小范围。
- `match`（`fuzzy|all_terms|phrase|regex`，默认 `fuzzy`）与 `case_sensitive=true|false`：`phrase` 与 `regex`（非法正则返回 `400`）会返回 `matched_lines: [{line, text}]`。
- 富筛选与排序：`types`、`kinds`、`statuses`、`confidences`、`tags` + `tag_mode=any|all`、`updated_after`、`updated_before`、`archived`（`exclude|include|only`）、`review_overdue=true`、`sort`（`relevance|updated_desc|updated_asc`）、`group_by`（`document|chunk`，默认按文档去重）。
- 分页与可观测降级：`limit`（1–100）、`offset`、`total`、`has_more`，以及 `effective_mode` 与 `degraded_reason`（hybrid 降级为 keyword 时透出原因）。
- 检索会匹配 `aliases`、`symptoms` 与 `tags`，结果直接附带 `relative_path`、`tags`、`updated_at`、`snippet` 及可选 `matched_lines`。

会影响结论的检索特性：

- FTS5 对拉丁词效果好，中文召回偏弱：中文词和它的英文/别名都要试过，才能说"没有覆盖"。
- title、filename、path 也参与匹配。
- 一种说法查不到不等于不存在：先换词，再看 `GET /api/v1/documents?source_kind=source` 里有没有原始材料。

## 读页面

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/by-path?path=wiki/concepts/attention.md&include_content=false"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/documents/batch-get" \
  -H 'Content-Type: application/json' -d '{"paths":["wiki/concepts/attention.md"],"fields":"outline"}'
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&exclude_hidden=true&paginated=true&limit=50"
```

`GET /api/v1/documents/by-path` 支持按逻辑路径直查（`include_content=false` 只取元信息）；`POST /api/v1/documents/batch-get` 批量读取多个页面（`fields=meta|content|outline`）；`GET /api/v1/documents` 支持 `folder`、`tags`、`tag_mode`、`updated_after`、`updated_before`、`limit`、`offset`、`paginated=true`。

## 结构与关系

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph?limit=300"        # {nodes, edges, total_nodes, truncated}
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/backlinks/{id}"   # 谁链到这里
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/forward/{id}"     # 这页链到哪
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/uncited"          # 没有页面引用的来源
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/graph/stale"            # 需要刷新的页面
```

节点是 `{id, document_id, title, type, link_count}`，边是 `{source, target, type}`，用页面路径而不是文档 id 作键。反链/正链结果同样遵循 `path` 为目录、`filename` 为文件的约定。`truncated: true` 表示图被 `limit` 截断——只有确实需要全图时才调大。

## 回答流程

1. 换 2–3 种说法检索，再判断"库里没有"。
2. 完整读前 2–5 个页面，片段不等于页面。
3. 查 `backlinks`，看有没有矛盾或补充条件的页面。
4. 用用户的语言作答，每个结论都带上页面路径（`wiki/concepts/attention.md`）。
5. 库里确实没有就直说，指出缺什么，并建议用 `llmwiki-ingest` 补来源。除非用户明确要求，不要用通用知识填空；用了必须标注"知识库外"。
6. 来源与页面说法冲突时，两个都摆出来并点名冲突，不要悄悄选一个。

## 只读边界

查询不写任何东西。如果回答需要新建或合并页面，交给 `llmwiki-organize`，当前问题仍用已有内容先答完。
