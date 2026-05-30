## ADDED Requirements

### Requirement: 重复页面检测
Wiki lint 引擎 SHALL 检测同一 typed 子目录中文件名归一化后相同的页面对，报告为 `duplicate_page` warning。归一化规则为去除空格、下划线、连字符、全角空格后转小写。

#### Scenario: 文件名空格与下划线重复
- **WHEN** `wiki/concepts/` 下同时存在 `A_Player文化.md` 和 `A Player文化.md`
- **THEN** lint 报告 SHALL 包含两个 `duplicate_page` warning
- **AND** 每个 warning 的 message SHALL 列出归一化后相同的文件路径对

#### Scenario: 文件名连字符与空格重复
- **WHEN** `wiki/entities/` 下同时存在 `RT-Merger.md` 和 `RT Merger.md`
- **THEN** lint 报告 SHALL 包含 `duplicate_page` warning

#### Scenario: 不同目录不互检
- **WHEN** `wiki/entities/App.md` 和 `wiki/concepts/App.md` 文件名归一化后相同
- **THEN** lint 报告 SHALL NOT 报告 `duplicate_page`，因为它们在不同目录

#### Scenario: 无重复时不报告
- **WHEN** 所有 wiki 页面文件名归一化后在同目录内唯一
- **THEN** lint 报告 SHALL NOT 包含 `duplicate_page` issue

#### Scenario: audit 工具展示重复页面
- **WHEN** organize 模式调用 `audit` 工具且存在 `duplicate_page` issues
- **THEN** audit 输出 SHALL 在诊断报告中展示重复页面信息

#### Scenario: 重复页面检测使用现有归一化函数
- **WHEN** lint 引擎执行重复页面检测
- **THEN** 系统 SHALL 复用 `entity_concept_coupling.go` 中的 `normalizeNameKey()` 函数进行文件名归一化
