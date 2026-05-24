## Context

当前版本控制采用双层 gate：filesystem 层（`.git` 目录）与配置层（`app_config.vc_enabled`）。用户在 Settings 点击 Enable 才会调用 `vcs.InitRepo` 并写入 `vc_enabled=true`；Disable 保留 `.git` 但停止自动 commit。`llmwiki init` 不初始化 git，Timeline 导航和 ingest 自动提交均依赖 `vc_enabled` 配置。

版本控制是 ingest 闭环（写入 → 历史 → diff → rollback）的基础设施，opt-in 模式导致核心能力默认不可见，且 `vc_enabled` 与 `.git` 状态可能不一致。

## Goals / Non-Goals

**Goals:**

- `llmwiki init`（含 repair 路径）幂等初始化 git repo
- 以 `.git` 存在作为版本控制启用判定，移除 `vc_enabled` 配置
- Settings VC 区域改为只读状态展示
- Timeline 导航始终可见
- git CLI 不可用时 `llmwiki init` 明确失败

**Non-Goals:**

- 不改变 git 追踪范围（仍仅 `wiki/`，排除 `.llmwiki/`、`raw/`、`revert/`）
- 不添加远程仓库 push/pull 支持
- 不提供用户手动 disable 自动 commit 的能力
- 不改变 rollback / worktree 并行执行语义

## Decisions

### Decision 1: init 流程中 git 初始化时机

**选择**: 在 scaffold 写入完成后、数据库创建/ reindex 之前调用 `vcs.InitRepo`

**理由**: `InitRepo` 需要 `wiki/` 内容做 initial commit；scaffold 已写入 overview、index、templates 等文件，时机正确。

**init 顺序**:

```
EnsureWorkspaceStructure
  → WriteScaffolds (engine + ingest)
  → EnsureVersionControl (vcs.InitRepo, idempotent)
  → [if index.db exists] print repair message, return
  → Create DB + reindex
```

repair 路径（已有 `index.db`）仍执行 EnsureVersionControl，补全缺失的 `.git`。

### Decision 2: 移除 vc_enabled，以 .git 为唯一信号

**选择**: 删除 `GetVCConfig().Enabled` / `SetVCEnabled` / `VCSDisable` API；`gitRepoIfEnabled()` 仅检查 `.git` 是否存在

**替代方案**: 保留 flag 但 init 写 true — 仍有两层信号，不采纳

**VCSStatus API**: `enabled` 字段改为 `repo.IsInitialized()` 结果，不再读 DB 配置

### Decision 3: git 为 init 硬依赖

**选择**: `EnsureVersionControl` 在 git 不可用时返回错误，导致 `llmwiki init` 整体失败

**理由**: 与「VC 是 workspace 内建能力」一致；避免 init 后功能残缺需用户自行发现

**server 运行时**: server 启动不强制 git（已有 workspace 可能 legacy 缺 `.git`），ingest 在无 `.git` 时跳过 commit（与当前 `IsInitialized()` 检查一致）

### Decision 4: Settings UI 改为只读 + legacy 提示

**选择**:

- 有 `.git` → 展示 Active 状态、commit 数、目录信息、View History
- 无 `.git`（legacy workspace）→ 提示运行 `llmwiki init <dir>` repair，不展示 Enable 按钮
- 移除 Disable 按钮和确认对话框

**保留** `POST /api/v1/vcs/init` 作为 HTTP repair 入口（幂等），供未来需要时使用，但 Settings 不再调用

### Decision 5: Timeline 导航始终显示

**选择**: `WorkbenchLayout` 移除 `vcEnabled` 条件过滤；Timeline 页面内处理空状态

**legacy 无 .git**: Timeline 显示 repair 提示（而非「去 Settings 启用」）

## Risks / Trade-offs

- **[Risk] 无 git 环境无法 init** → 在错误信息中明确提示安装 git；README 标注 git 为必需依赖
- **[Risk] 已有 workspace 无 .git** → repair init 补全；Settings / Timeline 提示用户运行 `llmwiki init`
- **[Risk] 用户已有外层 git repo** → `InitRepo` 检测到已有 `.git` 时幂等跳过（现有行为）
- **[Risk] 移除 Disable 后无法「暂停自动 commit」** → 接受；用户可手动管理 `.git`（power user），但 UI 不提供
- **[Trade-off] vc_enabled DB 键残留** → 不主动迁移删除，但代码不再读写；后续可清理

## Migration Plan

1. 部署新版本
2. 已有 workspace 用户运行 `llmwiki init <workspace-dir>` 补 git（repair 路径）
3. 前端/API 移除 Disable；旧客户端调用 disable 将 404
4. 无需 DB schema 变更

## Open Questions

（无 — explore 阶段已确认方向）
