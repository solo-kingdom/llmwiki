---
name: llmwiki
description: 通过 HTTP API 操作 llmwiki 服务——读写 wiki 页面、跑摄取流水线、检查并修复知识库、查看与回滚修订历史。用户提到 llmwiki、wiki 服务，或要求新增、查询、摄取、整理、检查、回滚 wiki 知识时使用。本文件是入口，负责把任务路由到各阶段 skill。
license: MIT
metadata:
  author: llmwiki
  version: "2.1"
  lang: zh
---

# llmwiki

> **版本声明**：`skill: project-design-patterns@1.1.0` —— 本文件依据该版本 skill 内的 `agent-api-ops` 操作规范编写。agent 每次会话首次操作前比对本机 `project-design-patterns` 的 `version`；低于此版本时先执行 `npx skills add sunzhenkai/solo-skills -s project-design-patterns -g -y` 升级再操作。

LLM Wiki 是由 PostgreSQL 驱动的 markdown 知识库（`wiki/` + `raw/`）。本 skill 只通过 HTTP 访问服务端：你既不需要、也不应该伸手去摸知识库所在文件系统，所有读写都走 API。

## 接入与认证

- **API Base**：以接入话术为准（形如 `http://127.0.0.1:8080` 或 `https://wiki.lan`）。
- **认证**：全部 `/api/v1/*` 业务接口带 Header `Authorization: Bearer <API Key>`（`llmwiki_sk_…`，在 Web **设置 › 访问控制**创建；同时也兼容传统 `--token` / `api_token`）。
- **免鉴权端点**：`GET /api/v1/health`、`GET /api/public/wiki/status`（开启公开 wiki 时含 `/api/public/wiki/*`）、`GET /skill.md`、`GET /skills/*`、`GET /api/v1/skills`。
- **权限边界**：API Key 可调用全部业务接口，但**不能管理凭证**（`GET/POST/DELETE /api/v1/api-keys*` 及通过 `PUT /api/v1/settings` 修改 `api_token` 一律返回 `403`），凭证管理请在 Web 端完成。
- **401 处理**：`401` 表示 Key 无效或已吊销，停止重试，提醒用户在 **设置 › 访问控制**重建并更新 `~/.agent-state/app-keys/llmwiki.env`。输出与日志只显示 Key 前缀（如 `llmwiki_sk_abcd…`）。

```bash
source ~/.agent-state/app-keys/llmwiki.env   # APP_API_BASE、APP_API_KEY
AUTH=(-H "Authorization: Bearer $APP_API_KEY")

curl -fsS "$APP_API_BASE/api/v1/health"                   # {"status":"ok"} 表示可达
curl -fsS "${AUTH[@]}" "$APP_API_BASE/api/v1/workspace"   # 知识库布局与统计
```

每次都先调 `GET /api/v1/workspace`。它返回 `root`、`layout`（知识库各部分是否存在）、`counts`、`page_types`、`wiki_dirs`。计数全 0 且 `layout.index_db: false` 表示 PostgreSQL 未初始化：检查 `--database-url` 并先跑 `llmwiki init`。

## 获取与安装 skill

服务端免鉴权发布自身 skill 文档，无需克隆仓库：

```bash
curl -fsS "$APP_API_BASE/skill.md"           # 英文入口文档
curl -fsS "$APP_API_BASE/api/v1/skills"      # {"entry":"/skill.md","skills":[{name,description,lang,url,url_zh}]}
curl -fsS "$APP_API_BASE/skills/<name>.zh.md" # 各阶段中文文档（英文为 <name>.md）
```

若同时装了基于文件的 `llm-wiki` skill，两者目标不同：那个直接编辑本地 markdown 目录，本 skill 通过 HTTP 驱动运行中的服务。同一个知识库不要同时用两套方式改——按用户实际访问方式选一个。

## 核心端点速查

| 域 | 方法与路径 | 说明 |
| --- | --- | --- |
| 系统 | `GET /api/v1/health` | 健康检查（免鉴权） |
| 工作区 | `GET /api/v1/workspace` | 布局、统计、页面类型与目录 |
| 索引 | `POST /api/v1/reindex` | 重建派生索引 |
| 目录树 | `GET /api/v1/tree`、`GET/POST/PATCH/DELETE /api/v1/folders`、`POST /api/v1/folders/move` | 主题目录树与文件夹管理 |
| 文档 | `GET/POST /api/v1/documents`、`GET/PATCH/DELETE /api/v1/documents/:id` | 列出/新建/读取/更新元信息/删除页面 |
| 正文 | `GET/PUT /api/v1/documents/:id/content` | 读取或整篇替换 markdown（含 frontmatter） |
| 生命周期 | `POST /api/v1/documents/:id/{move,archive,reopen}`、`POST /api/v1/documents/bulk-delete` | 移动、归档、重开、批量删除 |
| 搜索 | `GET /api/v1/search?q=&mode=&limit=` | 全文/混合检索 |
| 图谱与检查 | `GET /api/v1/graph`、`GET /api/v1/graph/{backlinks/:id,forward/:id,uncited,stale}`、`GET /api/v1/lint` | 知识图谱与健康检查 |
| 摄取 | `GET/POST /api/v1/ingest/jobs*`、`GET/POST /api/v1/ingest/sessions*`、`GET/POST /api/v1/ingest/reviews*` | 摄取任务、对话会话、审阅计划 |
| 历史 | `GET /api/v1/history`、`GET /api/v1/history/:id{,/diff}`、`POST /api/v1/history/:id/rollback`、`GET /api/v1/pages/history`、`POST /api/v1/revisions/:id/restore` | 变更集、差异、回滚、版本恢复 |
| 设置 | `GET/PUT /api/v1/settings`、`GET/PUT /api/v1/workspace/rule-files` | 运行设置（API Key 不可改 `api_token`）与 `purpose.md` / `rules.md` |

