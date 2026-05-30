## Context

整理模式（organize mode）的归档流程为：Session 对话 → 归档 → Plan 生成 → 用户批准 → Apply 执行。当前 Plan JSON 只有一个 `path` 字段，无法表达 move 的 from/to 和 merge 的多源路径。Apply 阶段只生成新文件，不删除被替换的旧文件。lint 系统也没有检测重复页面的能力。

现有代码基础：
- `ApplyWikiBlocks()` 已支持 `---DELETE---` 块删除文件（`internal/ingest/fileblocks.go`）
- `normalizeNameKey()` 已实现文件名归一化（`internal/engine/entity_concept_coupling.go`）
- `similar` 工具已实现 FTS 内容相似度检测（`internal/mcp/diagnostic_tools.go`）
- `archiveSessionRequest` 当前只有 `title` 字段（`internal/api/ingest_session.go`）

## Goals / Non-Goals

**Goals:**
- 整理归档后，被 move/merge 替换的旧文件自动删除，不留残留
- lint 系统能检测文件名归一化后相同的重复页面
- 归档对话框提供「深度整理」开关，启用后 plan 阶段额外做内容相似度检测并纳入 merge 建议
- Plan JSON schema 能完整表达 move/merge 的源路径和目标路径
- 向后兼容：旧格式 plan JSON（不含新字段）不影响现有流程

**Non-Goals:**
- 不自动移动/删除用户手动创建的页面，只处理 plan 中明确声明的 move/merge 动作
- 不在本 change 中实现 UI 层面的重复页面管理界面
- 不修改 ingest（默认摄入）和 QA 模式的归档行为，仅影响 organize 模式
- 不实现跨 workspace 的重复检测

## Decisions

### Decision 1: Plan JSON schema 扩展

**选择**：在 `changes[]` 中增加 `from_path`、`to_path`、`source_paths` 可选字段。

```json
{
  "summary": "...",
  "changes": [
    {"action": "update", "path": "wiki/concepts/X.md", "rationale": "..."},
    {"action": "move", "from_path": "wiki/concepts/A_Player文化.md", "to_path": "wiki/concepts/A Player文化.md", "path": "wiki/concepts/A Player文化.md", "rationale": "..."},
    {"action": "merge", "source_paths": ["wiki/concepts/A_Player文化.md", "wiki/concepts/A Player文化.md"], "to_path": "wiki/concepts/A Player文化.md", "path": "wiki/concepts/A Player文化.md", "rationale": "..."}
  ]
}
```

**备选方案**：
- (A) 只用 `rationale` 自由文本描述 move 来源 → 不可靠，无法程序化提取
- (B) 用 `source_path` + `path` 两个字段 → 不够清晰，move 和 merge 语义混在一起

**理由**：明确字段名让代码能确定性提取源路径，`from_path`/`to_path` 对 move 语义清晰，`source_paths`/`to_path` 对 merge 语义清晰。`path` 保持向后兼容（现有代码读取 `path` 不受影响）。新字段全部 optional。

### Decision 2: Post-apply cleanup 走 ApplyWikiBlocks DELETE 路径

**选择**：在 `generateFromPlan()` 中，LLM 生成 FILE blocks 后，解析 plan JSON 提取 move/merge 源路径，注入 `---DELETE---` blocks，然后统一调用 `ApplyWikiBlocks()`。

**备选方案**：
- (A) 直接 `os.Remove()` → 绕过了 `ApplyWikiBlocks` 的路径验证和 worktree 逻辑
- (B) 在 LLM prompt 中要求模型生成 DELETE blocks → 不可靠，模型可能遗漏
- (C) 单独调用 `ApplyWikiBlocks()` 一次处理 DELETE → 两次调用，worktree 模式下不一致

**理由**：复用 `ApplyWikiBlocks` 保证路径验证一致，且在 worktree 模式下删除也在 worktree 内执行。注入 DELETE blocks 与写入 blocks 合并调用，确保原子性。

**安全约束**：
- 只提取 `action` 为 `move` 或 `merge` 的源路径
- `update` action 的 path 不参与删除
- 源路径若与新生成的 FILE block 目标重合则跳过（避免删刚写的文件）
- 源路径必须通过 `NormalizeWikiFilePath` 验证

### Decision 3: duplicate_page 检测基于文件名归一化

**选择**：复用 `entity_concept_coupling.go` 的 `normalizeNameKey()` 函数，对同目录下的 wiki 页面文件名做归一化匹配。

**检测范围**：同一 typed 子目录（如 `wiki/concepts/`）内的文件两两比较。

**归一化规则**：去空格、下划线、连字符、全角空格 → 小写。这与 `normalizeNameKey()` 现有逻辑一致。

**Severity**: `warning`（因为可能是合理的内容演进残留）。

**备选方案**：
- (A) 全文内容 hash 比较 → 成本高，且整理模式产生的新旧文件内容往往不同
- (B) 标题相似度 → frontmatter title 可能为空，不如文件名可靠

**理由**：文件名归一化零成本、确定性高、覆盖最常见的重复场景（空格 vs 下划线）。

### Decision 4: 深度整理开关放在归档对话框

**选择**：在 `IngestChat.tsx` 的归档确认面板中增加 checkbox「深度整理：检测并合并内容重复页面」，仅 `sessionMode === "organize"` 时显示。

**数据流**：
1. 前端 `archiveSessionRequest` 增加 `deep_organize` 布尔字段
2. 后端存入 `ingest_reviews` 表的 `deep_organize` 列
3. Plan job 执行时读取该字段，若为 true 则在 plan prompt 中注入相似页面信息
4. 相似度检测复用 `db.SearchChunks()`（与 `similar` 工具相同逻辑）

**备选方案**：
- (A) 放在 SessionControls 模式按钮旁 → 位置不明显，且与 mode 切换混在一起
- (B) 放在 Settings → 每次整理都要去设置页切换，不便捷
- (C) 始终开启 → 对于小 wiki 不必要，FTS 扫描有成本

**理由**：归档对话框是整理流程的最后一步，用户此时对整理范围最清楚。开关仅在 organize 模式出现，避免对 ingest/QA 用户造成干扰。

### Decision 5: IngestReview 表增加 deep_organize 列

**选择**：`ingest_reviews` 表增加 `deep_organize BOOLEAN NOT NULL DEFAULT FALSE`。

**理由**：review 级别比 session 级别更合适——每次归档独立决定是否深度整理。同一 session 可以先普通归档再深度归档。数据库迁移用 ALTER TABLE ADD COLUMN，向后兼容。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| [DELETE 误删] plan JSON 中源路径指向不应删除的文件 | 安全约束：只处理 move/merge 动作；源路径与 FILE block 目标重合时跳过；通过 `NormalizeWikiFilePath` 验证路径合法性 |
| [Plan JSON 新字段未填] LLM 可能不填 from_path/to_path | prompt 中明确要求填；代码 fallback：若新字段为空，不执行删除，不影响现有流程 |
| [深度整理 FTS 性能] 大 wiki 下内容相似度扫描耗时 | 限制扫描范围（同目录内），限制候选数；异步执行在 plan job 中，不阻塞用户 |
| [duplicate_page 误报] 不同概念恰好归一化名称相同 | severity 设为 warning 而非 error；用户可忽略 |
| [数据库迁移] 新增列需要 ALTER TABLE | SQLite ADD COLUMN 是兼容操作，DEFAULT FALSE 保证旧数据一致 |

## Open Questions

- 深度整理的内容相似度阈值是否需要用户可配置？当前设计硬编码 `score >= 0.3`（与 similar 工具一致）。如果未来需要可配置，可以在 Settings 中增加。
