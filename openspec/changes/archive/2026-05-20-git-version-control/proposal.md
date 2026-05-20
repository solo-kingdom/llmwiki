## Why

用户无法查看或撤销某次摄入操作的改动。LLM 生成的 wiki 页面可能不准确或需要回退，但当前系统没有版本管理机制。需要利用 git 为 wiki 产出提供完整的历史记录、差异查看和智能回滚能力。

## What Changes

- **新增 git 版本管理核心层**：在 workspace 目录内初始化独立的 git repo，仅追踪 `wiki/` 目录，不追踪 `raw/`、`.llmwiki/`、`revert/`
- **新增 ingest 自动提交**：每个 ingest job 成功完成后，自动 `git add wiki/` + `git commit`，commit message 中附带 normalized source content（供回滚时 LLM 使用）
- **新增 LLM 智能回滚 job**：用户选择某个 commit 回滚时，系统从 git 取出 diff 和原始 source content，创建 rollback job 让 LLM 理解语义后生成回滚内容，直接写入 wiki/ + commit，而非机械 git revert
- **新增回滚素材归档**：回滚时，如果 `raw/sources/` 中对应的原始文件仍存在，移动到 `revert/` 目录持久保存
- **新增版本控制设置**：Settings 页面提供"启用版本控制"操作（git init + initial commit），以及版本管理状态展示
- **新增 Timeline 页面**：前端展示 git log 历史，每个 commit 可查看 diff、触发 rollback 操作
- **修改 ingest job 流程**：job 处理流程增加 git commit 阶段，pipeline 失败和 git commit 失败分开处理，retry 只重试失败阶段
- **修改 job 并发模型**：rollback job 和 ingest job 共享串行队列，确保并发安全

## Capabilities

### New Capabilities
- `version-control-core`: Git 操作的 Go 封装层——init、commit、log、diff、commit message 解析，以及 workspace .gitignore 管理
- `versioned-ingest`: Ingest job 完成后自动 git commit，commit message 包含 normalized source content，pipeline 失败与 commit 失败分离重试
- `rollback-job`: 新的 job 类型，从 git diff + commit message 中的 source content 构建 LLM prompt，智能回滚 wiki 内容并提交，移动 raw 源文件到 revert/
- `version-settings-ui`: Settings 页面的版本控制区域——初始化、状态展示、.gitignore 管理
- `timeline-ui`: 前端 Timeline 页面——展示 git log 历史、查看 diff、触发 rollback 操作

### Modified Capabilities
- `ingest-api`: 新增 rollback job 创建端点
- `jobs-page-ui`: Timeline 作为新的全局 Tab 或 Jobs 页面子视图，rollback job 在 job 列表中展示
- `workspace-management`: workspace 初始化时预留 revert/ 目录结构，reindex 流程兼容 git checkout 后的文件变化

## Impact

- **新增 Go 包**: `internal/vcs/`——git 操作封装（基于 os/exec 调用 git CLI）
- **修改 Go 包**: `internal/ingest/processor.go`——job 完成后调用 git commit；`internal/store/sqlite/ingest_jobs.go`——支持 rollback job 类型
- **新增前端页面**: Timeline 页面组件
- **修改前端页面**: Settings 页面增加版本控制区域
- **新增 API 端点**: 版本控制初始化、git log/diff 查询、rollback 触发
- **外部依赖**: 要求运行环境安装 git CLI
