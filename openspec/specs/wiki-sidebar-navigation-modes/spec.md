## Requirements

### Requirement: Wiki 侧边栏模式切换
系统 SHALL 在 Wiki Reader 左侧导航提供"Wiki"与"页面"两种互斥模式切换。"Wiki"模式用于浏览知识实体和概念，"页面"模式用于浏览文档目录结构。

#### Scenario: 用户可见并切换模式
- **WHEN** 用户在 `/wiki` 查看左侧导航
- **THEN** 系统 SHALL 展示"Wiki / 页面"切换控件（中文）/ "Wiki / Pages"切换控件（英文）
- **AND** 用户选择任一模式后 SHALL 立即更新左侧导航内容

#### Scenario: 模式切换不影响当前文档阅读
- **WHEN** 用户在已打开文档状态下切换侧边栏模式
- **THEN** 系统 SHALL 保持当前文档选择不变
- **AND** 文档正文区域 SHALL 不因切换被强制重置

### Requirement: 默认进入 Wiki 模式
系统 SHALL 在用户进入 Wiki Reader 时默认启用 Wiki 模式（原概念模式），以优先展示实体与概念内容。

#### Scenario: 首次进入默认 Wiki 模式
- **WHEN** 用户打开 `/wiki` 且未进行模式切换
- **THEN** 左侧导航 SHALL 以 Wiki 模式渲染
- **AND** 用户无需额外操作即可看到实体和概念内容入口