## 知识库模型

```
purpose.md            知识库目标，摄取/整理前先读
rules.md              全局约定，注入每一次 LLM 步骤
raw/sources/…         原始材料（上传、抓取），agent 只读
wiki/overview.md      顶层概览页
wiki/index.md         reindex 生成的目录，永远不要手写
wiki/log.md           追加式日志：`## [YYYY-MM-DD] action | description`
wiki/<主题>/…         多级主题目录（页面类型由 frontmatter \`type:\` 标注：entity|concept|synthesis|comparison|query|experience|ledger|page）
wiki/sources/         源摘要页（默认在列表/搜索/图谱中隐藏）
wiki/templates/       系统模板目录
PostgreSQL            页面、目录树、版本、搜索、图谱、lint — 唯一真源
```

- **写操作走 API**；绕过服务端改的文件，必须先 `POST /api/v1/reindex`，否则搜索、图谱、lint 都看不见。
- `wiki/index.md` 由 reindex 和摄取落地重建，不要写。
- `wiki/sources/`、`wiki/templates/` 会被索引，但在列表、搜索、图谱里隐藏——它们用于溯源，不是给人浏览的。
- `raw/` 对 agent 只读：摄取作业往里写，agent 只引用、不修改。
- 响应里的路径都是相对工作区（如 `wiki/产品与项目/llmwiki/页面.md`），汇报时照抄这个路径。

## 路由

| 任务 | 阶段 skill | 端点 |
| --- | --- | --- |
| 初次安装、配置模型与 embedding、历史与回滚 | `llmwiki-guide` | `GET /skills/llmwiki-guide.zh.md` |
| 回答问题、找页面、看引用关系 | `llmwiki-query` | `GET /skills/llmwiki-query.zh.md` |
| 新建、改写、合并、移动、删除页面 | `llmwiki-organize` | `GET /skills/llmwiki-organize.zh.md` |
| 把文件/文本变成 wiki 知识 | `llmwiki-ingest` | `GET /skills/llmwiki-ingest.zh.md` |
| 发现并修复知识库问题 | `llmwiki-lint` | `GET /skills/llmwiki-lint.zh.md` |

动手前先读对应阶段 skill，里面写了准确的请求体和验证步骤。

## 硬规则

1. **先读后写。** 用 `GET /api/v1/documents?source_kind=wiki` 和搜索接口确认现状，不要新建与已有页面重复的内容。
2. **一个页面一个真相。** 正文改动走 `PUT /api/v1/documents/{id}/content`，提交完整 markdown（含 frontmatter）。
3. **frontmatter 必填**：`title`、`date`（`YYYY-MM-DD`）、`type`；`experience`/`ledger` 必填 `status`；建议填 `confidence`（`high|medium|low`）与 `sources`。
4. **不编造。** 知识库没有依据就明说，改为摄取来源，不要靠猜填空；`draft` / `deprecated` / 已归档页不作为现行真理。
5. **高风险先确认。** 删除、覆盖、批量修改前向用户复述目标并等待确认。
6. **每批改动后跑 lint**；`GET /api/v1/lint` 还有你造成的 `severity: error` 时不许报成功。
7. **不编辑 `wiki/index.md`、`.llmwiki/`、`raw/`。**
8. **报证据不报动作**：列出改动的路径、lint 结果、执行过回滚就给出 change set id。

## 响应约定

- 错误是 `{"error": "message"}` + 4xx/5xx。`/api/v1/workspace` 或摄取接口返回 `503` 表示服务端没配知识库——停下报告，不要循环重试。
- 列表返回 `[]`，不会是 `null`。
- 摄取作业同步返回 job id；轮询 `GET /api/v1/ingest/jobs/{id}`（`queued → running → succeeded|failed`），不要假定已完成。
- `GET /api/v1/ingest/jobs` 返回 `{ jobs, total, counts }`，不是裸数组。可用 `status`（逗号分隔：`queued`、`running`、`succeeded`、`failed`、`cancelled`）、`input_type`、`q`（匹配 id、来源路径、source ref）筛选。`limit` 默认 50、最大 100；`offset` 按 `total` 翻页。`counts` 是不带筛选条件的各状态总数。
- 除 SSE 外，服务端对每个请求有 60s 超时。大库上的 `POST /api/v1/reindex` 可能被切断——超时不等于失败，先重新读状态，别盲目再发一次。
