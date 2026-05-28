## MODIFIED Requirements

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
