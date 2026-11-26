## 常见问题

**Q：数据存在哪里？**  
A：页面、历史与检索索引都在 PostgreSQL；工作区 Markdown 可用 `llmwiki export` 导出，或作为 `init` 的导入源。

**Q：界面语言与生成文档语言一样吗？**  
A：不一定。Settings 中 `ui_language` 控制界面，`doc_language` 控制 Wiki 生成语言。

**Q：PDF / Office 无法解析？**  
A：查看 Settings 或 `GET /api/v1/capabilities` 的处理 tier；Tier B 可能需要 `pdftotext` 或 LibreOffice。

**Q：升级后中文搜索异常？**  
A：拉取含 CJK 搜索改进的版本后，执行一次 `llmwiki reindex`。

**Q：Web 提交的材料存在哪？**  
A：归档前会持久化到 `raw/sources/web-ingest/`，再进入 ingest 管线。
