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
16. continuity: switching list/tree items keeps the page shell (header, nav, outline) mounted; no full-page skeleton
17. persistence: hidden rails / collapsed groups survive a reload

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
- [x] state narrow: 390 下长行自动换行，计数只出现在 LogView 工具栏并保持一行
- U12 结论：info 行为中性前景色（截图采样 #1b1b1b），error/failed 才为红色；未复现「info 显示红色」。级别色在模板锁内，不再改动
- 清空日志确认、导出与刷新操作保持可达

## /settings
archetype: settings
shots: .ui-review/settings-*.png
status: reviewed
- [x] state redirect: 访问 /settings 以 replace 跳到 /settings/models，不产生历史栈；页头只有「设置」一个
- 5 个分区：模型 / 摄入与检索 / 访问控制 / 外部集成 / 规则文件；宽屏左侧竖排导航 + 42rem 居中窄列，窄屏横向滚动导航
- 行内左标签与说明、右控件；开关即时保存、文本 blur 保存；分区用 Section/Panel，不额外套卡片

## /settings/models
archetype: settings
shots: .ui-review/settings-models-*.png
status: reviewed
- [x] state wide: 左侧分区导航（含图标）与内容列对齐，内容 672px 居中；Provider 实例行与默认模型行控件对齐
- [x] state narrow: 顶部分区导航单行横向滚动，内容全宽；添加实例弹窗内边距正常
- 其余分区（ingest / access / integrations / rules）同构；页头动作 icon-only 带 aria-label

## /wiki
archetype: tree-nav
shots: .ui-review/wiki-tree-*.png
status: reviewed
- [x] state collapsed: 默认全折叠，仅当前页祖先展开；一级固定 概念 / 实体 / 其他
- [x] state expanded: 全展按钮展开所有目录；文件夹 chevron 与层级缩进正确（深度 3 封顶）
- [x] state search: 输入关键词退回扁平结果列表，清空恢复树
- 目录名随界面语言（中/英映射，未知目录保留原名）；工具条 = 搜索框 + 框外定位 + 展/折单按钮
- 树节点行尾不显示类型徽标（分组即类型）；搜索态扁平列表保留徽标

## /wiki/38a1c506-19f8-4231-b8c4-8e866f8e0f8b
archetype: reader
shots: .ui-review/wiki-reader-*.png
status: reviewed
- [x] state wide: 单页头 + 左树 + 正文（无卡片、不限宽）+ 右目录；目录随滚动高亮当前章节，点击平滑跳转
- [x] state narrow: 右目录收进页头图标弹窗；正文全宽；无横向滚动
- [x] state toc-hidden: 页头切换隐藏目录，正文占满；刷新后仍隐藏（本地存储）
- 页头 4 个 icon（反链 / 前向引用 / 历史 / 信息）各自弹窗内容与空态正常
- 切页连续性：连续点击树中条目，页头/树/目录不卸载、无整页骨架，新文档到达后原地替换

## /wiki/graph
archetype: canvas
shots: .ui-review/wiki_graph-*.png
status: reviewed
- [x] state dense: 标签上限 10（窄屏 4），标签带底色并绘制在节点层之上；宽屏三环、390 宽五列网格
- [x] state dark: 深色连线可辨（透明度 0.28/0.6），标签与节点分离
- [x] state hover: 节点 hover 出浮层摘要（标题/类型/引用数），靠近右/下边缘自动翻转，浮层不接收指针
- [x] state detail: 选中节点后页头出现「节点详情」图标，弹窗显示类型/引用数/路径/打开页面
- 画布无卡片、全宽；默认不选中任何节点；侧栏节点列表为菜单行（行尾引用数）

## /help
archetype: page
shots: .ui-review/help-*.png
status: reviewed
- [x] state narrow: 390 下目录收进 Select，正文为唯一 ScrollRegion，无嵌套滚动
- 语言 Tab 文字对比提升到 4.5+（前景色 70%），active 下划线仍可辨识
- 1280 宽屏目录与正文各自滚动，分割线到画布底边
