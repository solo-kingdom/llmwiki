## Context

Jobs 页面（`JobsPage.tsx` + `JobCard.tsx`）当前是功能完整但体验粗糙的状态。后端已有完整的 job lifecycle API（retry/cancel/status），前端有 Dialog 组件（base-ui）和 ReactMarkdown 渲染能力。本次改动范围小但影响日常使用效率。

当前约束：
- Retry 仅支持 `failed` 状态（后端硬编码 `original.Status != "failed"`）
- 无源文件读取 API，`source_path` 纯文本展示
- 前端已有 `Dialog`（base-ui）、`ReactMarkdown` + `remarkGfm`、Tailwind 模态框样式

## Goals / Non-Goals

**Goals:**
- 移除冗余页面标题，释放纵向空间
- cancelled job 可通过 Restart（本质是 retry）恢复执行
- 快速预览 job 关联的原始文件，无需离开页面
- 支持 .md/.txt 文本渲染和图片直接展示

**Non-Goals:**
- 非 .md/.txt/图片格式的文件预览（PDF、Office 文档等暂不支持）
- 文件编辑功能（预览只读）
- succeeded job 的"重新整理"功能
- 模态框内文件树/目录浏览

## Decisions

### D1: Cancelled Restart 复用 Retry 路径

**决策**: cancelled job 的 Restart 按钮调用现有 `retryIngestJob` API，后端放宽条件允许 cancelled 状态。

**理由**: 系统已有完整的 lineage 链（`parent_job_id`），retry 创建新 job 而非原地修改状态，天然保留了"曾经取消"的历史记录。无需引入新 API 或新概念。

**替代方案**:
- 原地修改 cancelled → queued：丢失历史，破坏 lineage 完整性。否决。

### D2: 文件预览通过新 API 端点而非直接文件访问

**决策**: 新增 `GET /api/v1/ingest/jobs/{id}/source`，后端读取 job 的 `source_path`，拼接 workspace 路径后返回文件内容。

**理由**: source_path 是相对路径（如 `raw/sources/web-ingest/...`），前端无法直接访问文件系统。通过 API 层可以：
1. 校验 job 存在性
2. 做 path traversal 防护
3. 设置正确的 Content-Type
4. 控制返回格式（文本返回 JSON，图片返回二进制）

**替代方案**:
- 静态文件服务目录暴露 workspace：安全风险大，暴露整个文件系统结构。否决。

### D3: 文本和图片统一端点，通过 Accept header 或查询参数区分

**决策**: 同一端点，根据文件后缀自动判断返回类型。`.md`/`.txt` 返回 JSON `{ content, filename }`；图片后缀返回二进制流 + 对应 Content-Type。

**理由**: 前端只需一个 API 函数，根据后缀决定渲染方式。减少认知负担。

### D4: 预览模态框复用现有 Dialog + ReactMarkdown

**决策**: 新建 `SourcePreviewDialog` 组件，使用 base-ui `Dialog`、`ReactMarkdown` + `remarkGfm`（已在 `IngestChat` 和 `DocumentViewer` 中使用）。

**理由**: 无新依赖，样式和行为与现有模态框一致。`max-w-3xl` 宽度 + `max-h-[80vh]` 高度 + `overflow-y-auto` 滚动。

## Risks / Trade-offs

- **[Path traversal]** → 后端 MUST 校验 source_path 不包含 `..`，且拼接后的绝对路径在 workspace 目录内
- **[大文件预览]** → 极大的 markdown 文件可能导致渲染卡顿。MVP 阶段不限制文件大小，后续可按需加截断
- **[文件不存在]** → source_path 指向的文件可能已被外部删除。后端返回 404 + 明确错误信息
- **[非文本文件二进制读取]** → 图片返回二进制流，需要前端用 `URL.createObjectURL` 或直接 `<img src={api_url}>` 处理
