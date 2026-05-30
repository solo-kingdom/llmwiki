## 1. i18n 翻译更新

- [x] 1.1 更新中文翻译文件 `web/src/i18n/messages/zh.ts`：将 `wiki.mode.concept` 的值从 `概念` 改为 `Wiki`，将 `wiki.mode.pages` 的值从 `Pages` 改为 `页面`
- [x] 1.2 更新英文翻译文件 `web/src/i18n/messages/en.ts`：将 `wiki.mode.concept` 的值从 `Concepts` 改为 `Wiki`（如需要同步更新）
- [x] 1.3 在翻译文件中添加 Wiki 模式分组标题的新 i18n key：`wiki.entity_section`（中文："实体"）和 `wiki.concept_section`（中文："概念"），英文对应 "Entities" 和 "Concepts"

## 2. Wiki 模式分组展示改造

- [x] 2.1 重构 `WikiEntityList.tsx` 组件，将单一的混合列表改为两个独立分组：实体组（entity + overview 文档）和概念组（concept 文档），每组有独立的可折叠标题和计数
- [x] 2.2 为每个分组使用新的 i18n key（`wiki.entity_section` 和 `wiki.concept_section`）作为标题文案
- [x] 2.3 处理空分组逻辑：当某分组无匹配文档时该分组不渲染，另一分组正常展示；两个分组都为空时组件返回 null

## 3. 移除 Wiki 模式页面类型筛选器

- [x] 3.1 修改 `Sidebar.tsx` 中 `WikiTypeFilter` 的渲染逻辑，添加条件判断：仅在 `navigationMode === "pages"` 时渲染 `WikiTypeFilter`
- [x] 3.2 确认 `WikiReaderContext.tsx` 中的 `selectedPageTypes` 状态在切换到 Wiki 模式时不会影响文档过滤（Wiki 模式下筛选器不渲染，但需确保内部状态不影响展示结果）

## 4. 测试更新

- [x] 4.1 更新 `web/src/wiki-reader.test.tsx` 中引用 `wiki.mode.concept` 的测试用例，改为 `wiki.mode.wiki`（或检查新 key）
- [x] 4.2 添加测试用例验证 Wiki 模式下实体和概念分组展示正确
- [x] 4.3 添加测试用例验证 Wiki 模式下不显示页面类型筛选器
- [x] 4.4 运行全部前端测试确认无回归
