## 1. CLI init 集成 git 初始化

- [x] 1.1 在 `cmd/llmwiki/init.go` 新增 `ensureVersionControl(dir)` 函数，调用 `vcs.InitRepo`（幂等）
- [x] 1.2 调整 `runInit` 顺序：scaffold 写入后调用 `ensureVersionControl`，repair 路径（已有 index.db）也执行
- [x] 1.3 git 不可用时返回明确错误，init 整体失败
- [x] 1.4 新增/更新 init 测试：fresh init 创建 `.git` 和 initial commit；repair 补 git；git 不可用失败

## 2. 后端移除 vc_enabled 开关

- [x] 2.1 简化 `processor.gitRepoIfEnabled()`：仅检查 `.git` 是否存在，移除 `GetVCConfig().Enabled` 判断
- [x] 2.2 更新 `internal/api/vcs.go`：`VCSStatus.enabled` 基于 `repo.IsInitialized()`；`VCSInit` 移除 `SetVCEnabled(true)` 调用
- [x] 2.3 移除 `VCSDisable` handler 及 `internal/server/server.go` 路由注册
- [x] 2.4 移除 `SetVCEnabled` / `GetVCConfig().Enabled` 的生产代码引用（保留或删除 `app_config.go` 中 dead code）
- [x] 2.5 更新 `internal/ingest/rollback.go` 等引用 vc_enabled 的错误消息
- [x] 2.6 更新 processor、vcs API、vc_config 相关测试

## 3. 前端移除 VC 开关

- [x] 3.1 `SettingsPage.tsx`：移除 Enable / Disable 按钮和确认对话框；有 `.git` 时展示只读 Active 状态；无 `.git` 时展示 repair 提示
- [x] 3.2 `WorkbenchLayout.tsx`：Timeline 导航始终显示；移除 `vcEnabled` 条件过滤和 redirect 逻辑
- [x] 3.3 `TimelinePage.tsx`：更新无 git 空状态文案（提示 `llmwiki init` repair，而非 Settings 启用）
- [x] 3.4 `web/src/lib/api.ts`：移除 `disableVC` 函数
- [x] 3.5 清理 i18n 中 Enable/Disable 相关文案；更新 `archive-review-card` 等 VC off 提示
- [x] 3.6 更新 Settings、Timeline、WorkbenchLayout 相关前端测试

## 4. 文档与收尾

- [x] 4.1 更新 README：`llmwiki init` 说明包含 git 初始化；标注 git 为必需依赖
- [x] 4.2 运行全量 Go 测试和前端测试，确认无回归
