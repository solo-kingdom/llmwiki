## Why

当前 Wiki Reader 仍按「全量文档树（含 raw）+ 纯全文搜索」组织，知识图谱入口留在管理工作台，与产品定位不符：Wiki 应只消费 `wiki/` 下已总结的知识，并提供按页面类型浏览、实体速览与结构导航。随着 wiki 规模增长，用户需要在同一浏览壳内完成分类筛选、实体发现与全局关系图查看，而不混入源文件与摄入过程（Timeline 等）。

## What Changes

- Wiki 侧栏与列表 API 仅展示 `source_kind=wiki` 文档，**不再显示 `raw/`**
- 侧栏新增 **页面类型筛选**（entity、concept、来源摘要、synthesis、comparison、query），与目录树联动过滤
- 侧栏新增 **实体列表**（`type=entity` 页面扁平列表，与树并列）
- `wiki/sources/` 页面在 UI 中归类为 **「来源摘要」**，与 entity 等类型区分展示
- Wiki 搜索支持 **全文关键词 AND 页面类型**（类型多选为 OR，与关键词为 AND）
- 搜索与列表默认范围限定为 wiki 成品页
- **全局知识图谱** 从 Workbench `/graph` **迁入 Wiki**（如 `/wiki/graph`），Workbench 顶栏移除图谱入口
- 图谱行为不变：只读力导向图，点击节点跳转 Wiki Reader

## Capabilities

### New Capabilities

（无——行为扩展归入既有 capability 的 delta spec。）

### Modified Capabilities

- `wiki-reader-ui`：侧栏结构（类型筛选、实体列表、仅 wiki 树）、Wiki 内图谱入口、来源摘要类型标签
- `wiki-search-modal`：搜索模态支持页面类型筛选（与全文 AND）
- `knowledge-graph-ui`：图谱视图归属 Wiki 导航而非 Workbench
- `web-ui`：Workbench 全局导航移除 Graph；Wiki 为总结知识浏览的唯一 Web 壳
- `search-engine`：HTTP 搜索 API 支持按 wiki 页面 `type` 过滤（与现有 path/wiki 范围一致）

## Impact

- **Backend**：`GET /api/v1/search` 增加 `types`（或等价）查询参数；可选 `GET /api/v1/documents` 查询参数 `source_kind=wiki`、`type=entity` 供实体列表
- **Frontend**：`WikiReaderLayout`、`Sidebar`、`SearchModal`、`wiki-routes`、`WorkbenchLayout`；i18n 新增「来源摘要」等文案
- **Specs**：`web-ui`、`knowledge-graph-ui`、`wiki-reader-ui`、`wiki-search-modal`、`search-engine` delta
- **Non-Goals（本 change）**：backlinks 面板、局部子图、断链 UI、Timeline 迁入 Wiki
