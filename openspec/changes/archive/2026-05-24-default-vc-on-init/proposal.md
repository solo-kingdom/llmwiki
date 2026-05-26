## Why

版本控制（git）是 ingest 闭环——写入、历史、diff、回滚——的基础设施，但当前需要用户在 Settings 手动启用，导致 Timeline 等核心能力默认不可见，且 `.git` 与 `vc_enabled` 双层开关增加心智负担。将 git 初始化并入 `llmwiki init` 可让每次 workspace 创建即具备完整版本管理能力。

## What Changes

- **`llmwiki init` 自动初始化 git**：在 scaffold 写入完成后执行 `git init`、配置 `.gitignore`、提交 `wiki/` 初始 commit
- **repair init 幂等补全 VC**：对已存在 `index.db` 的 workspace，若缺少 `.git` 则补做 git init；若已有 `.git` 则跳过
- **git 成为 init 硬依赖**：git CLI 不可用时 `llmwiki init` 失败并给出明确提示
- **移除用户可见的 VC 开关**：删除 Settings 的 Enable / Disable 按钮；Settings 仅展示只读状态（commit 数、追踪目录、View History）
- **移除 `vc_enabled` 配置开关**：以 `.git` 目录存在作为版本控制启用判定，删除 Disable API 与相关 DB 配置读写
- **Timeline 导航始终可见**：不再根据 `vc_enabled` 条件隐藏 Timeline 入口
- **BREAKING**：`POST /api/v1/vcs/disable` 端点移除；`POST /api/v1/vcs/init` 保留为 repair/幂等补全用途；已有 workspace 需运行 `llmwiki init` repair 补 git

## Capabilities

### New Capabilities

（无新增 capability）

### Modified Capabilities

- `workspace-management`：`init` 流程增加 git 初始化步骤；repair 路径幂等补全 `.git`；git 不可用时报错
- `version-settings-ui`：Settings VC 区域改为只读状态展示，移除 Enable / Disable 交互与相关 API 场景
- `web-ui`：Timeline 导航不再条件隐藏；移除 version control enabled 相关 UI 分支
- `ingest-pipeline`：版本控制判定改为 `.git` 存在即可，移除 `vc_enabled` 条件分支
- `timeline-ui`：移除 "version control is not enabled" 禁用态场景

## Impact

- **CLI**：`cmd/llmwiki/init.go` 调用 `vcs.InitRepo`；git 不可用返回错误
- **Go 后端**：`internal/ingest/processor.go` 简化 `gitRepoIfEnabled()`；`internal/api/vcs.go` 移除 Disable handler；`internal/store/sqlite/app_config.go` 移除 `vc_enabled` 相关方法
- **前端**：`SettingsPage.tsx` 移除 Enable/Disable UI；`WorkbenchLayout.tsx` 始终显示 Timeline；`api.ts` 移除 `disableVC`；i18n 清理相关文案
- **测试**：更新 init 测试、VC 配置测试、processor 测试、Settings/Timeline 组件测试
- **依赖**：git CLI 从可选 runtime dependency 变为 init 必需 dependency
