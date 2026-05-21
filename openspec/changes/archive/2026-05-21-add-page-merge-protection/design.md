## Context

nashsu 三层合并保护：
1. 数组字段确定性 union（sources, tags, related）
2. 正文 LLM merge（旧≠新时）
3. 锁定字段强制保护（type, title, created）

当前 `fileblocks.go:63` 直接 WriteFile，无 read-merge 逻辑。

## Goals / Non-Goals

**Goals:**

- 重复 ingest 同一源时不丢失已有 wiki 知识
- 锁定字段不被 LLM 意外覆盖
- merge 失败时 abort 写入并报告错误

**Non-Goals:**

- CRDT/OT 级冲突解决
- 三方 merge UI

## Decisions

### Decision 1: Merge 流程

```
ApplyWikiBlocks(path, newContent):
  if not exists(path):
    write newContent
    return

  oldContent = read(path)
  if oldContent == newContent:
    skip

  oldFM, oldBody = parse(oldContent)
  newFM, newBody = parse(newContent)

  mergedFM = mergeFrontmatter(oldFM, newFM)  // 锁定 + union
  if oldBody == newBody:
    mergedBody = oldBody
  else:
    mergedBody = llmMerge(oldBody, newBody)   // 或 rule-based 若足够
    if len(mergedBody) < 0.7 * len(oldBody):
      return error "merge too aggressive"

  write frontmatter + mergedBody
```

### Decision 2: Frontmatter 合并规则

| 字段 | 策略 |
|------|------|
| type, title, created | 保留 old（锁定） |
| tags, sources, related | union 去重 |
| date, description | new 优先（若 new 非空） |
| 其他 | new 优先 |

### Decision 3: LLM Merge Prompt

仅在 body 变化时调用，temperature=0.1，中文 doc_language 约束：

```
合并以下 wiki 页面正文，保留旧内容所有重要信息，整合新内容增量。
输出完整 markdown 正文（不含 frontmatter）。
旧内容长度: N 字符。合并结果不得少于旧内容的 70%。
```

可通过 pipeline 的 llmClient 调用；独立 `mergeBody()` 函数。

### Decision 4: Force Overwrite

- Pipeline 选项 `ForceOverwrite bool`
- Web ingest job metadata 或 settings 可配置（首版 CLI flag 足够）
- force 时跳过 merge，恢复当前行为

### Decision 5: Cache 交互

cache hit 时不执行 merge（假设文件未变）。cache miss 或文件缺失时正常 merge。

## Risks

| 风险 | 缓解 |
|------|------|
| LLM merge 增加 token 成本 | 仅 body 变化时触发 |
| merge 质量不稳定 | 70% 长度 guard + 失败 abort |
| 性能（多文件 ingest） | 串行 merge，已有 page lock |
