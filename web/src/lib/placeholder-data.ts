export type ChatSession = { id: string; title: string; time: string }

export const chatSessions: ChatSession[] = [
  { id: "s-1", title: "整理 RAG 评估方法", time: "2026-11-19T09:30:00Z" },
  { id: "s-2", title: "把会议纪要拆成实体页", time: "2026-11-18T16:10:00Z" },
  { id: "s-3", title: "补全向量检索的引用", time: "2026-11-17T11:05:00Z" },
]

export type Job = {
  id: string
  name: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  source: string
  retries: number
  updatedAt: string
}

export const jobs: Job[] = [
  { id: "job-9f2a1c", name: "attention-is-all-you-need.pdf", status: "running", source: "上传", retries: 0, updatedAt: "2026-11-19T09:42:00Z" },
  { id: "job-7d1b02", name: "RAG 评估笔记.md", status: "succeeded", source: "对话", retries: 1, updatedAt: "2026-11-19T09:31:00Z" },
  { id: "job-5c8e77", name: "团队周会纪要.md", status: "failed", source: "文本", retries: 3, updatedAt: "2026-11-18T18:22:00Z" },
  { id: "job-3a4f10", name: "pgvector 官方文档.html", status: "queued", source: "网页", retries: 0, updatedAt: "2026-11-18T17:55:00Z" },
]

export type ChangeSet = {
  id: string
  kind: "ingest" | "review_apply" | "rollback" | "manual" | "delete" | "import"
  summary: string
  pages: number
  createdAt: string
}

export const changeSets: ChangeSet[] = [
  { id: "cs-91f0", kind: "review_apply", summary: "应用 RAG 评估评审", pages: 4, createdAt: "2026-11-19T09:35:00Z" },
  { id: "cs-88a2", kind: "ingest", summary: "摄入 attention-is-all-you-need.pdf", pages: 7, createdAt: "2026-11-18T20:12:00Z" },
  { id: "cs-7cc1", kind: "rollback", summary: "回滚会议纪要摄入", pages: 2, createdAt: "2026-11-18T18:40:00Z" },
]

export type LogEntry = {
  id: string
  time: string
  level: "debug" | "info" | "warn" | "error"
  text: string
  detail?: unknown
}

export const logLines: LogEntry[] = [
  { id: "l-1", time: "2026-11-19T09:42:11Z", level: "info", text: "ingest: job job-9f2a1c 开始解析 PDF", detail: { step: "parse" } },
  { id: "l-2", time: "2026-11-19T09:42:18Z", level: "info", text: "llm: provider=openai model=gpt-4o stream=true" },
  { id: "l-3", time: "2026-11-19T09:42:31Z", level: "warn", text: "ingest: 页面 wiki/concepts/attention.md 已存在，走合并" },
  { id: "l-4", time: "2026-11-19T09:42:44Z", level: "info", text: "change_set: 写入 3 个页面" },
  { id: "l-5", time: "2026-11-19T09:43:02Z", level: "error", text: "job job-5c8e77 失败：pdftotext 缺失", detail: { missing: "pdftotext" } },
]

export type WikiDoc = { id: string; title: string; path: string; type: "entity" | "concept" | "source" | "synthesis" | "comparison" | "query" | "page" }

export const wikiDocs: WikiDoc[] = [
  { id: "w-1", title: "检索增强生成", path: "wiki/concepts/rag.md", type: "concept" },
  { id: "w-2", title: "向量数据库", path: "wiki/concepts/vector-database.md", type: "concept" },
  { id: "w-3", title: "Attention Is All You Need", path: "wiki/sources/attention-is-all-you-need.md", type: "source" },
  { id: "w-4", title: "Pgvector", path: "wiki/entities/pgvector.md", type: "entity" },
  { id: "w-5", title: "RAG 评估综述", path: "wiki/synthesis/rag-evaluation.md", type: "synthesis" },
]

export const readerMarkdown = `# 检索增强生成

检索增强生成（RAG）把外部知识检索与语言模型生成组合起来，让回答可以引用可核查的来源。

## 核心流程

1. 把文档切分成 chunk 并建立向量索引。
2. 查询时先检索相关 chunk，再连同问题交给模型。
3. 模型输出时标注引用，便于回溯。

## 相关页面

- [[向量数据库]]
- [[Attention Is All You Need]]
- [[Pgvector]]

> 评估时要同时看检索命中率与最终回答质量，不能只看其中一项。
`

export const graphNodes = [
  { id: "rag", label: "检索增强生成", type: "concept" },
  { id: "vector", label: "向量数据库", type: "concept" },
  { id: "pgvector", label: "Pgvector", type: "entity" },
  { id: "attention", label: "Attention", type: "source" },
  { id: "eval", label: "RAG 评估", type: "synthesis" },
]

export const graphEdges: [string, string][] = [
  ["rag", "vector"],
  ["rag", "attention"],
  ["vector", "pgvector"],
  ["rag", "eval"],
]
