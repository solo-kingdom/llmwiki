### Requirement: Logs 全局页面
系统 SHALL 在管理工作台全局导航中提供独立的 Logs Tab，展示系统活动日志列表。

#### Scenario: 导航到 Logs 页面
- **WHEN** 用户点击全局导航的 Logs 入口
- **THEN** 系统 SHALL 展示 Logs 页面，按时间倒序显示活动日志列表

#### Scenario: 路由
- **WHEN** 用户访问 `/logs` 路径
- **THEN** 系统 SHALL 渲染 Logs 页面并高亮 Logs 导航项

#### Scenario: 页面宽度一致
- **WHEN** 用户查看 Logs 页面
- **THEN** 主内容容器 SHALL 使用与 Jobs、Settings 页面一致的居中布局（`PageContainer` / `max-w-5xl`）

#### Scenario: 无日志空状态
- **WHEN** Logs 页面打开且无任何活动日志（清空后仅剩 logs_cleared 或无记录）
- **THEN** 页面 SHALL 显示空状态提示「暂无系统日志」

### Requirement: 日志列表展示
每条活动日志 SHALL 以列表行形式展示核心字段。

#### Scenario: 日志行内容
- **WHEN** 一条日志显示在列表中
- **THEN** 每行 SHALL 展示：时间（`created_at`）、级别（`level`）、类别（`category`）、消息（`message`）
- **AND** 级别 SHALL 使用语义颜色（error=红、warn=黄、info=默认）

#### Scenario: 详情展开（可选）
- **WHEN** 日志 entry 的 `details` 非空 JSON
- **THEN** 用户 SHALL 可展开查看详情（error、path、duration 等）

### Requirement: 筛选与分页
Logs 页面 SHALL 支持按类别和级别筛选，以及加载更多。

#### Scenario: 类别筛选
- **WHEN** 用户选择某个 category（如 ingest、watcher）
- **THEN** 列表 SHALL 仅显示该类别的日志

#### Scenario: 级别筛选
- **WHEN** 用户选择某个 level（如 error）
- **THEN** 列表 SHALL 仅显示该级别的日志

#### Scenario: 加载更多
- **WHEN** 日志数量超过当前 limit
- **THEN** 页面 SHALL 提供「加载更多」以增大 offset/limit 获取更多记录

### Requirement: 实时轮询刷新
Logs 页面 SHALL 自动刷新以展示新产生的日志。

#### Scenario: 3 秒轮询
- **WHEN** 用户停留在 Logs 页面
- **THEN** 系统 SHALL 每 3 秒重新请求日志列表（与 Jobs 页面轮询间隔一致）

#### Scenario: 轮询保持筛选
- **WHEN** 轮询刷新发生且用户已设置 category/level 筛选
- **THEN** 刷新请求 SHALL 携带当前筛选参数

### Requirement: 清空全部日志
Logs 页面 SHALL 提供清空全部系统日志的操作。

#### Scenario: 清空按钮
- **WHEN** 用户查看 Logs 页面
- **THEN** 页面 SHALL 显示「清空全部日志」按钮

#### Scenario: 确认对话框
- **WHEN** 用户点击「清空全部日志」
- **THEN** 系统 SHALL 显示确认对话框，说明操作不可恢复
- **AND** 用户确认后 SHALL 调用 `DELETE /api/v1/logs` 并刷新列表

#### Scenario: 清空后列表更新
- **WHEN** 清空操作成功
- **THEN** 列表 SHALL 刷新；若仅剩 `logs_cleared` 记录则显示该条或空状态

### Requirement: Logs 与 Timeline 区分
Logs 页面 SHALL 明确为系统运行时日志，而非 Git 版本历史。

#### Scenario: 导航标签
- **WHEN** 用户查看全局导航
- **THEN** Logs Tab 与 Timeline Tab SHALL 并列显示且标签分别为「Logs」与「Timeline」
- **AND** Logs 页面 SHALL NOT 展示 git commit 或 diff 内容
