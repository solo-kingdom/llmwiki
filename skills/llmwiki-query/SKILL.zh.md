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
  --data-urlencode "limit=10" \
  --data-urlencode "filter=wiki" \
  --data-urlencode "types=concept"
```

- `q` 必填，空值返回 `400`。
- `filter=wiki`（默认）只查 wiki 页面，并跳过隐藏目录（`wiki/sources/`、`wiki/templates/`）。
- `filter=sources` 只查原始材料（`raw/…`、摄取原件）。
- 其他值表示全库检索。
- `types` 可重复（`types=concept&types=entity`），按页面类型缩小范围。
- 结果是片段：`{document_id, content, header_breadcrumb, chunk_index, filename, title, path, file_type, score}`。
- `path` 是**目录**（前后都带斜杠，如 `/wiki/concepts/`），引用页面时用 `path + filename` → `wiki/concepts/attention.md`。

会影响结论的检索特性：

- FTS5 对拉丁词效果好，中文召回偏弱：中文词和它的英文/别名都要试过，才能说"没有覆盖"。
- title、filename、path 也参与匹配。
- 一种说法查不到不等于不存在：先换词，再看 `GET /api/v1/documents?source_kind=source` 里有没有原始材料。

## 读页面

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents/{id}/content"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&exclude_hidden=true"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/documents?source_kind=wiki&types=entity&types=concept"
```

`GET /api/v1/documents` 返回整行（含 `content`）；只要正文时用 `/documents/{id}/content`。枚举时加 `exclude_hidden=true`，除非你确实要 `wiki/sources/` 下的溯源页。

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
