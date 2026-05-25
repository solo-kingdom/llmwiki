## Context

项目文档采用 Karpathy LLM Wiki 的知识类型目录模型：`wiki/entities/`、`wiki/concepts/`、`wiki/sources/`、`wiki/synthesis/`、`wiki/comparisons/`、`wiki/queries/` 承载业务知识页，`wiki/overview.md`、`wiki/index.md`、`wiki/log.md` 留在顶层作为导航和审计文件。

当前实现已经有目录 scaffold、模板和部分 prompt guidance，但约束主要停留在提示词层面。`ApplyWikiBlocks` 只要求路径以 `wiki/` 开头，lint 只验证已经位于类型目录中的页面，index builder 只扫描类型目录，导致 LLM 可以持续生成 `wiki/dsp.md` 这类顶层业务页，而系统不会报错。

另一个约束是文档生成语言：系统已有 `doc_language` 设置与 prompt composer，但本次需要确保新增组织提示、模板指导、整理规划与错误信息不绕过这个设置。

## Goals / Non-Goals

**Goals:**

- 建立统一的 typed wiki 组织规则，所有模块共享同一份目录、页面类型和顶层保留文件定义。
- 阻止新的业务知识页继续写入 `wiki/` 顶层。
- 让 lint、organize 诊断和 index 生成能发现并展示既有 misplaced pages。
- 避免 `wiki/templates/` 被当作普通知识页进入索引、结构统计或孤立页诊断。
- 让生成提示和整理/归档规划默认使用 `doc_language` 指定的文档语言。

**Non-Goals:**

- 不在本 change 中自动移动已有顶层页面；移动可能影响链接、历史和用户预期，应通过后续整理计划或专门迁移步骤执行。
- 不引入新的数据库表；SQLite 仍是文件系统内容的可重建索引。
- 不改变已有 `wiki/overview.md`、`wiki/index.md`、`wiki/log.md` 的顶层位置。
- 不扩展新的领域特化目录，如 `people/`、`methods/`、`experiments/`。

## Decisions

### 1. 用 engine 层统一定义组织契约

新增或扩展 `internal/engine` 中的 page type helper，集中暴露：

- typed subdir 到 page type 的映射。
- 顶层保留页面集合：`wiki/overview.md`、`wiki/index.md`、`wiki/log.md`。
- 系统目录集合：`wiki/templates/`。
- `ClassifyWikiPath(relPath)` / `IsTypedWikiPage(relPath)` / `IsTopLevelReservedWikiPage(relPath)` / `IsMisplacedWikiPage(relPath)` 之类的判定函数。

理由：ingest、lint、index、MCP 诊断都需要同一套判断。如果各模块复制字符串列表，会继续出现“初始化知道目录，但写入/诊断不知道”的漂移。

替代方案：只在 prompt 中加强要求。这个方案成本低，但不能防止模型输出错误路径，也无法发现旧 workspace 中的平铺页面。

### 2. 写入阶段拒绝新顶层业务页

`ApplyWikiBlocks` 在写入前校验每个 FILE 块路径：

- 非 `wiki/` 路径继续拒绝或跳过。
- 顶层保留页面允许。
- `wiki/templates/` 由 scaffold 管理，不作为 ingest 产物目标。
- 已知 typed subdir 下的 `.md` 页面允许。
- `wiki/*.md` 中不属于保留页面的业务页返回结构化错误，阻止写入。

理由：prompt 是软约束，写入阶段是最后防线。拒绝新错误比事后清理更便宜，也保护 `index.md` 的目录模型。

替代方案：自动根据 frontmatter `type` 改写路径。该方案看似友好，但可能改变 LLM 期望路径、破坏链接，也会让错误不明显。先拒绝并给出明确错误更可控。

### 3. 迁移期用 lint 暴露旧问题，不自动改动

新增 lint issue code，例如 `misplaced_wiki_page` 和 `template_indexed_as_content`。对于已经存在的 `wiki/dsp.md` 这类顶层业务页，lint 输出 warning 或 error，并建议目标目录：

- frontmatter `type` 可识别时按 type 建议目录。
- 无 type 时根据文件名/标题无法可靠判定，只提示需要整理。

理由：已有页面是用户数据，自动移动会影响链接、Obsidian 图谱和 Git 历史。先让问题可见，用户可通过整理模式或后续 apply 任务执行迁移。

替代方案：init/reindex 时自动迁移。风险过高，不适合默认行为。

### 4. index 与诊断工具区分内容页和系统页

`wiki/index.md` 继续只收录 typed content pages。`wiki/templates/` 不进入内容索引，不参与孤立页检查。structure/audit 工具仍可显示 `templates/`，但标记为系统目录，不计入普通知识页数量。

理由：模板是生成约束，不是知识内容。把模板当页面会污染搜索、结构统计和相似页面诊断。

替代方案：把模板移出 `wiki/`。这会偏离当前设计和已有 scaffold；保留目录但分类为系统目录更兼容。

### 5. doc_language 作为所有默认生成文本的硬约束

在 `ComposeSystemPrompt` 和 template guidance 中继续以 `doc_language` 分支输出中文/英文默认指令，并补充组织规则的语言化文本：

- `doc_language=zh`：生成页面正文、标题、描述、章节提示默认中文。
- `doc_language=en`：生成页面正文、标题、描述、章节提示默认英文。
- 用户源材料可保留原术语，但大段正文语言服从设置。

整理模式、归档规划和 generation step 均应走相同 prompt composer 或显式传入同一 language instruction。

替代方案：由 UI 文案语言推断文档语言。UI 语言和文档语言是不同设置，混用会让双语用户无法控制输出。

## Risks / Trade-offs

- [旧 workspace 已有顶层业务页会开始报 lint 问题] → 作为迁移期 warning/diagnostic 暴露，不自动删除或移动。
- [LLM 输出非法 FILE 路径会导致 job 失败] → 错误信息应列出允许目录，并建议重新生成或调整 rules；这比静默写错路径更可恢复。
- [某些用户希望平铺 wiki] → 本项目文档和 specs 已选择类型目录模型；平铺模型不作为本 change 的兼容目标。
- [模板目录排除后搜索不到模板内容] → 模板仍保留在文件系统和结构工具中，只是不作为知识内容页进入普通索引/诊断。
- [语言设置覆盖用户临时意图] → `rules_supplement` 和源内容仍可要求保留术语，但默认生成正文语言应以 `doc_language` 为准。

## Migration Plan

1. 引入 engine 层组织 helper 和测试，先不改业务行为。
2. 更新 lint/index/structure/audit 使用 helper，确保旧平铺页面可被诊断但不被自动移动。
3. 更新 prompt/template guidance，让 generation 明确选择 typed 目录并服从 `doc_language`。
4. 更新 `ApplyWikiBlocks` 路径校验，阻止新的顶层业务页。
5. 为旧 workspace 提供整理建议：用户可在 organize 模式查看 misplaced pages，再归档移动计划。

Rollback 策略：如果写入阶段拒绝过严，可临时只保留 lint 警告并关闭硬拒绝；由于没有数据迁移，回滚不需要数据库变更。

## Open Questions

- `misplaced_wiki_page` 应为 error 还是 warning？建议旧文件 lint 使用 warning，新 FILE 块写入使用 error。
- 是否需要在 UI 的 Wiki Reader 中单独展示“待整理页面”分组？本 change 可以先由 lint/audit 暴露，UI 增强后续处理。
