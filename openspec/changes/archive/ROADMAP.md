# LLM Wiki 功能对齐 — OpenSpec 变更路线图

> 基于 `docs/14-gap-analysis-and-roadmap.md` 与 explore 阶段优先级决策（中文为主、Web UI + MCP 双入口、开发期无真实 workspace）。
>
> 每个 change 位于 `openspec/changes/<name>/`，含 proposal / design / tasks / specs delta。

## 总览

```
Phase 1 ─ 骨架          Phase 2 ─ 可用性        Phase 3 ─ 质量          Phase 4 ─ 体验
─────────────────────────────────────────────────────────────────────────────────────────
fix-workspace-          fix-ingest-job-cache      add-page-merge-         add-knowledge-
scaffold-zh      ──▶    add-cjk-search     ──▶   protection       ──▶   graph-ui
(P0-1,3 P1-3,4)         add-wiki-lint             add-wiki-page-          add-web-clipper
                        (P1-1,2 P2-4)             templates (P2-2)
```

## 变更清单

| 期次 | Change | Gap 项 | 优先级 | 预估 | 依赖 |
|:----:|--------|--------|:------:|:----:|------|
| **1** | [`fix-workspace-scaffold-zh`](fix-workspace-scaffold-zh/) | P0-1, P0-3, P1-3, P1-4 | P0/P1 | 3–5d | — |
| **1b** | [`fix-ingest-job-cache`](fix-ingest-job-cache/) | P0-4 | P0 | 1–2d | 可与 Phase 1 并行 |
| **2** | [`add-cjk-search`](add-cjk-search/) | CJK 分词 | P1 | 3–5d | Phase 1 |
| **2** | [`add-wiki-lint`](add-wiki-lint/) | P1-1, P1-2, P2-4 | P1 | 5–7d | Phase 1 |
| **3** | [`add-page-merge-protection`](add-page-merge-protection/) | P0-2 | P0 | 5–7d | job-cache |
| **3** | [`add-wiki-page-templates`](add-wiki-page-templates/) | P2-2 | P1.5 | 2–3d | scaffold + merge |
| **4** | [`add-knowledge-graph-ui`](add-knowledge-graph-ui/) | P2-3 | P2 | 5–7d | lint + 有测试数据 |
| **4** | [`add-web-clipper`](add-web-clipper/) | P2-1 | P2 | 5–7d | job-cache + ingest API |

## 尚未创建 OpenSpec 的 backlog（P3 / 按需）

| 功能 | 触发条件 | 建议 Change 名 |
|------|----------|----------------|
| 向量搜索 / RRF | Wiki >500 页且 FTS 不够 | `add-vector-search` |
| Louvain 社区发现 | 图谱 UI 完成后 | `add-graph-community-detection` |
| HTTP Token 认证 + 速率限制 | `serve --bind 0.0.0.0` 对外 | `add-http-auth-rate-limit` |
| TUS 可恢复上传 | 远程大文件场景 | `add-tus-upload` |
| 定时导入 (arXiv/RSS) | 用户监控需求 | `add-scheduled-import` |
| ingest 后自动更新 index | scaffold change 完成后 | `add-ingest-index-update` |
| Lint L2/L4（陈旧/矛盾） | lint L1 稳定后 | `extend-wiki-lint-llm` |

## 里程碑验收

### M1：第一个可测 workspace（Phase 1 + 1b）

- [ ] `llmwiki init` → 6 目录 + 中文 scaffold + index 框架 + Obsidian
- [ ] ingest 中文 PDF/MD → job 缓存命中
- [ ] `reindex` → index.md 自动更新

### M2：Query + Lint 可用（Phase 2）

- [ ] Web/MCP 中文搜索召回正常
- [ ] `llmwiki lint` / HTTP / MCP 三入口一致
- [ ] 无 dead_link / type_mismatch 错误（测试 workspace）

### M3：写入安全 + 结构一致（Phase 3）

- [ ] 重复 ingest 不丢内容（merge 保护）
- [ ] 产出页面含统一 section 结构

### M4：体验增强（Phase 4）

- [ ] 图谱视图可浏览 20+ 页关联
- [ ] Chrome 剪藏 → ingest job 可见

## 实施顺序建议

```
1. fix-workspace-scaffold-zh     ← 当前
2. fix-ingest-job-cache          ← 可与 1 并行
3. add-cjk-search
4. add-wiki-lint
5. add-page-merge-protection     ← 接真实数据前
6. add-wiki-page-templates
7. add-knowledge-graph-ui
8. add-web-clipper
```

每个 change 完成后运行 `/opsx:apply` 或手动按 tasks.md 实施，归档后进入下一 change。
