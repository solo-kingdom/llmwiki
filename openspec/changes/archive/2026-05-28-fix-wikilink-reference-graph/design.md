## Context

知识图谱（`GET /api/v1/graph`）始终返回空 edges。项目中有两套链接解析器：

| 组件 | 文件 | 支持 `[[wikilink]]` | 支持 `[text](href)` |
|------|------|:---:|:---:|
| Lint 工具 | `internal/engine/lint.go` | ✅ `wikiDoubleBracketRe` | ✅ `wikiLinkRe` |
| 引用图谱 | `internal/engine/references.go` | ❌ 缺失 | ✅ `wikiLinkRe` |

`ReferenceParser.parseWikiLinks()` 只处理 `[text](href)` 格式，完全不识别 `[[target]]`、`[[path/to/page]]`、`[[path|display]]` 这些 Obsidian 风格的 wikilink。而项目的核心约定（`docs/reference/llm-wiki-skilled.md`）明确将 `[[wikilink]]` 作为"交叉引用是一等公民"的链接语法。

## Goals / Non-Goals

**Goals:**
- `ReferenceParser` 能解析 `[[wikilink]]` 三种变体并产出 `links_to` 边
- 修复后 reindex 可重建完整引用图，知识图谱正常展示

**Non-Goals:**
- 不修改前端 `GraphPage` 或 `isGraphEmpty` 逻辑
- 不修改 lint 工具（已正常工作）
- 不改变 `resolveWikiPath` 的解析策略
- 不支持 `#anchor` 片段（`[[page#section]]`）——当前 lint 也不处理

## Decisions

### Decision 1: 在 `parseWikiLinks` 中增加 `[[...]]` 解析分支

**选择**: 在 `references.go` 的 `parseWikiLinks` 函数中增加 `[[wikilink]]` 正则匹配，与已有 `[text](href)` 逻辑并列。

**备选方案**:
- A) 抽取 lint 和 references 共享的解析逻辑 → 拒绝：lint 读文件系统、建 pathIndex 的方式与 references 读 DB、建 docID index 的方式差异较大，强行合并引入不必要耦合
- B) 仅修改 `parseWikiLinks` → 选择此方案：改动最小，复用已有 `resolveWikiPath`

**理由**: lint 的 `extractLinkTargets` 和 references 的 `parseWikiLinks` 虽然都做链接解析，但输入源（文件系统 vs DB）、输出格式（路径 vs docID）、解析策略（pathIndex vs docsByWikiPath）完全不同。独立增加正则分支是最小侵入方案。

### Decision 2: 复用 lint 的正则模式

**选择**: 使用与 `lint.go` 第 53 行一致的正则 `\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]`。

**理由**: 同一项目中两处解析同一语法应使用一致的模式。该正则已覆盖 `[[target]]`、`[[path/to/page]]`、`[[path|display]]` 三种变体。

### Decision 3: `[[wikilink]]` 的目标路径直接交给 `resolveWikiPath` 解析

**选择**: `[[target]]` 中的 target 提取后，不经过 `wikiRel` 相对路径拼接（因为 wikilink 通常使用绝对路径如 `[[concepts/attention]]`），直接传给 `resolveWikiPath`。

**理由**: `[[wikilink]]` 的语义是"按 wiki-relative 路径查找"，例如 `[[concepts/attention]]` 对应 `wiki/concepts/attention.md`。这与 `resolveWikiPath` 的已有逻辑匹配：先查 `docsByWikiPath` 精确匹配，再追加 `.md`，最后 basename 匹配。

## Risks / Trade-offs

- **`[[page#section]]` 中的 anchor 被忽略** → 正则 `(?:\|[^\]]*)?\]\]` 只过滤 `|` 别名，不处理 `#` anchor。`resolveWikiPath` 查不到 `page#section` 会返回空字符串，边不会被创建 → 可接受：lint 的 `wikiDoubleBracketRe` 也不处理 `#`，行为一致
- **已有数据需 reindex** → 修复后用户必须重新 `llmwiki reindex` 才能看到图谱变化 → 可接受：reindex 是已有操作，成本可控
- **正则重复** → lint 和 references 各持一份相同正则 → 风险低：两个正则如果需要同步更新，可在未来提取到公共常量
