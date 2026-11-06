---
name: llmwiki-guide
description: 通过 HTTP 安装与运维 llmwiki 服务——检查知识库状态、配置摄取与会话用的模型实例、重建索引、管理 git 快照。wiki 连不上、刚部署、缺模型配置、搜索结果过期，或用户要求备份、推送、恢复时使用。
license: MIT
metadata:
  author: llmwiki
  version: "2.0"
  lang: zh
---

# llmwiki-guide

安装与运维。每一步都是一次 HTTP 调用，不需要 shell 访问知识库。`$LLMWIKI_URL` 和可选的 `Authorization` 头来自入口 skill `llmwiki`。

## 1. 服务活着吗，有知识库吗

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/health"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace"
```

先读 workspace 返回：

| 字段 | 含义 | 不正常时怎么办 |
|---|---|---|
| `root` | 服务端的知识库路径 | 如实报告，不要当作本机路径 |
| `layout.purpose` / `layout.rules` | `purpose.md` / `rules.md` 是否存在 | 缺失说明库未初始化，请用户在服务端跑 `llmwiki init`（没有 HTTP 初始化接口） |
| `layout.wiki` / `layout.raw_sources` | 内容目录是否存在 | 同上 |
| `layout.index_db` | `.llmwiki/index.db` 是否存在 | `false` 时跑 `POST /api/v1/reindex` |
| `counts` | 文档 / wiki 页面 / 来源数量 | 文件明明存在却全 0，跑 reindex |
| `page_types` | 各类型页面数 | 与 `wiki_dirs` 不一致提示页面放错目录，见 `llmwiki-lint` |
| `wiki_dirs` | `wiki/` 各子目录的 md 数，`""` 为顶层 | 子目录全空说明还没有内容 |

这里返回 `503` 表示服务端启动时没带 `--workspace`，停下报告，重试无用。

## 2. 重建派生索引

```bash
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/reindex"
```

返回 `{"indexed": <n>, "status": "ok"}`。它是同步的，而服务端对非流式请求有 60s 超时——大库超时不一定代表失败，先看 `GET /api/v1/workspace` 计数和 `GET /api/v1/lint`，再决定是否重试。Reindex 会遍历知识库、重读 frontmatter 与链接、清掉文件已消失的记录、重写 `wiki/index.md`。凡是在写接口之外改过文件或恢复过文件，都要跑一次。

## 3. 配置摄取与会话用的模型

摄取作业和会话需要「一个 provider 实例 + 一个模型」，存于设置项 `job_instance_id` / `job_model`。

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/providers"                       # 目录：id、name、api_base
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/providers/{catalog_id}/models"   # 该目录项支持的模型
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/provider-instances" \
  -H 'Content-Type: application/json' \
  -d '{"name":"main","catalog_id":"<id>","api_key":"<key>","base_url":"<可选覆盖地址>"}'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/provider-instances/{instance_id}/check"  # 实测连通
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/settings"
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/settings" \
  -H 'Content-Type: application/json' \
  -d '{"job_instance_id":"<instance_id>","job_model":"<model id>"}'
```

`PUT /api/v1/settings` 是部分更新，只发要改的键。可用键包括 `job_instance_id`、`job_model`、`temperature`、`max_tokens`、`chunk_size`、`chunk_overlap`、`auto_reindex`、`watch_sources`、`doc_language`（`zh`/`en`）、`ui_language`、`rules_supplement`、`backup_include_raw`、`vc_auto_push`、`default_agent_kind`、`default_acp_agent_id`。未知键会被忽略，改完重新读 settings 确认。

密钥：不要把 `api_key` 回显给用户，也不要写进报告。

## 4. 服务端能解析什么

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/capabilities"
```

返回 `file_types[]`（含 `tier`、`can_extract`、`can_chunk`、`missing_deps`、`remediation`）和 `runtime_dependencies[]`。目标格式带 `missing_deps` 时，直接告诉用户缺哪个依赖，不要丢一个注定失败的摄取作业过去。

`GET /api/v1/vcs/status` 也会报 git 是否可用；没有 git 时快照和摄取落地都无法提交。

## 5. 库内约定（`rules.md`）

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/workspace/rule-files"   # purpose.md / rules.md 当前内容
```

摄取和整理前先读，里面是用户的写作约定。写入也走同一个端点：

```bash
curl -fsS "${AUTH[@]}" -X PUT "$LLMWIKI_URL/api/v1/workspace/rule-files" \
  -H 'Content-Type: application/json' \
  -d '{"rules": "# 约定\n- 中文页面，实体页必须链接来源页\n"}'
```

`PUT` 接受 `purpose` 和/或 `rules`（markdown，非空），写文件并重建索引。只有用户要求修改约定时才动它——它会影响之后每一次 LLM 步骤。一次性的补充指示写 `rules_supplement`（`PUT /api/v1/settings`）。不要把长篇规范塞进页面。

## 6. Git 快照

```bash
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/status"    # 是否初始化、远程、脏文件、ahead/behind
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/log?limit=20"
curl -fsS "${AUTH[@]}" "$LLMWIKI_URL/api/v1/vcs/diff/{sha}"
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/init"                      # 仅首次
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/remote" -H 'Content-Type: application/json' -d '{"url":"<remote>"}'
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/backup"                    # 提交快照 → {"status":"ok","commit_sha":"…"}
curl -fsS "${AUTH[@]}" -X POST "$LLMWIKI_URL/api/v1/vcs/push"
```

`backup` 会导出设置、暂存知识库并提交；没有变化时 `commit_sha` 为空。`push` 需要已配 remote。回退到历史状态用 `POST /api/v1/ingest/rollback {"commit_sha": "…"}`，它会排一个回滚作业，像其他作业一样轮询。

## 7. 收尾

汇报：知识库 `root`、reindex 后的计数、当前 `job_instance_id`/`job_model`、提交了就给出快照 sha。没动过的字段不用提。
