---
name: llmwiki
description: 通过 HTTP API 操作 llmwiki 服务——读写 wiki 页面、跑摄取流水线、检查并修复知识库、用 git 做快照。用户提到 llmwiki、wiki 服务，或要求新增、查询、摄取、整理、检查、备份 wiki 知识时使用。本文件是入口，负责把任务路由到各阶段 skill。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki

LLM Wiki 是一个 markdown 知识库（`wiki/` + `raw/`）+ 服务端维护的派生 SQLite 索引。本 skill 只通过 HTTP 访问服务端：你既不需要、也不应该伸手去摸知识库所在文件系统，所有读写都走 API。

## 准备

```bash
export LLMWIKI_URL=http://127.0.0.1:8080   # 换成实际服务地址
export LLMWIKI_TOKEN=                       # 服务端带 --token 时才需要
AUTH=(); [ -n "$LLMWIKI_TOKEN" ] && AUTH=(-H "Authorization: Bearer $LLMWIKI_TOKEN")

curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/health"      # {"status":"ok"} 表示可达
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace"   # 服务地址 + 知识库状态
```

每次都先调 `GET /api/v1/workspace`。它返回 `root`、`layout`（知识库各部分是否存在）、`counts`、`page_types`、`wiki_dirs`。计数全 0 且 `layout.index_db: false` 表示知识库是新库或没建索引，先跑 `POST /api/v1/reindex`。

服务端配了 token 时，所有 `/api/v1/*` 都要带 `Authorization`；只有 `/api/v1/health` 和 `/api/public/wiki/status` 免鉴权。

## 安装 skill

服务端自己发 skill，不用克隆仓库：

```bash
mkdir -p ~/.agents/skills/llmwiki && cd ~/.agents/skills/llmwiki
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/skill.md"           # 本文件
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/skills"      # {"entry":"/skill.md","skills":[{name,description,lang,url,url_zh}]}
# 然后对索引里每个 skill：
mkdir -p <name> && curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/skills/<name>.md" -o <name>/SKILL.md
```

中文副本在 `/skills/<name>.zh.md`（索引里的 `url_zh`），仓库里放在同名目录的 `SKILL.zh.md`。装用户实际使用的语言。

若同时装了基于文件的 `llm-wiki` skill，两者目标不同：那个直接编辑本地 markdown 目录，本 skill 通过 HTTP 驱动运行中的服务。同一个知识库不要同时用两套方式改——按用户实际访问方式选一个。

## 知识库模型

```
purpose.md            知识库目标，摄取/整理前先读
rules.md              全局约定，注入每一次 LLM 步骤
raw/sources/…         原始材料（上传、抓取），agent 只读
wiki/overview.md      顶层概览页
wiki/index.md         reindex 生成的目录，永远不要手写
wiki/log.md           追加式日志：`## [YYYY-MM-DD] action | description`
wiki/entities/ concepts/ synthesis/ comparisons/ queries/ sources/
.llmwiki/index.db     派生索引（搜索/图谱/lint），可重建，不要编辑
```

- **文件是真相，索引是派生。** 写操作走 API 让它自己重建索引；绕过服务端改的文件，必须先 `POST /api/v1/reindex`，否则搜索、图谱、lint 都看不见。
- `wiki/index.md` 由 reindex 和摄取落地重建，不要写。
- `wiki/sources/`、`wiki/templates/` 会被索引，但在列表、搜索、图谱里隐藏——它们用于溯源，不是给人浏览的。
- `raw/` 对 agent 只读：摄取作业往里写，agent 只引用、不修改。
- 响应里的路径都是相对工作区（如 `wiki/concepts/foo.md`），汇报时照抄这个路径。

## 路由

| 任务 | 阶段 skill | 端点 |
|---|---|---|
| 初次安装、配置模型、git 备份 | `llmwiki-guide` | `GET /skills/llmwiki-guide.md` |
| 回答问题、找页面、看引用关系 | `llmwiki-query` | `GET /skills/llmwiki-query.md` |
| 新建、改写、合并、移动、删除页面 | `llmwiki-organize` | `GET /skills/llmwiki-organize.md` |
| 把文件/文本变成 wiki 知识 | `llmwiki-ingest` | `GET /skills/llmwiki-ingest.md` |
| 发现并修复知识库问题 | `llmwiki-lint` | `GET /skills/llmwiki-lint.md` |

动手前先读对应阶段 skill，里面写了准确的请求体和验证步骤。

## 硬规则

1. **先读后写。** 用 `GET /api/v1/documents?source_kind=wiki` 和搜索接口确认现状，不要新建与已有页面重复的内容。
2. **一个页面一个真相。** 正文改动走 `PUT /api/v1/documents/{id}/content`，提交完整 markdown（含 frontmatter）。文件为准，数据库元数据只是缓存。
3. **frontmatter 必填**：`title`、`date`（`YYYY-MM-DD`）、`type`（与目录一致）。
4. **不编造。** 知识库没有依据就明说，改为摄取来源，不要靠猜填空。
5. **每批改动后跑 lint**；`GET /api/v1/lint` 还有你造成的 `severity: error` 时不许报成功。
6. **不编辑 `wiki/index.md`、`.llmwiki/`、`raw/`。**
7. **报证据不报动作**：列出改动的路径、lint 结果、提交了就给出 commit sha。

## 响应约定

- 错误是 `{"error": "message"}` + 4xx/5xx。`/api/v1/workspace` 或摄取接口返回 `503` 表示服务端没配知识库——停下报告，不要循环重试。
- 列表返回 `[]`，不会是 `null`。
- 摄取作业同步返回 job id；轮询 `GET /api/v1/ingest/jobs/{id}`（`queued → running → succeeded|failed`），不要假定已完成。
- 除 SSE 外，服务端对每个请求有 60s 超时。大库上的 `POST /api/v1/reindex` 可能被切断——超时不等于失败，先重新读状态，别盲目再发一次。
