## ADDED Requirements

### Requirement: Timeline 全局导航入口
系统 SHALL 在全局导航中新增 Timeline Tab，与现有的 Wiki、Ingest Hub、Jobs Tab 并列。

#### Scenario: Timeline Tab 展示
- **WHEN** 版本控制已启用
- **THEN** 全局导航 SHALL 显示 Timeline Tab

#### Scenario: 版本控制未启用时隐藏
- **WHEN** 版本控制未启用
- **THEN** Timeline Tab SHALL 显示为灰色或隐藏
