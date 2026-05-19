## ADDED Requirements

### Requirement: Wiki 三栏布局
系统 SHALL 在 Wiki 页面提供稳定的三栏布局：左侧目录树、中间文档正文、右侧大纲面板。

#### Scenario: 打开 Wiki 页面时显示三栏
- **WHEN** 用户进入 Wiki 页面且当前有可浏览文档
- **THEN** 页面 SHALL 同时显示左侧目录树区域、中间正文区域和右侧大纲区域

#### Scenario: 大纲为空时保持主布局
- **WHEN** 当前文档无可提取标题
- **THEN** 页面 SHALL 保持左中主布局，右侧大纲区域可为空或折叠，但不影响正文浏览

### Requirement: 右侧大纲导航能力
系统 SHALL 基于当前文档标题结构生成大纲，并支持点击后平滑定位到正文对应标题。

#### Scenario: 提取标题生成大纲
- **WHEN** 文档加载并完成 markdown 渲染
- **THEN** 系统 SHALL 提取标题层级并按文档顺序展示在右侧大纲中

#### Scenario: 点击大纲项定位正文
- **WHEN** 用户点击右侧大纲中的任意标题项
- **THEN** 正文区域 SHALL 滚动到对应标题位置，且定位行为对用户可见
