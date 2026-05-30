## Context

当前 Wiki Reader 侧边栏提供"概念 / Pages"两种导航模式。概念模式展示一个扁平化的实体+概念混合列表（标题仅显示"实体"），并附带页面类型筛选器。该设计存在三个问题：

1. **标签语义不清**："概念"作为模式名称不能直观表达其展示内容为 Wiki 知识主体
2. **实体与概念混合展示**：WikiEntityList 组件将 entity 和 concept 文档混在一个列表中，仅以字母排序，缺少类型分组
3. **Wiki 模式不需要类型筛选**：知识浏览场景下，用户关心的是实体和概念本身，无需按 page_type 过滤

涉及的前端组件：`Sidebar.tsx`、`WikiEntityList.tsx`、`WikiTypeFilter.tsx`、`WikiReaderContext.tsx`、`wiki-page-types.ts`，以及 i18n 翻译文件。

## Goals / Non-Goals

**Goals:**
- 重命名导航模式标签，使语义更清晰：Wiki（知识浏览）和页面（文档结构浏览）
- Wiki 模式下将实体和概念分开展示为两个独立的可折叠列表区块
- Wiki 模式移除页面类型筛选器，仅在页面模式下保留完整筛选功能
- 保持现有的路由结构、URL 模式和后端 API 不变

**Non-Goals:**
- 不改变 NavigationMode 的 TypeScript 类型值（保持 `"concept"` | `"pages"`），避免不必要的重构——只在显示层修改标签文案
- 不改变文档的存储结构或类型推断逻辑
- 不涉及 Pages 模式的功能变更（除保留类型筛选器外）
- 不修改后端 API 或数据库 schema

## Decisions

### 1. NavigationMode 类型值保持不变

**选择**：保留 `NavigationMode = "concept" | "pages"` 类型值不变，仅修改 UI 展示标签。

**替代方案**：将 `"concept"` 改为 `"wiki"`，需同步修改所有引用处（Sidebar、Context、TypeFilter、测试）。

**理由**：类型值是内部标识符，变更不影响用户感知但增加代码改动量和回归风险。修改标签文案是最小化侵入方案，且中文环境下"Wiki"本身就是专有名词，无需翻译。

### 2. Wiki 模式内容改为分组展示

**选择**：将现有 `WikiEntityList` 组件改造为支持两个独立分组——实体列表和概念列表。每个分组各有独立的可折叠标题（带计数），按字母排序。

**替代方案**：使用两个独立组件分别渲染实体和概念。

**理由**：复用现有 WikiEntityList 组件结构，通过分组逻辑减少组件数量。当前组件已有折叠功能和列表渲染逻辑，只需增加分组维度。两个分组共享相同的交互行为（点击导航、高亮当前选中），适合在同一组件内处理。

### 3. Wiki 模式移除类型筛选器

**选择**：在 `Sidebar.tsx` 中条件渲染 `WikiTypeFilter`，仅在 `navigationMode === "pages"` 时显示。

**替代方案**：保留筛选器但切换可用选项（如现有逻辑只展示 entity/concept 两个 chip）。

**理由**：Wiki 模式只包含实体和概念两种类型，且已通过分组展示区分，额外的筛选器增加 UI 复杂度但价值有限。页面模式管理所有六种类型文档，筛选器有明确价值。

## Risks / Trade-offs

- **[类型值与标签不一致]** → 内部 `"concept"` 值对应外部 "Wiki" 标签，可能在代码阅读时造成困惑。通过 i18n key 命名（`wiki.mode.wiki`）和注释缓解。
- **[分组后列表项过多]** → 实体和概念数量差异较大时，两个折叠区块高度不均。通过默认展开 + 独立滚动缓解。
- **[测试用例更新]** → 现有测试引用了 `wiki.mode.concept` i18n key，需同步更新。影响范围可控。
