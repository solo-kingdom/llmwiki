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
| `misplaced_wiki_page` | warning | 业务页放在 `wiki/*.md` | 移到主题域/主题组；顶层只允许 `overview.md` |
| `legacy_type_root` | warning/error | 活跃页仍在 concepts/entities 等旧类型根；enforce 下为 error | 按主题迁移并保留 document_id 与入链 |
| `global_duplicate_page` | error | 跨目录标题、文件名或 alias 规范化后冲突 | 选定 canonical 页，保留独特信息并合并入链 |
| `folder_metadata_missing` | warning | 主题目录缺显示名或边界说明 | 补 display_name 与收/不收/相邻边界 description |
| `folder_fanout` / `topic_depth_exceeded` | warning/error | 目录过挤、过稀或层级过深 | 人工复核稳定分类轴，不按阈值自动拆并 |
| `filename_noncanonical` | warning | 文件名空白/下划线或 title/H1 不一致 | 统一可读规范名，旧名进入 aliases |
| `experience_shape_mismatch` | warning | concept 正文实际是完整排障经验 | 复核为 experience 并补齐经验元数据 |
| `orphan_page` | warning | 没有其他活跃 wiki 页面链过来 | 从相关页面或目录 `_overview.md` 加一条链接 |
| `duplicate_page` | warning | 同目录下归一化文件名重复 | 合并成一页，改写入链，删掉多余页 |
| `entity_concept_coupling` | warning | 概念页标题绑定到某个实体 | 把概念页标题改中性，用 `[[entities/…]]` 链案例 |
| `confidence_invalid` / `confidence_missing` | error / warning | `confidence` 非法或活跃页缺失 | 补 `high`/`medium`/`low` |
| `verification_missing` | error | `high` 缺 `last_verified` 或 `validated` 经验缺核实/复审日期 | 补齐 `last_verified` / `review_after` |
| `date_invalid` | error | 日期非合法 `YYYY-MM-DD` | 修正日期格式 |
| `archive_metadata_invalid` | error | 归档字段不成对（缺 `archive_reason` 或无 `archived_at`） | 补齐或改走 `/archive` / `/reopen` |
| `kind_invalid` / `experience_status_invalid` | error | `kind` 或 `experience.status` 取值非法 | 修正为合法枚举 |
| `ambiguous_link` | error | 短链接命中多页 | 改用路径限定链接 `[[folder/slug]]` |
| `symptoms_missing` / `pattern_instances_insufficient` | warning | `pitfall`/`pattern` 缺现象词，或 `pattern` 活跃实例 `< 2` | 补 `symptoms` 或补充实例链接 |
| `review_overdue` / `archived_reference` | warning | 已过复审日 / 活跃页引用了归档页 | 复审更新或改指替代页 |

刚初始化的 PostgreSQL 知识库 lint 应当是空的；不是空就说明内容本身有问题。

主题目录不决定 page_type；只有 legacy 目录与 `sources/` 保留兼容推断。`date` 会校验 YYYY-MM-DD，title/H1 与经验形态也会单独提示。

`stats.page_count` / `source_count` 是批量导入后最快的体检指标：数量突然下降说明 reindex 清掉了确实消失的文件。

## 体检流程

1. `GET /lint`。`issues` 为空就报 stats 收工——不要顺手"改进"没人要求的页面。
2. 按 `code` 分组，先挑数量最多、修法最机械的一类（frontmatter 和日期优先，便宜且无歧义）。
3. 把 `path` 映射到文档：`GET /documents?source_kind=wiki&exclude_hidden=true` 里按 `relative_path` 匹配，或用 `GET /api/v1/search?q=<文件名>`；再 `GET /documents/{id}/content`。
4. 用 `PUT /documents/{id}/content`（整体正文）修复——只有它能同时改文件和索引。结构性搬移按 `llmwiki-organize` 做。
5. 每批之后：`POST /api/v1/reindex`，再 `GET /lint`，对比问题列表。数量变多说明你的改动引入了新问题（通常是漏改的链接）。
6. 剩下只有用户能定的问题（例如两页都看似正确、需要业务判断）就停下，带路径报告，不要替用户猜。

## 汇报

给出：修复前后按严重度的数量、改动过的文件、有意留下的问题、复现命令。`code` 和路径照抄，方便用户复核。执行过回滚时附上 change set id。

## 禁止

- 为了消灭一条问题去绕过文档 API 修改派生状态。
- 在有入链的情况下先删页面、后改链接。
- 批量删"孤立页"——孤立页往往只差一条链接，为了让数字好看而删用户知识不是修复。
- 不做修复后的 `GET /lint` 就声称库已干净。
