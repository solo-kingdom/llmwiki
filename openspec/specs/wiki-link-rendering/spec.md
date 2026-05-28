### Requirement: Wikilink 语法解析
remark 插件 SHALL 解析 markdown 文本中的 `[[target]]` 和 `[[target|显示文本]]` 语法，将其转换为标准 markdown 链接节点。

#### Scenario: 基本双括号链接
- **WHEN** markdown 内容包含 `[[attention]]`
- **THEN** 插件 SHALL 将其转换为一个链接，显示文本为 `attention`，链接目标为解析后的文档路径

#### Scenario: 带显示文本的双括号链接
- **WHEN** markdown 内容包含 `[[concepts/attention|注意力机制]]`
- **THEN** 插件 SHALL 将其转换为一个链接，显示文本为 `注意力机制`，链接目标为解析后的文档路径

#### Scenario: 带路径的双括号链接
- **WHEN** markdown 内容包含 `[[concepts/transformer]]`
- **THEN** 插件 SHALL 尝试将 `concepts/transformer` 解析为文档 ID

#### Scenario: 行内多个 wikilink
- **WHEN** markdown 内容包含 `参见 [[attention]] 和 [[transformer]]`
- **THEN** 插件 SHALL 正确解析并转换所有双括号链接

#### Scenario: 纯文本中不误匹配
- **WHEN** markdown 内容包含代码块 `` `[[not a link]]` `` 或 `[text](url)`
- **THEN** 插件 SHALL NOT 在代码块或标准 markdown 链接内匹配 `[[...]]`

### Requirement: Wiki 路径解析
插件 SHALL 使用与后端 `resolveWikiPath()` 一致的五步策略将 wiki 路径解析为文档 ID：精确匹配 → 追加 `.md` → 基名匹配 → slug 归一化匹配 → title 索引匹配。

#### Scenario: 精确路径匹配
- **WHEN** wikilink 目标为 `concepts/attention.md` 且文档列表中存在路径为该值的文档
- **THEN** 插件 SHALL 将其解析为对应文档 ID

#### Scenario: 追加 .md 匹配
- **WHEN** wikilink 目标为 `concepts/attention` 且文档列表中不存在精确匹配
- **THEN** 插件 SHALL 尝试 `concepts/attention.md` 进行匹配

#### Scenario: 基名匹配
- **WHEN** wikilink 目标为 `attention` 且精确路径和追加 `.md` 均不匹配
- **THEN** 插件 SHALL 在所有文档的基名中查找匹配

#### Scenario: 大小写不敏感匹配
- **WHEN** wikilink 目标为 `Attention` 而文档路径为 `concepts/attention.md`
- **THEN** 插件 SHALL 在忽略大小写的情况下匹配成功

#### Scenario: 空格到连字符的 slug 归一化匹配
- **WHEN** wikilink 目标为 `Adam Foroughi`（空格分隔）而文档路径为 `entities/adam-foroughi.md`（连字符分隔）
- **THEN** 插件 SHALL 将目标 slugify 为 `adam-foroughi`，在 slug 索引中匹配成功

#### Scenario: 多空格归一化为单个连字符
- **WHEN** wikilink 目标为 `Some  Long   Name`（多个连续空格）
- **THEN** 插件 SHALL 将其 slugify 为 `some-long-name` 进行匹配

#### Scenario: title 索引兜底匹配
- **WHEN** wikilink 目标为 `Adam Foroughi` 且 slug 归一化未匹配，但文档 title 为 "Adam Foroughi"
- **THEN** 插件 SHALL 通过 title 索引匹配成功

### Requirement: 断链标记
当 wikilink 无法解析到任何文档时，系统 SHALL 为该链接添加 `wikilink-broken` CSS 类以提供视觉区分。

#### Scenario: 无法解析的链接
- **WHEN** wikilink 目标为 `nonexistent-page` 且文档列表中无匹配文档
- **THEN** 插件 SHALL 渲染一个带有 `wikilink-broken` CSS 类的 span 元素，显示文本为原始目标

### Requirement: 插件工厂模式
插件 SHALL 通过工厂函数创建，接受文档列表作为参数，返回配置好的 remark 插件。

#### Scenario: 创建插件实例
- **WHEN** 调用 `createRemarkWikiLink(documents)` 传入文档列表
- **THEN** 工厂函数 SHALL 返回一个 remark 插件函数，内部已构建路径映射表

#### Scenario: 空文档列表
- **WHEN** 传入空文档列表
- **THEN** 所有 wikilink SHALL 被标记为断链
