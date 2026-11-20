# UI review

Checklist (per composite):
1. radius: frame > panel > control, one radius per level, same as reference
2. seams: every divider runs edge to edge and meets the frame/header rule; no gaps, no double lines
3. alignment: header, body and panels share left/right edges; columns line up
4. spacing rhythm: same gaps between header/toolbar/content/sections as reference
5. hierarchy: one title, one primary action, secondary text muted
6. density: row height, control size and font size match reference
7. contrast: borders, separators and muted text visible in light and dark
8. truncation: nothing clipped or overflowing; long text truncates with ellipsis
9. scroll (-end shot): header and dock stay put, only the declared region moved, last item fully visible, canvas border/radius/margin intact on all four sides, table header stuck to the region top
10. collection footer: the count is the server total or 'loaded n / total m', never the loaded count posing as the total
11. controls: typed text is foreground colour, placeholder readable, only disabled controls are dimmed
12. identity: two rows with the same primary text still show a path, time, or id
13. count: the same number is not repeated in the header and a footer or toolbar
14. canvas: labels do not cover nodes, dark edges stay visible, and labels are capped
15. copy: database names, file paths, and ports match the running system

## /
archetype: list-detail
shots: .ui-review/root-*.png
status: reviewed
- [x] state sessions: 390 会话收进 Sheet，展开后 5 条同名会话均显示更新时间；主区为「开始一次对话」空态与新建入口
- 保留独立会话栏（1280）与 Sheet（窄屏），与 list-detail 原型的单列表结构不同，属既有 IA，本次不改
- 1280 浅/深、768 浅、1280 scroll-end 均无溢出、无接缝或滚动模型问题

## /chat/523363e8-0606-4196-b481-45360cbf22f9
archetype: list-detail
shots: .ui-review/chat_523363e8_0606_4196_b481_45360cbf22f9-*.png
status: reviewed
- [x] state sessions: 同上；对话区空态提示发消息，输入框与发送按钮对齐
- 失效的会话实例/模型不再显示空框，改为 placeholder「选择实例 / 选择模型」（本次修正）
- 768 下会话栏按既有断点收进 Sheet，对话区占满

## /jobs
archetype: collection
shots: .ui-review/jobs-*.png
status: reviewed
- [x] state empty: EmptyState 占位，不渲染 DataTable，也没有「共 0 项」页脚
- 工具栏搜索框与页头操作对齐，空态位于表格同起点

## /timeline
archetype: collection
shots: .ui-review/timeline-*.png
status: reviewed
- [x] state populated: 390 下为两行列表行（摘要 + 类型/页数/时间），页脚「共 1 项」取自 total
- U7 结论：页脚仍为模板 DataTable 的 12px muted 文本 + 上边框；0.4.1 未改该样式，与数据行区分可接受，不再单列
- 1280 行高 48px（主列两行）触发 R09 警告；compact 密度下可接受，未改模板

## /logs
archetype: detail
shots: .ui-review/logs-*.png
status: reviewed
- [x] state narrow: 390 下长行自动换行，计数只出现在 LogView 工具栏（窄屏「6 / 6」被挤成两行，信息不丢）
- U12 结论：info 行为中性前景色（截图采样 #1b1b1b），error/failed 才为红色；未复现「info 显示红色」。级别色在模板锁内，不再改动
- 清空日志确认、导出与刷新操作保持可达

## /settings
archetype: settings
shots: .ui-review/settings-*.png
status: reviewed
- [x] state saved: 数字项显示已保存值或默认 placeholder（4096 / 0.7 / 512）；失效实例与模型选择器显示 placeholder
- 设置仍为单页分区滚动，未拆路由或侧栏导航，属本任务边界（不改信息架构）
- 危险操作与访问配置分区顺序、行标签与控件对齐均保持

## /wiki
archetype: detail
shots: .ui-review/wiki-*.png
status: reviewed
- 列表空态、搜索无结果提示、类型筛选均正常；列表行显示路径副标题
- 窄屏列表与详情按 Split 堆叠，无横向滚动

## /wiki/38a1c506-19f8-4231-b8c4-8e866f8e0f8b
archetype: detail
shots: .ui-review/wiki_38a1c506_19f8_4231_b8c4_8e866f8e0f8b-*.png
status: reviewed
- 正文标题降一级后每页仅 PageHeader 一个 h1；代码块内标题不受影响
- 属性、目录、反向/前向引用与页面历史分区对齐；scroll-end 下页头固定、画布四边完整
- 1280 深色正文与侧栏对比可读，侧栏字重 400 与 0.4.1 实测一致

## /wiki/graph
archetype: canvas
shots: .ui-review/wiki_graph-*.png
status: reviewed
- [x] state dense: 标签上限 10（窄屏 4），标签带底色并绘制在节点层之上；宽屏三环、390 宽五列网格，节点不再互相挤压
- [x] state dark: 深色连线可辨（透明度 0.28/0.6），标签与节点分离
- 节点命中区在 390 宽下仍 ≥24px（check_rendered R04 0 命中）；侧栏节点列表按钮补足 24px 行高

## /help
archetype: page
shots: .ui-review/help-*.png
status: reviewed
- [x] state narrow: 390 下目录收进 Select，正文为唯一 ScrollRegion，无嵌套滚动
- 语言 Tab 文字对比提升到 4.5+（前景色 70%），active 下划线仍可辨识
- 1280 宽屏目录与正文各自滚动，分割线到画布底边
