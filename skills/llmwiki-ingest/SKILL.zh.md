---
name: llmwiki-ingest
description: 通过 HTTP 把文件、文本或对话喂进 llmwiki 知识库——排队摄取作业、走会话/计划/批准流水线、回滚提交。用户想加原始材料、摄取文档、把对话整理进 wiki，或撤销上次摄取时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-ingest

摄取把原始材料变成知识库内容：服务端抽取文本并归档到档案库（`archives`），由配置的模型起草页面改动，审核流程下只在批准后提交。`$LLMWIKI_URL` 和鉴权头来自入口 skill `llmwiki`。

前置条件：必须配好 `job_instance_id` 与 `job_model`（见 `llmwiki-guide` §3），否则作业会因配置缺失失败。

## 快路径：一个来源一个作业

```bash
# 粘贴文本或小文档
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/jobs/text" \
  -H 'Content-Type: application/json' \
  -d '{"content":"<正文>","title":"<标题>","filename":"note.md","source_ref":"user-paste"}'
# → 201 {"job":{"id":"…","status":"queued",…}}

# 文件（multipart，多个文件就重复 -F files=@…）
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/jobs/upload" \
  -F "files=@./paper.pdf" -F "source_ref=user-upload"
```

执行器会在几秒内取走排队作业，状态走 `queued → running → succeeded | failed`。轮询：

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}/events"   # 分步进度
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/jobs/{id}/source"   # 落盘的来源正文
```

- `succeeded`：`result_summary` 里写了新建或更新了哪些页面。用 `llmwiki-query` 核实，别只信摘要。
- `failed`：看 `error_code`、`error_message`、`missing_dependency`、`remediation`。缺依赖（如 PDF/OCR 工具）由 `GET /api/v1/capabilities` 报出——告诉用户，不要重试。
- `POST /api/v1/ingest/jobs/{id}/retry` 重排失败作业（受 `max_retries` 限制）；`POST /{id}/cancel` 取消排队或运行中的作业。

不要密集轮询。查一次，之后间隔 10–30s，几分钟仍无结果就带着 job id 和最后一条事件汇报。

`POST /api/v1/ingest/jobs/conversation` 是旧的一次性路径（粘贴即作业）。用户想先讨论、修改、审阅再落地时，用下面的会话流程。

## 大批量：并行处理

作业默认串行。大批量摄入时打开并行并调大并发：

```bash
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/settings" \
  -H 'Content-Type: application/json' \
  -d '{"job_parallel_enabled":true,"job_max_concurrent":8}'
```

- 改动对新认领的作业即时生效，不用重启；`job_parallel_enabled:false` 即回到串行。
- 同一 wiki 页面的写入会排队合并；不同路径但标题/文件名/alias 规范化后相同的页面会在 PostgreSQL 事务内去重，冲突作业失败并给出已有路径，不会落出副本。
- analysis 必须产出有效 page plan；空 analysis、无计划、generation 偏离计划都会失败且不会写入。一个 source 新增超过 3 个业务页或 2 个 concept 必须走 review。
- `structure_policy_mode` 控制目录策略：`legacy` 兼容、`report` 记录旧类型根告警、`enforce` 禁止新自动页写旧类型根或未登记主题组。存量 update 与 rollback/reindex 保留兼容。
- 限流（429）与瞬时错误（5xx、网络、流空闲）按有界退避自动重试，在作业事件里记为 `llm request retry`。供应商的每分钟请求上限会让高并发表现为「重试变多」而不是「失败变多」；重试占主导时调低 `job_max_concurrent`。

## 审核路径：会话 → 归档 → 计划 → 批准

```
POST /ingest/sessions                          → 会话 id
POST /ingest/sessions/{id}/messages (stream)   ← 讨论、修改、传附件
POST /ingest/sessions/{id}/archive             → review(id)，状态 "planning"，同时排计划作业
GET  /ingest/reviews/{review_id}/plans         → 各版本计划（plan_markdown + plan_json）
POST /ingest/reviews/{id}/feedback             → 提修改意见，再 /replan
POST /ingest/reviews/{id}/approve              → 落地作业，合入知识库
GET  /ingest/jobs/{apply_job_id}               → succeeded 后读 review.change_set_id
```

### 会话

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"title":"季报要点","mode":"ingest"}'
```

`mode` 为 `ingest`（默认）、`qa`、`organize`；`agent_kind` 默认 `native`（本服务的 LLM 运行时），可设 `acp` 配 `acp_agent_id` 交给外部 agent——用户没要求就别改。

消息：

```bash
# 只存消息，不调模型
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/messages" \
  -H 'Content-Type: application/json' -d '{"content":"…"}'

# 流式拿模型回复（SSE）
curl -fsS -N "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/messages?stream=1" \
  -H 'Content-Type: application/json' \
  -d '{"content":"请把这份纪要整理进对应主题组","wiki_refs":[{"document_id":"<doc_id>","relative_path":"wiki/products/llmwiki/foo.md"}]}'
```

SSE 事件：`user_message`、`assistant_start`、`token`、`thought`、`tool_start`、`tool_done`、`plan`、`permission`、`warning`、`done`（最终消息对象）、`error`。同一会话同时只能有一个流——第二个请求返回 `409`。附件上传是 `POST /ingest/sessions/{id}/attachments`（multipart `file`），附件会随会话一起归档。

### 归档 → 审核

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/sessions/{id}/archive" \
  -H 'Content-Type: application/json' -d '{"title":"季报要点","deep_organize":false}'
# → 201 {"review_id":"…","status":"planning","source_path":"raw/sources/…","plan_job_id":"…"}
```

会话记录会变成 `raw/sources/` 下的一个来源文件，审核再规划怎么合进 wiki。`deep_organize: true` 允许规划器改动已有页面，而不只是新增。

审核状态：`planning → ready_for_review → (revising ⇄) → approved → applying → succeeded | failed | cancelled`。看计划、提修改：

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}"          # 含 current_plan_version
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/plans"    # [{version, plan_markdown, plan_json}]
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/feedback" \
  -H 'Content-Type: application/json' -d '{"content":"合并到现有 attention 页，不要新建"}'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/reviews/{id}/replan"   # 202，重新生成计划
```

批准前把 `plan_markdown` 给用户看——这是知识库被改动前最后一道关卡。`approve` 只在 `ready_for_review` 接受，返回 `202` 和落地作业 id；写入在 PostgreSQL 事务中原子完成，知识库不会写到一半。

### 验证

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/ingest/reviews/{id}"     # succeeded + change_set_id
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/lint"
```

然后用新页面回答用户原来的问题，并给出页面路径。

## 回滚

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/ingest/rollback" \
  -H 'Content-Type: application/json' -d '{"change_set_id":"<来自 review>"}'
```

排一个确定性回滚作业：change set 内每个页面恢复到父修订，新建页面软删。像普通作业一样轮询。不要回滚你在 `GET /api/v1/history` 里认不出的 change set。

## 规则

- 一个会话只装一件事。一个会话归档成一个来源文件，混装的材料会让计划无法合并。
- 用户没看过的计划不许批准，也不许重复批准——第二次返回 `409`。
- 作业因缺依赖或模型不可用失败时，停下报告；重试解决不了配置问题。
- 摄取自己会写 `raw/` 和 `wiki/`。作业运行期间不要手改这些文件。
