## ADDED Requirements

### Requirement: Git 仓库初始化
系统 SHALL 支持在 workspace 目录中初始化 git 仓库，仅追踪 `wiki/` 目录，排除 `.llmwiki/`、`raw/`、`revert/`。

#### Scenario: 首次初始化
- **WHEN** 系统在 workspace 目录执行 git init
- **THEN** SHALL 创建 `.git/` 目录，生成 `.gitignore` 文件（包含 `.llmwiki/`、`raw/`、`revert/` 条目），并创建 initial commit 包含当前所有 wiki 文件

#### Scenario: 已有 .gitignore 追加
- **WHEN** workspace 中已存在 `.gitignore` 文件
- **THEN** SHALL 仅追加不存在的排除条目（`.llmwiki/`、`raw/`、`revert/`），不覆盖用户已有内容

#### Scenario: workspace 已有 git 仓库
- **WHEN** workspace 中已存在 `.git/` 目录
- **THEN** SHALL 跳过初始化，验证 .gitignore 包含必要排除条目

#### Scenario: git 未安装
- **WHEN** 系统检测到 git CLI 不可用
- **THEN** SHALL 返回明确错误，提示用户安装 git

### Requirement: Git commit 操作
系统 SHALL 支持将 wiki/ 目录的变更提交到 git 仓库，commit message 包含结构化的元数据和 normalized source content。

#### Scenario: 正常提交
- **WHEN** wiki/ 目录有文件变更需要提交
- **THEN** SHALL 执行 `git add wiki/` + `git commit`，commit message 格式为：
  ```
  ingest: {source_filename}

  ---META---
  job_id: {job_id}
  source: {source_filename}
  source_type: {input_type}
  ---NORMALIZED-START---
  {normalized source content}
  ---NORMALIZED-END---
  ```
- **AND** 返回 commit SHA

#### Scenario: 无变更跳过提交
- **WHEN** wiki/ 目录无文件变更
- **THEN** SHALL 跳过 git commit，不产生空 commit

#### Scenario: Normalized content 过大
- **WHEN** normalized source content 超过 1MB
- **THEN** SHALL 截断内容并在 commit message 中标记 `---NORMALIZED-TRUNCATED---`

### Requirement: Git log 查询
系统 SHALL 支持查询 git 提交历史。

#### Scenario: 查询最近提交
- **WHEN** 请求最近 N 条提交记录
- **THEN** SHALL 返回提交列表，每条包含 commit SHA（短格式）、提交时间、commit subject line

#### Scenario: 空仓库
- **WHEN** git 仓库无任何 commit
- **THEN** SHALL 返回空列表

### Requirement: Git diff 查询
系统 SHALL 支持查询指定 commit 的文件变更差异。

#### Scenario: 查询 commit diff
- **WHEN** 请求指定 commit SHA 的差异
- **THEN** SHALL 返回该 commit 相对于前一个 commit 的 unified diff 内容

#### Scenario: 首个 commit
- **WHEN** 请求 initial commit 的差异
- **THEN** SHALL 返回该 commit 的全量 diff（所有文件视为新增）

### Requirement: Git commit message 解析
系统 SHALL 支持从 commit message 中解析结构化元数据。

#### Scenario: 解析完整 commit message
- **WHEN** 给定 commit SHA
- **THEN** SHALL 返回解析后的结构：job_id、source filename、source_type、normalized content

#### Scenario: 格式异常处理
- **WHEN** commit message 不包含结构化分隔符
- **THEN** SHALL 返回可解析部分，normalized content 为空字符串

### Requirement: Git 可用性检测
系统 SHALL 支持检测 git CLI 是否可用。

#### Scenario: git 可用
- **WHEN** 调用可用性检测
- **THEN** 检测系统 PATH 中 git 是否可执行，返回可用状态和版本号

#### Scenario: git 不可用
- **WHEN** git 未安装或不在 PATH 中
- **THEN** SHALL 返回不可用状态
