---
name: llmwiki-lint
description: 通过 HTTP 体检并修复 llmwiki 知识库——按严重度读 lint 结果、把每条问题定位到页面、经文档接口修好，再 reindex 证明库已干净。用户要求体检、清理死链与孤立页，或 lint 报错时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-lint

Lint 只读：它报问题。修复走 `llmwiki-organize` 里的接口。`$LLMWIKI_URL` 和鉴权头来自入口 skill `llmwiki`。

## 跑一次

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"
```

```json
{
  "issues": [
    {"severity": "error", "code": "dead_link", "path": "wiki/concepts/attention.md", "message": "死链：目标不存在 \"entities/transformer\""}
  ],
  "stats": {"page_count": 42, "source_count": 7, "last_updated": "…"},
  "checked_at": "…"
}
```

严重度：`error`（破坏导航、索引或页面契约）、`warning`（结构性偏差，人可以接受）、`info`（提示）。先用 `jq` 之类按 `code` 分组——同一种 code 出现二十次通常是一个原因。

## code 与修法

| Code | 严重度 | 含义 | 修法 |
|---|---|---|---|
| `missing_frontmatter` | error | 类型页面缺 `title`/`date`/`type` | 用 `PUT /documents/{id}/content` 补全 frontmatter |
| `type_dir_mismatch` | error | `type` 与目录不符 | 判断哪边对：通常移动页面（新建+删除），否则改 `type` |
| `dead_link` | error | `[[target]]` 指向不存在的页面 | 补建目标页，或把链接改到真实存在的页面 |
| `ghost_index_entry` | error | 数据库有记录但文件已不存在 | `POST /api/v1/reindex` 会清掉；仍存在就 `DELETE /documents/{id}` |
| `misplaced_wiki_page` | warning | 业务页放在 `wiki/*.md` | 移到对应类型子目录；顶层只允许 `overview.md`、`index.md`、`log.md` |
| `orphan_page` | warning | 没有其他 wiki 页面链过来 | 从相关页面加一条链接；`index.md` 是生成的，改它无效 |
| `duplicate_page` | warning | 同目录下归一化文件名重复 | 合并成一页，改写入链，删掉多余页 |
| `entity_concept_coupling` | warning | 概念页标题绑定到某个实体 | 把概念页标题改中性，用 `[[entities/…]]` 链案例 |
| `log_format_invalid` | error | `wiki/log.md` 条目不符合 `## [YYYY-MM-DD] action \| description` | 改这一条；不要重排日志 |
| `log_date_decreasing` | warning | 日志条目时间倒序 | 重排条目，一条都不能丢 |

`wiki/templates/` 是脚手架，所有检查都会跳过它——刚初始化的库 lint 应当是空的；不是空就说明库本身有问题。

frontmatter 只校验「存在」和「与目录一致」：`date` 写错格式能过 lint，但显示会错，改页面时顺手核对。

`stats.page_count` / `source_count` 是批量导入后最快的体检指标：数量突然下降说明 reindex 清掉了确实消失的文件。

## 体检流程

1. `GET /lint`。`issues` 为空就报 stats 收工——不要顺手"改进"没人要求的页面。
2. 按 `code` 分组，先挑数量最多、修法最机械的一类（frontmatter 和日期优先，便宜且无歧义）。
3. 把 `path` 映射到文档：`GET /documents?source_kind=wiki&exclude_hidden=true` 里按 `relative_path` 匹配，或用 `GET /api/v1/search?q=<文件名>`；再 `GET /documents/{id}/content`。
4. 用 `PUT /documents/{id}/content`（整体正文）修复——只有它能同时改文件和索引。结构性搬移按 `llmwiki-organize` 做。
5. 每批之后：`POST /api/v1/reindex`，再 `GET /lint`，对比问题列表。数量变多说明你的改动引入了新问题（通常是漏改的链接）。
6. 剩下只有用户能定的问题（例如两页都看似正确、需要业务判断）就停下，带路径报告，不要替用户猜。

## 汇报

给出：修复前后按严重度的数量、改动过的文件、有意留下的问题、复现命令。`code` 和路径照抄，方便用户复核。跑过 `POST /api/v1/vcs/backup` 时附上 commit sha。

## 禁止

- 为了消灭一条问题去改 `wiki/index.md`、`.llmwiki/` 或 `raw/`。
- 在有入链的情况下先删页面、后改链接。
- 批量删"孤立页"——孤立页往往只差一条链接，为了让数字好看而删用户知识不是修复。
- 不做修复后的 `GET /lint` 就声称库已干净。
